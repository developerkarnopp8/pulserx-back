import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentGateway, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessService } from './subscription-access.service';
import { CoachContractsService } from './coach-contracts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AsaasService } from '../common/asaas.service';
import { isValidCpf, onlyCpfDigits } from '../common/cpf';
import { AssignSubscriptionDto, CheckoutSubscriptionDto } from './dto/subscription.dto';

type AuthUser = { id: string; role: string };

const SUBSCRIPTION_VIEW = {
  id: true,
  studentId: true,
  status: true,
  startedAt: true,
  renewsAt: true,
  canceledAt: true,
  trialEndsAt: true,
  plan: { select: { id: true, name: true, priceCents: true, categories: true, isFree: true } },
} as const;

/**
 * Atribuição manual de plano ao aluno (Rodada 3). Sem gateway ainda: coach dono ou admin
 * decidem o plano e o status. Nunca expõe gateway/contrato.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private prisma: PrismaService,
    private access: SubscriptionAccessService,
    private notifications: NotificationsService,
    private coachContracts: CoachContractsService,
    private asaas: AsaasService,
  ) {}

  /** Coach dono do aluno, ou admin. O aluno consulta a própria assinatura por `getMine`. */
  private async assertCanManageStudent(studentId: string, user: AuthUser): Promise<{ id: string; coachId: string }> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, coachId: true },
    });
    if (!student) throw new NotFoundException('Aluno não encontrado');
    const isOwningCoach = user.role === 'coach' && student.coachId === user.id;
    if (!isOwningCoach && user.role !== 'admin') {
      throw new ForbiddenException('Você não tem acesso a este aluno.');
    }
    return student;
  }

  async getForStudent(studentId: string, user: AuthUser) {
    await this.assertCanManageStudent(studentId, user);
    return this.prisma.subscription.findUnique({ where: { studentId }, select: SUBSCRIPTION_VIEW });
  }

  /** O próprio aluno: a assinatura dele e o que ela libera hoje. */
  async getMine(user: AuthUser) {
    const student = await this.prisma.student.findFirst({ where: { userId: user.id }, select: { id: true } });
    if (!student) throw new NotFoundException('Perfil de aluno não encontrado para este usuário');
    const [subscription, categories] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { studentId: student.id }, select: SUBSCRIPTION_VIEW }),
      this.access.getViewableCategories(student.id),
    ]);
    return { subscription, categories };
  }

  async assign(studentId: string, user: AuthUser, dto: AssignSubscriptionDto) {
    const student = await this.assertCanManageStudent(studentId, user);

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.planId },
      select: { id: true, coachId: true, active: true },
    });
    // Plano de outro coach é tratado como inexistente (não confirma que existe).
    if (!plan || plan.coachId !== student.coachId) throw new NotFoundException('Plano não encontrado');

    const current = await this.prisma.subscription.findUnique({
      where: { studentId },
      select: { planId: true },
    });
    if (!plan.active && current?.planId !== plan.id) {
      throw new BadRequestException('Este plano está inativo — ative-o antes de atribuir a um aluno.');
    }

    const status = dto.status ?? SubscriptionStatus.ACTIVE;
    let trialEndsAt: Date | null = null;
    if (status === SubscriptionStatus.TRIALING) {
      trialEndsAt = dto.trialEndsAt ? new Date(dto.trialEndsAt) : null;
      if (!trialEndsAt || trialEndsAt.getTime() <= Date.now()) {
        throw new BadRequestException('Período de teste exige uma data de término no futuro.');
      }
    } else if (dto.trialEndsAt) {
      throw new BadRequestException('A data de fim do teste só vale para o status TRIALING.');
    }

    const data = {
      planId: plan.id,
      status,
      trialEndsAt,
      canceledAt: status === SubscriptionStatus.CANCELED ? new Date() : null,
    };
    return this.prisma.subscription.upsert({
      where: { studentId },
      create: { studentId, ...data },
      update: data,
      select: SUBSCRIPTION_VIEW,
    });
  }

  /** Remove a assinatura: o aluno volta a "sem plano". Idempotente. */
  async remove(studentId: string, user: AuthUser): Promise<{ removed: boolean }> {
    await this.assertCanManageStudent(studentId, user);
    const { count } = await this.prisma.subscription.deleteMany({ where: { studentId } });
    return { removed: count > 0 };
  }

  /** O próprio aluno cancela a própria assinatura (fica CANCELED, não some — mantém histórico) e o coach é notificado. */
  async cancelMine(user: AuthUser) {
    const student = await this.prisma.student.findFirst({
      where: { userId: user.id },
      select: { id: true, coachId: true, user: { select: { name: true } } },
    });
    if (!student) throw new NotFoundException('Perfil de aluno não encontrado para este usuário');

    const subscription = await this.prisma.subscription.findUnique({
      where: { studentId: student.id },
      select: { ...SUBSCRIPTION_VIEW, gatewaySubscriptionId: true },
    });
    if (!subscription) throw new NotFoundException('Você não tem uma assinatura ativa.');
    if (subscription.status === SubscriptionStatus.CANCELED) {
      const { gatewaySubscriptionId: _omit, ...view } = subscription;
      return view;
    }

    // Cancela no gateway ANTES de mudar o status local — se o Asaas rejeitar, a assinatura
    // continua ACTIVE aqui (não fica "cancelada" pro aluno enquanto o gateway ainda cobra).
    if (subscription.gatewaySubscriptionId) {
      await this.asaas.cancelSubscription(subscription.gatewaySubscriptionId);
    }

    const updated = await this.prisma.subscription.update({
      where: { studentId: student.id },
      data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date() },
      select: SUBSCRIPTION_VIEW,
    });

    await this.notifications.create(
      student.coachId,
      'subscription_canceled',
      'Assinatura cancelada',
      `${student.user.name} cancelou a própria assinatura.`,
      `/coach/students`,
    );

    return updated;
  }

  /**
   * O próprio aluno assina um plano do coach dele. Plano Free/gratuito é atribuído direto
   * (sem gateway); plano pago exige o coach já ter cadastrado a carteira Asaas e cria a
   * assinatura recorrente na Asaas com split automático pro coach.
   *
   * Lock de aconselhamento do Postgres por aluno (mesmo padrão de `ensureDefaultPlans`) serializa
   * reexecuções (duplo clique, retry, duas abas): sem ele, duas chamadas concorrentes releriam o
   * mesmo `gatewaySubscriptionId` antigo e criariam DUAS assinaturas no Asaas, e o upsert local
   * (studentId único) sobrescreveria uma pela outra — a outra ficaria órfã cobrando pra sempre,
   * sem aparecer em nenhuma tela nem ter como ser cancelada pelo app.
   */
  async checkout(user: AuthUser, dto: CheckoutSubscriptionDto) {
    const student = await this.prisma.student.findFirst({
      where: { userId: user.id },
      select: { id: true, coachId: true, cpf: true, asaasCustomerId: true, user: { select: { name: true, email: true } } },
    });
    if (!student) throw new NotFoundException('Perfil de aluno não encontrado para este usuário');

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.planId },
      select: { id: true, coachId: true, active: true, isFree: true, priceCents: true },
    });
    if (!plan || plan.coachId !== student.coachId || !plan.active) {
      throw new NotFoundException('Plano não encontrado');
    }

    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${student.id}))`;

      const current = await tx.subscription.findUnique({
        where: { studentId: student.id },
        select: { gatewaySubscriptionId: true },
      });
      // Cancela a assinatura anterior no Asaas ANTES de criar/trocar — nunca deixa uma cobrança
      // recorrente órfã rodando por trás (troca de plano, retry, ou downgrade pro Free). Se o
      // cancelamento falhar, o checkout inteiro falha (fail-closed) em vez de arriscar duplicar cobrança.
      if (current?.gatewaySubscriptionId) {
        await this.asaas.cancelSubscription(current.gatewaySubscriptionId);
      }

      if (plan.isFree || plan.priceCents === 0) {
        const subscription = await tx.subscription.upsert({
          where: { studentId: student.id },
          create: { studentId: student.id, planId: plan.id, status: SubscriptionStatus.ACTIVE },
          update: {
            planId: plan.id, status: SubscriptionStatus.ACTIVE, canceledAt: null,
            gateway: null, gatewaySubscriptionId: null,
          },
          select: SUBSCRIPTION_VIEW,
        });
        return { subscription, checkoutUrl: null };
      }

      const contract = await this.coachContracts.getContractForCharge(student.coachId);
      if (!contract.walletId) {
        throw new BadRequestException('Este treinador ainda não configurou o recebimento de pagamentos. Fale com ele antes de assinar.');
      }

      let cpfDigits = student.cpf;
      if (!cpfDigits) {
        if (!dto.cpf || !isValidCpf(dto.cpf)) {
          throw new BadRequestException('Informe um CPF válido para assinar um plano pago.');
        }
        cpfDigits = onlyCpfDigits(dto.cpf);
        await tx.student.update({ where: { id: student.id }, data: { cpf: cpfDigits } });
      }

      let asaasCustomerId = student.asaasCustomerId;
      if (!asaasCustomerId) {
        const customer = await this.asaas.createCustomer(student.user.name, student.user.email, cpfDigits);
        asaasCustomerId = customer.id;
        await tx.student.update({ where: { id: student.id }, data: { asaasCustomerId } });
      }

      const asaasSubscription = await this.asaas.createSubscription({
        customerId: asaasCustomerId,
        valueCents: plan.priceCents,
        walletId: contract.walletId,
        coachPercent: 100 - contract.platformFeePercent,
        externalReference: student.id,
      });

      const subscription = await tx.subscription.upsert({
        where: { studentId: student.id },
        create: {
          studentId: student.id, planId: plan.id, status: SubscriptionStatus.PAST_DUE,
          gateway: PaymentGateway.ASAAS, gatewaySubscriptionId: asaasSubscription.id,
        },
        update: {
          planId: plan.id, status: SubscriptionStatus.PAST_DUE, canceledAt: null,
          gateway: PaymentGateway.ASAAS, gatewaySubscriptionId: asaasSubscription.id,
        },
        select: SUBSCRIPTION_VIEW,
      });

      const localSubscription = await tx.subscription.findUniqueOrThrow({ where: { studentId: student.id }, select: { id: true } });
      const payments = await this.asaas.listPaymentsBySubscription(asaasSubscription.id);
      const firstPayment = payments[0];
      if (firstPayment) {
        await tx.gatewayPayment.upsert({
          where: { asaasPaymentId: firstPayment.id },
          create: {
            subscriptionId: localSubscription.id, asaasPaymentId: firstPayment.id,
            amount: firstPayment.value, dueDate: new Date(firstPayment.dueDate), invoiceUrl: firstPayment.invoiceUrl,
          },
          update: { invoiceUrl: firstPayment.invoiceUrl },
        });
      }

      return { subscription, checkoutUrl: firstPayment?.invoiceUrl ?? null };
    }, { timeout: 15_000 });
  }

  /**
   * Resumo financeiro real do coach — MRR/receita por plano, inadimplência e churn/LTV
   * projetado. Tudo calculado a partir de `Subscription` (status/startedAt/canceledAt) e
   * `SubscriptionPlan.priceCents`, sem nenhum dado inventado — não existe billing history
   * tabular (snapshot mês a mês), então churn e LTV são aproximações honestas explicadas
   * nos comentários abaixo, não um cálculo contábil oficial.
   */
  async getFinancialSummary(coachId: string) {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { student: { coachId } },
      select: {
        status: true,
        startedAt: true,
        canceledAt: true,
        plan: { select: { id: true, name: true, priceCents: true } },
      },
    });

    const active = subscriptions.filter(s => s.status === 'ACTIVE' || s.status === 'TRIALING');
    const pastDue = subscriptions.filter(s => s.status === 'PAST_DUE');

    // MRR e receita por plano: soma do preço de cada assinatura ativa/em teste, agrupada por plano.
    const byPlan = new Map<string, { planId: string; planName: string; priceCents: number; activeCount: number; mrrCents: number }>();
    for (const s of active) {
      const entry = byPlan.get(s.plan.id) ?? { planId: s.plan.id, planName: s.plan.name, priceCents: s.plan.priceCents, activeCount: 0, mrrCents: 0 };
      entry.activeCount++;
      entry.mrrCents += s.plan.priceCents;
      byPlan.set(s.plan.id, entry);
    }
    const revenueByPlan = Array.from(byPlan.values()).sort((a, b) => b.mrrCents - a.mrrCents);
    const mrrCents = revenueByPlan.reduce((sum, p) => sum + p.mrrCents, 0);

    // Inadimplência: % de quem tem assinatura e está PAST_DUE agora.
    const pastDueRatePercent = subscriptions.length > 0 ? Math.round((pastDue.length / subscriptions.length) * 10_000) / 100 : 0;

    // Churn mensal (aproximação): cancelados dentro do mês corrente ÷ quem já estava com
    // assinatura antes do mês começar e ainda não tinha cancelado até lá. Sem uma tabela de
    // snapshots mensais reais, essa é a melhor aproximação honesta com o dado disponível.
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const canceledThisMonth = subscriptions.filter(
      s => s.canceledAt && s.canceledAt >= startOfMonth && s.canceledAt < startOfNextMonth,
    ).length;
    const activeAtStartOfMonth = subscriptions.filter(
      s => s.startedAt < startOfMonth && (!s.canceledAt || s.canceledAt >= startOfMonth),
    ).length;
    const churnRatePercent = activeAtStartOfMonth > 0
      ? Math.round((canceledThisMonth / activeAtStartOfMonth) * 10_000) / 100
      : 0;

    // LTV projetado = ticket médio mensal ÷ taxa de churn mensal (fórmula padrão de SaaS).
    // Sem cancelamento nenhum no mês, a taxa de churn é 0 e a divisão não faz sentido — null
    // em vez de "infinito" ou um número fictício.
    const arpuCents = active.length > 0 ? Math.round(mrrCents / active.length) : 0;
    const ltvProjectedCents = churnRatePercent > 0 ? Math.round(arpuCents / (churnRatePercent / 100)) : null;

    return {
      mrrCents,
      revenueByPlan,
      totalActive: active.length,
      totalPastDue: pastDue.length,
      pastDueRatePercent,
      churn: { canceledThisMonth, activeAtStartOfMonth, ratePercent: churnRatePercent },
      arpuCents,
      ltvProjectedCents,
    };
  }

  /**
   * Histórico real de cobranças do gateway (Asaas) dos alunos deste coach — pra tela de
   * governança/repasses. Nunca inclui gatewaySubscriptionId nem qualquer campo do CoachContract
   * (walletId/%), só o que já é seguro mostrar (o próprio coach vendo as cobranças dos alunos dele).
   */
  async listGatewayPayments(coachId: string) {
    return this.prisma.gatewayPayment.findMany({
      where: { subscription: { student: { coachId } } },
      select: {
        id: true,
        asaasPaymentId: true,
        status: true,
        amount: true,
        dueDate: true,
        paidAt: true,
        invoiceUrl: true,
        createdAt: true,
        subscription: {
          select: {
            student: { select: { id: true, user: { select: { name: true } } } },
            plan: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
