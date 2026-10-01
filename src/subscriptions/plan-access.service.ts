import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PlanScope, TrainingCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessService } from './subscription-access.service';
import { ACTIVE_STUDENT } from '../common/student-scope';

type AuthUser = { id: string; role: string };

export type PlanAccess = {
  planId: string;
  coachId: string;
  scope: PlanScope;
  category: TrainingCategory;
  /** Aluno (Student.id) que executa o plano; null quando quem pede é o coach dono de um plano SHARED. */
  studentId: string | null;
  /** userId cujo progresso (logs/skips) vale para esta visão; null = coach dono de um plano SHARED (sem progresso próprio). */
  athleteId: string | null;
  isCoach: boolean;
  /** Aluno no Free (amostra): última semana que ele pode ver/usar. null = todas (inclusive para o coach). */
  maxWeek: number | null;
};

const SEMANA_BLOQUEADA = 'Assine um plano para ver as próximas semanas.';

/**
 * Semanas além da amostra do Free voltam sem conteúdo, marcadas `locked` (a tela mostra "Assine para ver"). O corte é aqui na
 * API — a tela só exibe. Sem limite, devolve as semanas como estão.
 */
export function lockWeeksAfter<W extends { weekNumber: number; days: unknown[] }>(
  weeks: W[],
  maxWeek: number | null,
): (W & { locked?: true })[] {
  if (maxWeek == null) return weeks;
  return weeks.map(w => (w.weekNumber > maxWeek ? { ...w, days: [], locked: true as const } : w));
}

/**
 * Fonte única de "quem pode ver/usar este plano". Substitui as checagens que assumiam
 * `plan.studentId`/`plan.student.userId` não-nulos (quebravam com 500 em plano SHARED).
 *
 * - Coach: só o coach dono (`plan.coachId`), em qualquer escopo.
 * - Atleta, plano INDIVIDUAL: só o aluno dono do plano.
 * - Atleta, plano SHARED: precisa ser aluno do coach dono do plano, o plano precisa estar
 *   publicado e a assinatura precisa liberar a categoria (quando o bloqueio está ligado).
 * - Estado inconsistente (INDIVIDUAL sem aluno) ou outro papel: 403 (falha fechada).
 */
@Injectable()
export class PlanAccessService {
  constructor(
    private prisma: PrismaService,
    private subscriptionAccess: SubscriptionAccessService,
  ) {}

  async resolveByPlanId(planId: string, user: AuthUser): Promise<PlanAccess> {
    const plan = await this.prisma.trainingPlan.findUnique({
      where: { id: planId },
      select: {
        id: true,
        coachId: true,
        scope: true,
        category: true,
        published: true,
        student: { select: { id: true, userId: true, unlinkedAt: true } },
      },
    });
    // Plano individual de aluno desvinculado (ou com a conta excluída) some para todos, como o próprio aluno.
    if (!plan || plan.student?.unlinkedAt) throw new NotFoundException('Plano não encontrado');

    const base = { planId: plan.id, coachId: plan.coachId, scope: plan.scope, category: plan.category };
    const denied = () => new ForbiddenException('Você não tem acesso a este plano.');

    if (user.role === 'coach') {
      if (plan.coachId !== user.id) throw denied();
      return {
        ...base,
        isCoach: true,
        studentId: plan.student?.id ?? null,
        athleteId: plan.student?.userId ?? null,
        maxWeek: null,
      };
    }

    if (user.role !== 'athlete') throw denied();

    if (plan.scope === PlanScope.INDIVIDUAL) {
      if (!plan.student || plan.student.userId !== user.id) throw denied();
      await this.subscriptionAccess.assertCanAccessCategory(plan.student.id, plan.category);
      const maxWeek = await this.subscriptionAccess.weekLimit(plan.student.id);
      return { ...base, isCoach: false, studentId: plan.student.id, athleteId: user.id, maxWeek };
    }

    // SHARED: pertence ao coach; o aluno entra pelo vínculo com o coach + assinatura.
    if (!plan.published) throw denied();
    const student = await this.prisma.student.findFirst({
      where: { userId: user.id, coachId: plan.coachId, ...ACTIVE_STUDENT },
      select: { id: true },
    });
    if (!student) throw denied();
    await this.subscriptionAccess.assertCanAccessCategory(student.id, plan.category);
    const maxWeek = await this.subscriptionAccess.weekLimit(student.id);
    return { ...base, isCoach: false, studentId: student.id, athleteId: user.id, maxWeek };
  }

  /** Conteúdo de uma semana além da amostra do Free: 403 (vale para sessão, exercício, finalizar e pular treino). */
  private assertWeekAllowed(access: PlanAccess, weekNumber: number): PlanAccess {
    if (access.maxWeek != null && weekNumber > access.maxWeek) throw new ForbiddenException(SEMANA_BLOQUEADA);
    return access;
  }

  async resolveBySessionId(sessionId: string, user: AuthUser): Promise<PlanAccess> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { day: { select: { week: { select: { planId: true, weekNumber: true } } } } },
    });
    if (!session) throw new NotFoundException('Sessão não encontrada');
    return this.assertWeekAllowed(await this.resolveByPlanId(session.day.week.planId, user), session.day.week.weekNumber);
  }

  async resolveByExerciseId(exerciseId: string, user: AuthUser): Promise<PlanAccess> {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      select: { session: { select: { day: { select: { week: { select: { planId: true, weekNumber: true } } } } } } },
    });
    if (!exercise) throw new NotFoundException('Exercício não encontrado');
    const { week } = exercise.session.day;
    return this.assertWeekAllowed(await this.resolveByPlanId(week.planId, user), week.weekNumber);
  }
}
