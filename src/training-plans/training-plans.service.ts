import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PlanScope, TrainingCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlanAccessService } from '../subscriptions/plan-access.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreatePlanDto, CreateSharedPlanDto, UpdatePlanDto,
  CreateWeekDto, CreateDayDto, CreateSessionDto,
  CreateExerciseDto, UpdateExerciseDto,
} from './dto/training-plan.dto';
import { ACTIVE_STUDENT } from '../common/student-scope';

type AuthUser = { id: string; role: string };

/**
 * Normaliza uma data "YYYY-MM-DD" pra a Segunda-feira (dayIndex=1) da mesma
 * semana, em UTC — nunca em fuso local, pra não depender do fuso do
 * servidor. dayIndex já segue 1=Segunda...6=Sábado (0=Domingo, no enum mas
 * não usado na prática), então startDate SEMPRE representa uma Segunda.
 */
export function normalizeToMonday(isoDateOnly: string): Date {
  const [y, m, d] = isoDateOnly.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = date.getUTCDay(); // 0=Dom, 1=Seg, ..., 6=Sáb
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  date.setUTCDate(date.getUTCDate() + diffToMonday);
  return date;
}

/**
 * Monta o `include` completo do plano, sempre filtrado pelo `athleteId` dono do plano.
 * Sem esse filtro, `workoutLogs`/`workoutSkips` de QUALQUER atleta apareceriam
 * associados aos exercícios/sessões deste plano (achado de IDOR na revisão final).
 */
const fullPlanInclude = (athleteId: string) => ({
  weeks: {
    orderBy: { weekNumber: 'asc' as const },
    include: {
      days: {
        orderBy: { dayIndex: 'asc' as const },
        include: {
          sessions: {
            orderBy: { order: 'asc' as const },
            include: {
              workoutSkips: { where: { athleteId }, orderBy: { createdAt: 'desc' as const }, take: 1 },
              exercises: {
                orderBy: { order: 'asc' as const },
                include: {
                  workoutLogs: { where: { athleteId }, select: { id: true } },
                  workoutSkips: { where: { athleteId }, orderBy: { createdAt: 'desc' as const }, take: 1 },
                },
              },
            },
          },
        },
      },
    },
  },
});

@Injectable()
export class TrainingPlansService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private planAccess: PlanAccessService,
    private subscriptionAccess: SubscriptionAccessService,
  ) {}

  // ── Autorização ──────────────────────────────────────────────────────────

  /** Coach dono do plano, ou o próprio aluno dono do plano — ninguém mais. Retorna o userId (athleteId) do aluno. */
  private async assertCanViewStudent(studentId: string, user: AuthUser): Promise<{ userId: string; coachId: string }> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId, ...ACTIVE_STUDENT },
      select: { coachId: true, userId: true },
    });
    if (!student) throw new NotFoundException('Aluno não encontrado');
    const isOwningCoach = user.role === 'coach' && student.coachId === user.id;
    const isSelf = user.role === 'athlete' && student.userId === user.id;
    if (!isOwningCoach && !isSelf) {
      throw new ForbiddenException('Você não tem acesso a este aluno.');
    }
    return student;
  }

  /**
   * Coach dono; aluno dono (plano individual) ou aluno do coach com a categoria liberada (plano
   * compartilhado). Retorna de quem é o progresso a exibir — no plano compartilhado visto pelo
   * próprio coach não há progresso, então usa o id dele (filtro que volta vazio).
   */
  private async assertCanViewPlan(planId: string, user: AuthUser): Promise<{ athleteId: string }> {
    const access = await this.planAccess.resolveByPlanId(planId, user);
    return { athleteId: access.athleteId ?? user.id };
  }

  /** Progresso a exibir num plano do coach dono (individual = do aluno; compartilhado = sem progresso). */
  private async resolveAthleteIdForPlan(planId: string, coachId: string): Promise<string> {
    const access = await this.planAccess.resolveByPlanId(planId, { id: coachId, role: 'coach' });
    return access.athleteId ?? coachId;
  }

  /** Só o coach dono pode criar/editar/apagar conteúdo do plano. */
  private async assertCoachOwnsPlan(planId: string, coachId: string) {
    const plan = await this.prisma.trainingPlan.findUnique({
      where: { id: planId },
      select: { coachId: true },
    });
    if (!plan) throw new NotFoundException('Plano não encontrado');
    if (plan.coachId !== coachId) {
      throw new ForbiddenException('Você não tem acesso a este plano.');
    }
  }

  private async resolvePlanIdFromWeek(weekId: string): Promise<string> {
    const week = await this.prisma.week.findUnique({ where: { id: weekId }, select: { planId: true } });
    if (!week) throw new NotFoundException('Semana não encontrada');
    return week.planId;
  }

  private async resolvePlanIdFromDay(dayId: string): Promise<string> {
    const day = await this.prisma.trainingDay.findUnique({
      where: { id: dayId },
      select: { week: { select: { planId: true } } },
    });
    if (!day) throw new NotFoundException('Dia não encontrado');
    return day.week.planId;
  }

  private async resolvePlanIdFromSession(sessionId: string): Promise<string> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { day: { select: { week: { select: { planId: true } } } } },
    });
    if (!session) throw new NotFoundException('Sessão não encontrada');
    return session.day.week.planId;
  }

  private async resolvePlanIdFromExercise(exerciseId: string): Promise<string> {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      select: { session: { select: { day: { select: { week: { select: { planId: true } } } } } } },
    });
    if (!exercise) throw new NotFoundException('Exercício não encontrado');
    return exercise.session.day.week.planId;
  }

  // ── Plans ────────────────────────────────────────────────────────────────

  async findByStudent(studentId: string, user: AuthUser) {
    const student = await this.assertCanViewStudent(studentId, user);
    if (user.role === 'coach') {
      return this.prisma.trainingPlan.findMany({
        where: { studentId },
        include: fullPlanInclude(student.userId),
        orderBy: { createdAt: 'desc' },
      });
    }
    // Aluno: o plano individual + os compartilhados (publicados) do coach dele, só das categorias
    // que a assinatura libera (todas, enquanto o bloqueio estiver desligado).
    const categories = await this.subscriptionAccess.getViewableCategories(studentId);
    return this.prisma.trainingPlan.findMany({
      where: {
        category: { in: categories },
        OR: [
          { studentId, scope: PlanScope.INDIVIDUAL },
          { scope: PlanScope.SHARED, published: true, coachId: student.coachId },
        ],
      },
      include: fullPlanInclude(student.userId),
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Planos compartilhados (Core/LPO) do coach — o plano pertence ao coach, não a um aluno. */
  async findSharedByCoach(coachId: string, category?: TrainingCategory) {
    return this.prisma.trainingPlan.findMany({
      where: { coachId, scope: PlanScope.SHARED, ...(category ? { category } : {}) },
      include: fullPlanInclude(coachId),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, user: AuthUser) {
    const { athleteId } = await this.assertCanViewPlan(id, user);
    const plan = await this.prisma.trainingPlan.findUnique({
      where: { id },
      include: fullPlanInclude(athleteId),
    });
    if (!plan) throw new NotFoundException('Plano não encontrado');
    return plan;
  }

  async create(coachId: string, dto: CreatePlanDto) {
    const student = await this.prisma.student.findUnique({
      where: { id: dto.studentId, ...ACTIVE_STUDENT },
      select: { userId: true, coachId: true },
    });
    if (!student) throw new NotFoundException('Aluno não encontrado');
    if (student.coachId !== coachId) {
      throw new ForbiddenException('Você não tem acesso a este aluno.');
    }
    const athleteId = student.userId;

    const WEEKS = 4;
    const DAYS = [
      { dayOfWeek: 'Segunda', dayIndex: 1 },
      { dayOfWeek: 'Terça',   dayIndex: 2 },
      { dayOfWeek: 'Quarta',  dayIndex: 3 },
      { dayOfWeek: 'Quinta',  dayIndex: 4 },
      { dayOfWeek: 'Sexta',   dayIndex: 5 },
      { dayOfWeek: 'Sábado',  dayIndex: 6 },
    ];

    const startDate = normalizeToMonday(dto.startDate);

    return this.prisma.$transaction(async tx => {
      const plan = await tx.trainingPlan.create({
        data: { ...dto, coachId, startDate },
      });

      for (let w = 1; w <= WEEKS; w++) {
        const week = await tx.week.create({
          data: { planId: plan.id, weekNumber: w },
        });
        await tx.trainingDay.createMany({
          data: DAYS.map(d => ({ weekId: week.id, ...d })),
        });
      }

      return tx.trainingPlan.findUnique({
        where: { id: plan.id },
        include: fullPlanInclude(athleteId),
      });
    });
  }

  /** Plano compartilhado (Core/LPO): pertence ao coach, sem aluno; a categoria e a assinatura decidem quem vê. */
  async createShared(coachId: string, dto: CreateSharedPlanDto) {
    const startDate = normalizeToMonday(dto.startDate);
    const DAYS = [
      { dayOfWeek: 'Segunda', dayIndex: 1 },
      { dayOfWeek: 'Terça',   dayIndex: 2 },
      { dayOfWeek: 'Quarta',  dayIndex: 3 },
      { dayOfWeek: 'Quinta',  dayIndex: 4 },
      { dayOfWeek: 'Sexta',   dayIndex: 5 },
      { dayOfWeek: 'Sábado',  dayIndex: 6 },
    ];

    return this.prisma.$transaction(async tx => {
      const plan = await tx.trainingPlan.create({
        data: {
          coachId,
          scope: PlanScope.SHARED,
          category: dto.category,
          month: dto.month,
          title: dto.title,
          startDate,
        },
      });
      for (let w = 1; w <= 4; w++) {
        const week = await tx.week.create({ data: { planId: plan.id, weekNumber: w } });
        await tx.trainingDay.createMany({ data: DAYS.map(d => ({ weekId: week.id, ...d })) });
      }
      return tx.trainingPlan.findUnique({ where: { id: plan.id }, include: fullPlanInclude(coachId) });
    });
  }

  async update(id: string, coachId: string, dto: UpdatePlanDto) {
    await this.assertCoachOwnsPlan(id, coachId);
    return this.prisma.trainingPlan.update({ where: { id }, data: dto });
  }

  async publish(id: string, coachId: string) {
    await this.assertCoachOwnsPlan(id, coachId);
    const plan = await this.prisma.trainingPlan.update({
      where: { id },
      data: { published: true },
      include: { student: { select: { userId: true } } },
    });
    const title = 'Novo plano publicado';
    const message = `Seu coach publicou "${plan.title}"`;
    const link = '/athlete/weekly';

    if (plan.scope === PlanScope.INDIVIDUAL && plan.student) {
      await this.notificationsService.create(plan.student.userId, 'plan_published', title, message, link);
      return plan;
    }

    // Compartilhado: avisa só os alunos do coach que enxergam a categoria.
    const students = await this.prisma.student.findMany({
      where: { coachId, ...ACTIVE_STUDENT },
      select: { id: true, userId: true },
    });
    const allowedIds = new Set(
      await this.subscriptionAccess.filterStudentsWithCategory(students.map(s => s.id), plan.category),
    );
    const recipients = students.filter(s => allowedIds.has(s.id));
    // Em lotes: cada create também emite pelo socket; sem teto um coach grande esgotaria o pool do banco.
    const BATCH = 25;
    for (let i = 0; i < recipients.length; i += BATCH) {
      await Promise.all(
        recipients
          .slice(i, i + BATCH)
          .map(s => this.notificationsService.create(s.userId, 'plan_published', title, message, link)),
      );
    }
    return plan;
  }

  async remove(id: string, coachId: string) {
    await this.assertCoachOwnsPlan(id, coachId);
    return this.prisma.trainingPlan.delete({ where: { id } });
  }

  // ── Weeks ────────────────────────────────────────────────────────────────

  /** Garante que o plano tenha 4 semanas × 6 dias. Idempotente. */
  async initializeWeeks(planId: string, coachId: string) {
    await this.assertCoachOwnsPlan(planId, coachId);
    const athleteId = await this.resolveAthleteIdForPlan(planId, coachId);
    const existingWeeks = await this.prisma.week.count({ where: { planId } });
    if (existingWeeks > 0) {
      return this.prisma.trainingPlan.findUnique({ where: { id: planId }, include: fullPlanInclude(athleteId) });
    }

    const DAYS = [
      { dayOfWeek: 'Segunda', dayIndex: 1 },
      { dayOfWeek: 'Terça',   dayIndex: 2 },
      { dayOfWeek: 'Quarta',  dayIndex: 3 },
      { dayOfWeek: 'Quinta',  dayIndex: 4 },
      { dayOfWeek: 'Sexta',   dayIndex: 5 },
      { dayOfWeek: 'Sábado',  dayIndex: 6 },
    ];

    await this.prisma.$transaction(async tx => {
      for (let w = 1; w <= 4; w++) {
        const week = await tx.week.create({ data: { planId, weekNumber: w } });
        await tx.trainingDay.createMany({ data: DAYS.map(d => ({ weekId: week.id, ...d })) });
      }
    });

    return this.prisma.trainingPlan.findUnique({ where: { id: planId }, include: fullPlanInclude(athleteId) });
  }

  async addWeek(planId: string, coachId: string, dto: CreateWeekDto) {
    await this.assertCoachOwnsPlan(planId, coachId);
    return this.prisma.week.create({ data: { planId, ...dto } });
  }

  async removeWeek(weekId: string, coachId: string) {
    const planId = await this.resolvePlanIdFromWeek(weekId);
    await this.assertCoachOwnsPlan(planId, coachId);
    return this.prisma.week.delete({ where: { id: weekId } });
  }

  // ── Days ─────────────────────────────────────────────────────────────────

  async addDay(weekId: string, coachId: string, dto: CreateDayDto) {
    const planId = await this.resolvePlanIdFromWeek(weekId);
    await this.assertCoachOwnsPlan(planId, coachId);
    return this.prisma.trainingDay.create({ data: { weekId, ...dto } });
  }

  async removeDay(dayId: string, coachId: string) {
    const planId = await this.resolvePlanIdFromDay(dayId);
    await this.assertCoachOwnsPlan(planId, coachId);
    return this.prisma.trainingDay.delete({ where: { id: dayId } });
  }

  // ── Sessions ─────────────────────────────────────────────────────────────

  async addSession(dayId: string, coachId: string, dto: CreateSessionDto) {
    const planId = await this.resolvePlanIdFromDay(dayId);
    await this.assertCoachOwnsPlan(planId, coachId);
    return this.prisma.session.create({
      data: { dayId, ...dto },
      include: { exercises: { orderBy: { order: 'asc' } } },
    });
  }

  async removeSession(sessionId: string, coachId: string) {
    const planId = await this.resolvePlanIdFromSession(sessionId);
    await this.assertCoachOwnsPlan(planId, coachId);
    return this.prisma.session.delete({ where: { id: sessionId } });
  }

  // ── Exercises ────────────────────────────────────────────────────────────

  async addExercise(sessionId: string, coachId: string, dto: CreateExerciseDto) {
    const planId = await this.resolvePlanIdFromSession(sessionId);
    await this.assertCoachOwnsPlan(planId, coachId);
    return this.prisma.exercise.create({
      data: { sessionId, ...dto } as any,
    });
  }

  async updateExercise(exerciseId: string, coachId: string, dto: UpdateExerciseDto) {
    const planId = await this.resolvePlanIdFromExercise(exerciseId);
    await this.assertCoachOwnsPlan(planId, coachId);
    return this.prisma.exercise.update({
      where: { id: exerciseId },
      data: dto as any,
    });
  }

  async removeExercise(exerciseId: string, coachId: string) {
    const planId = await this.resolvePlanIdFromExercise(exerciseId);
    await this.assertCoachOwnsPlan(planId, coachId);
    return this.prisma.exercise.delete({ where: { id: exerciseId } });
  }

  // ── Dashboard ────────────────────────────────────────────────────────────

  /**
   * % real de exercícios concluídos (com WorkoutLog) por dia da semana
   * (dayIndex 0-6), agregado entre todos os alunos do coach, cada um na
   * própria semana atual (`student.currentMonth`/`currentWeek`).
   */
  async getWeeklyCompletionByDayIndex(coachId: string): Promise<{ dayIndex: number; percent: number }[]> {
    const students = await this.prisma.student.findMany({
      where: { coachId, ...ACTIVE_STUDENT },
      select: { id: true, userId: true, currentMonth: true, currentWeek: true },
    });

    const totals = new Map<number, { total: number; done: number }>();
    for (let i = 0; i <= 6; i++) totals.set(i, { total: 0, done: 0 });

    const weeks = await Promise.all(
      students.map(student =>
        this.prisma.week.findFirst({
          where: {
            weekNumber: student.currentWeek,
            plan: { studentId: student.id, month: student.currentMonth },
          },
          include: {
            days: {
              include: {
                sessions: {
                  include: {
                    exercises: {
                      include: { workoutLogs: { where: { athleteId: student.userId }, select: { id: true } } },
                    },
                  },
                },
              },
            },
          },
        }),
      ),
    );

    for (const week of weeks) {
      if (!week) continue;
      for (const day of week.days) {
        const bucket = totals.get(day.dayIndex);
        if (!bucket) continue;
        for (const session of day.sessions) {
          for (const exercise of session.exercises) {
            bucket.total++;
            if (exercise.workoutLogs.length > 0) bucket.done++;
          }
        }
      }
    }

    return Array.from(totals.entries())
      .sort(([a], [b]) => a - b)
      .map(([dayIndex, { total, done }]) => ({
        dayIndex,
        percent: total > 0 ? Math.round((done / total) * 100) : 0,
      }));
  }
}
