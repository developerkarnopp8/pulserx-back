import { Injectable, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordResetService } from '../auth/password-reset.service';
import { unusablePassword } from '../auth/email-tokens';
import { CreateCoachDto } from './dto/admin.dto';
import { ACTIVE_STUDENT } from '../common/student-scope';
import { paymentBreakdown, sumBreakdowns } from '../subscriptions/payment-breakdown';
import { emptyMonths, groupByCoachAndMonth, lastMonths, PaidPayment } from './financial-months';
import { coachAlerts, summarizeSubscriptions } from './coach-insights';

const TRINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private passwordReset: PasswordResetService,
  ) {}

  /**
   * Lista coaches com o real por trás da governança da plataforma: % do contrato (só o admin define, por coach —
   * vale para assinaturas NOVAS), quantos alunos ativos ele tem, e o repasse real já pago com a MESMA conta do
   * Financeiro do coach: bruto → taxa do Asaas → AEVON (pelo % gravado em cada assinatura) → coach. Antes o admin
   * calculava sobre o bruto e com o % de hoje, e os dois painéis mostravam números diferentes para o mesmo dinheiro.
   */
  async listCoaches(now = new Date()) {
    const [coaches, paid] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: 'coach' },
        select: { id: true, name: true, email: true, aiImportEnabled: true, createdAt: true, lastLoginAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.paidPayments(),
    ]);
    const desde = new Date(now.getTime() - TRINTA_DIAS_MS);

    return Promise.all(coaches.map(async ({ lastLoginAt, ...coach }) => {
      const [contract, studentCount, subscriptions, profile, plans, aiImportedPlans, completedWorkouts30d, lastPlan] =
        await Promise.all([
          this.prisma.coachContract.findUnique({
            where: { coachId: coach.id },
            select: { platformFeePercent: true, gatewayAccountRef: true },
          }),
          this.prisma.student.count({ where: { coachId: coach.id, ...ACTIVE_STUDENT } }),
          this.prisma.subscription.findMany({
            where: { student: { coachId: coach.id, ...ACTIVE_STUDENT } },
            select: { status: true, plan: { select: { priceCents: true } } },
          }),
          this.prisma.coachProfile.findUnique({ where: { coachId: coach.id }, select: { published: true } }),
          this.prisma.trainingPlan.count({ where: { coachId: coach.id } }),
          this.prisma.trainingPlan.count({ where: { coachId: coach.id, importedByAi: true } }),
          this.prisma.workoutSession.count({
            where: { status: 'Completed', finishedAt: { gte: desde }, session: { day: { week: { plan: { coachId: coach.id } } } } },
          }),
          this.prisma.trainingPlan.findFirst({
            where: { coachId: coach.id },
            orderBy: { updatedAt: 'desc' },
            select: { updatedAt: true },
          }),
        ]);
      const totals = sumBreakdowns(
        paid.filter(p => p.coachId === coach.id).map(p => paymentBreakdown(p.amount, p.netValue, p.platformFeePercent)),
      );
      const platformFeePercent = contract ? Number(contract.platformFeePercent) : 0;
      return {
        ...coach,
        platformFeePercent,
        studentCount,
        subscriptions: summarizeSubscriptions(subscriptions, studentCount),
        alerts: coachAlerts({
          platformFeePercent,
          walletId: contract?.gatewayAccountRef ?? null,
          pagePublished: profile?.published === true,
        }),
        usage: {
          plans,
          aiImportedPlans,
          completedWorkouts30d,
          lastLoginAt,
          lastPlanUpdateAt: lastPlan?.updatedAt ?? null,
        },
        totalPaid: totals.gross,
        gatewayFee: totals.gatewayFee,
        platformCut: totals.platformFee,
        coachCut: totals.coachNet,
        pendingBreakdown: totals.pendingBreakdown,
      };
    }));
  }

  /**
   * Financeiro por coach, mês a mês (o atual e os 5 anteriores), pelo mês em que a cobrança foi PAGA, e o total da
   * plataforma. Só cobranças pagas pelo Asaas (as de alunos com a conta excluída continuam — são registro fiscal).
   */
  async financialOverview(now = new Date()) {
    const months = lastMonths(now, 6);
    const [coaches, paid] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: 'coach' },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
      }),
      this.paidPayments({ gte: months[0].start, lt: months[months.length - 1].end }),
    ]);
    const { byCoach, totals } = groupByCoachAndMonth(paid, months);
    return {
      months: months.map(m => m.key),
      coaches: coaches.map(c => ({ ...c, months: byCoach.get(c.id) ?? emptyMonths(months) })),
      totals,
    };
  }

  /** Cobranças PAGAS (opcionalmente num intervalo de pagamento), com o que a conta real precisa. */
  private async paidPayments(paidAt?: { gte: Date; lt: Date }): Promise<PaidPayment[]> {
    const rows = await this.prisma.gatewayPayment.findMany({
      where: { status: 'paid', ...(paidAt ? { paidAt } : {}) },
      select: {
        amount: true,
        netValue: true,
        paidAt: true,
        // inclui desvinculados: cobrança paga de ex-aluno continua sendo receita do coach (registro fiscal).
        subscription: { select: { platformFeePercent: true, student: { select: { coachId: true } } } },
      },
    });
    return rows.map(r => ({
      amount: r.amount,
      netValue: r.netValue,
      // Pago sempre tem data (o webhook grava junto); sem data, conta como fora do período.
      paidAt: r.paidAt ?? new Date(0),
      platformFeePercent: r.subscription.platformFeePercent,
      coachId: r.subscription.student.coachId,
    }));
  }

  /**
   * Coach novo SEM senha (decisão do dono, 2026-09-30): ele recebe por e-mail o link "crie sua senha" (7 dias); criar a
   * senha confirma o e-mail. O admin não vê nem repassa senha.
   */
  async createCoach(dto: CreateCoachDto): Promise<{ id: string; name: string; email: string; welcomeSent: true }> {
    const existing = await this.prisma.user.findFirst({ where: { email: dto.email } });
    if (existing) throw new ConflictException('E-mail já cadastrado');

    const coach = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash: await bcrypt.hash(unusablePassword(), 10),
        role: 'coach',
      },
      select: { id: true, name: true, email: true },
    });

    // Falha no envio não desfaz o cadastro: o admin reenvia pelo "Enviar link de nova senha".
    await this.passwordReset
      .sendWelcome(coach, { tipo: 'admin' })
      .catch(err =>
        this.logger.error(`Falha ao enviar o "crie sua senha" (coach ${coach.id})`, err instanceof Error ? err.stack : String(err)),
      );
    return { ...coach, welcomeSent: true };
  }

  /** Admin manda ao coach o link de nova senha por e-mail (1 hora). A senha atual continua valendo até ele trocar. */
  async resetCoachPassword(id: string): Promise<{ sent: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, deletedAt: true },
    });
    if (!user || user.role !== 'coach' || user.deletedAt) throw new NotFoundException('Coach não encontrado');

    await this.passwordReset.sendResetLink(user, 'admin');
    return { sent: true };
  }

  async toggleCoachAi(id: string, aiImportEnabled: boolean): Promise<{ id: string; aiImportEnabled: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!user || user.role !== 'coach') throw new NotFoundException('Coach não encontrado');

    return this.prisma.user.update({
      where: { id },
      data: { aiImportEnabled },
      select: { id: true, aiImportEnabled: true },
    });
  }
}
