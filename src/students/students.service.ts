import {
  Injectable, NotFoundException, ConflictException, ForbiddenException, Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto, UpdateStudentDto } from './dto/create-student.dto';
import { ACTIVE_STUDENT } from '../common/student-scope';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import { lockWeeksAfter } from '../subscriptions/plan-access.service';
import { PasswordResetService } from '../auth/password-reset.service';
import { unusablePassword } from '../auth/email-tokens';

type AuthUser = { id: string; role: string };

/**
 * Sem `cpf`/`asaasCustomerId` — são dado sensível coletado só pro fluxo de pagamento
 * (`SubscriptionsService.checkout`), que já os busca com o próprio `select` dedicado.
 * Essas rotas (listagem/detalhe/perfil do aluno) nunca precisaram disso; devolver por
 * `include`/sem `select` vazaria o CPF de todo aluno pro coach (e pro front) sem necessidade.
 */
const STUDENT_SAFE_SELECT = {
  id: true,
  userId: true,
  coachId: true,
  goal: true,
  currentMonth: true,
  currentWeek: true,
  completionPercent: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Mesmo formato "seguro" de `SUBSCRIPTION_VIEW` em subscriptions.service.ts — nunca gateway/gatewaySubscriptionId. */
const STUDENT_SUBSCRIPTION_SELECT = {
  id: true,
  status: true,
  startedAt: true,
  renewsAt: true,
  canceledAt: true,
  trialEndsAt: true,
  plan: { select: { id: true, name: true, priceCents: true, categories: true, isFree: true } },
} as const;

@Injectable()
export class StudentsService {
  private readonly logger = new Logger(StudentsService.name);

  constructor(
    private prisma: PrismaService,
    private subscriptions: SubscriptionsService,
    private passwordReset: PasswordResetService,
    private subscriptionAccess: SubscriptionAccessService,
  ) {}

  /** Coach dono do aluno, ou o próprio aluno — ninguém mais. */
  private assertCanAccess(student: { coachId: string; userId: string }, user: AuthUser) {
    const isOwningCoach = user.role === 'coach' && student.coachId === user.id;
    const isSelf = user.role === 'athlete' && student.userId === user.id;
    if (!isOwningCoach && !isSelf) {
      throw new ForbiddenException('Você não tem acesso a este aluno.');
    }
  }

  async findByUserId(userId: string) {
    const student = await this.prisma.student.findFirst({
      where: { userId, ...ACTIVE_STUDENT },
      select: {
        ...STUDENT_SAFE_SELECT,
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    });
    if (!student) throw new NotFoundException('Perfil de aluno não encontrado para este usuário');
    return student;
  }

  async findAll(coachId: string) {
    const students = await this.prisma.student.findMany({
      where: { coachId, ...ACTIVE_STUDENT },
      select: {
        ...STUDENT_SAFE_SELECT,
        user: { select: { id: true, name: true, email: true, role: true } },
        subscription: { select: STUDENT_SUBSCRIPTION_SELECT },
      },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      students.map(async s => ({
        ...s,
        completionPercent: await this.computeCompletionPercent(s.id, s.currentMonth, s.userId),
      })),
    );
  }

  /**
   * % real de exercícios com WorkoutLog no plano do mês atual do aluno.
   * `completionPercent` era uma coluna estática (@default(0)) nunca
   * recalculada — na prática ficava travada no valor de seed migrado do
   * mock antigo (68), sem relação com o progresso real.
   */
  private async computeCompletionPercent(studentId: string, month: number, athleteId: string): Promise<number> {
    const plan = await this.prisma.trainingPlan.findFirst({
      where: { studentId, month },
      include: {
        weeks: {
          include: {
            days: {
              include: {
                sessions: {
                  include: {
                    exercises: {
                      include: { workoutLogs: { where: { athleteId }, select: { id: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!plan) return 0;

    let total = 0;
    let done = 0;
    for (const week of plan.weeks) {
      for (const day of week.days) {
        for (const session of day.sessions) {
          for (const exercise of session.exercises) {
            total++;
            if (exercise.workoutLogs.length > 0) done++;
          }
        }
      }
    }
    return total > 0 ? Math.round((done / total) * 100) : 0;
  }

  async findOne(id: string, user: AuthUser) {
    const student = await this.prisma.student.findUnique({
      where: { id, ...ACTIVE_STUDENT },
      select: {
        ...STUDENT_SAFE_SELECT,
        user: { select: { id: true, name: true, email: true, role: true } },
        trainingPlans: {
          where: { published: true },
          orderBy: { month: 'desc' },
          take: 1,
        },
      },
    });
    if (!student) throw new NotFoundException('Aluno não encontrado');
    this.assertCanAccess(student, user);
    return student;
  }

  /**
   * Coach cadastra o aluno SEM senha (decisão do dono, 2026-09-30): o aluno recebe por e-mail o link "crie sua senha"
   * (7 dias) e criar a senha confirma o e-mail. Ninguém mais combina senha por WhatsApp.
   */
  async create(coachId: string, dto: CreateStudentDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('E-mail já cadastrado');

    const passwordHash = await bcrypt.hash(unusablePassword(), 10);

    const student = await this.prisma.$transaction(async tx => {
      const user = await tx.user.create({
        data: { name: dto.name, email: dto.email, passwordHash, role: 'athlete' },
      });
      return tx.student.create({
        data: { userId: user.id, coachId, goal: dto.goal },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
    });

    // Falha no envio não desfaz o cadastro: o coach reenvia pelo botão "Enviar link de nova senha".
    const coach = await this.prisma.user.findUnique({ where: { id: coachId }, select: { name: true } });
    await this.passwordReset
      .sendWelcome(student.user, { tipo: 'coach', nome: coach?.name ?? 'seu treinador' })
      .catch(err =>
        this.logger.error(`Falha ao enviar o "crie sua senha" (usuário ${student.user.id})`, err instanceof Error ? err.stack : String(err)),
      );
    return student;
  }

  /** Busca simples pro coach dono validar antes de escrever — sem cross-check de role. */
  private async getOwnedByCoach(id: string, coachId: string) {
    const student = await this.prisma.student.findUnique({ where: { id, ...ACTIVE_STUDENT } });
    if (!student) throw new NotFoundException('Aluno não encontrado');
    if (student.coachId !== coachId) {
      throw new ForbiddenException('Você não tem acesso a este aluno.');
    }
    return student;
  }

  async update(id: string, coachId: string, dto: UpdateStudentDto) {
    await this.getOwnedByCoach(id, coachId);
    return this.prisma.student.update({
      where: { id },
      data: dto,
      select: STUDENT_SAFE_SELECT,
    });
  }

  /**
   * "Desvincular" (decisão do dono, 2026-09-30): o coach encerra o vínculo — cancela a cobrança no Asaas, o aluno some
   * da lista dele e perde o acesso ao app. A conta e os dados NÃO são apagados: isso só a pedido do próprio aluno ou do
   * admin (LGPD Art. 18). Antes apagava a conta inteira — a cobrança seguia no Asaas e o histórico fiscal sumia.
   */
  async unlink(id: string, coachId: string): Promise<{ unlinked: boolean }> {
    const student = await this.getOwnedByCoach(id, coachId);
    // Asaas primeiro: se o cancelamento falhar, o vínculo continua (nunca "desvinculado" com o gateway cobrando).
    await this.subscriptions.endSubscription(student.id);
    const { count } = await this.prisma.student.updateMany({
      where: { id: student.id, ...ACTIVE_STUDENT },
      data: { unlinkedAt: new Date() },
    });
    return { unlinked: count > 0 };
  }

  /**
   * Plano individual atual com a estrutura completa. Coach dono vê tudo; o próprio aluno passa pela mesma regra de assinatura
   * do resto do app (categoria liberada e, no Free, só a semana da amostra) — antes esta rota entregava o plano sem conferir.
   */
  async getCurrentPlan(studentId: string, user: AuthUser) {
    const student = await this.findOne(studentId, user);
    const plan = await this.prisma.trainingPlan.findFirst({
      where: { studentId },
      orderBy: { month: 'desc' },
      include: {
        weeks: {
          orderBy: { weekNumber: 'asc' },
          include: {
            days: {
              orderBy: { dayIndex: 'asc' },
              include: {
                sessions: {
                  orderBy: { order: 'asc' },
                  include: {
                    exercises: { orderBy: { order: 'asc' } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!plan || user.role !== 'athlete') return { student, plan };
    await this.subscriptionAccess.assertCanAccessCategory(studentId, plan.category);
    const maxWeek = await this.subscriptionAccess.weekLimit(studentId);
    return { student, plan: { ...plan, weeks: lockWeeksAfter(plan.weeks, maxWeek) } };
  }
}
