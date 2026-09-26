import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PlanScope, TrainingCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessService } from './subscription-access.service';

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
};

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
        student: { select: { id: true, userId: true } },
      },
    });
    if (!plan) throw new NotFoundException('Plano não encontrado');

    const base = { planId: plan.id, coachId: plan.coachId, scope: plan.scope, category: plan.category };
    const denied = () => new ForbiddenException('Você não tem acesso a este plano.');

    if (user.role === 'coach') {
      if (plan.coachId !== user.id) throw denied();
      return {
        ...base,
        isCoach: true,
        studentId: plan.student?.id ?? null,
        athleteId: plan.student?.userId ?? null,
      };
    }

    if (user.role !== 'athlete') throw denied();

    if (plan.scope === PlanScope.INDIVIDUAL) {
      if (!plan.student || plan.student.userId !== user.id) throw denied();
      await this.subscriptionAccess.assertCanAccessCategory(plan.student.id, plan.category);
      return { ...base, isCoach: false, studentId: plan.student.id, athleteId: user.id };
    }

    // SHARED: pertence ao coach; o aluno entra pelo vínculo com o coach + assinatura.
    if (!plan.published) throw denied();
    const student = await this.prisma.student.findFirst({
      where: { userId: user.id, coachId: plan.coachId },
      select: { id: true },
    });
    if (!student) throw denied();
    await this.subscriptionAccess.assertCanAccessCategory(student.id, plan.category);
    return { ...base, isCoach: false, studentId: student.id, athleteId: user.id };
  }

  async resolveBySessionId(sessionId: string, user: AuthUser): Promise<PlanAccess> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { day: { select: { week: { select: { planId: true } } } } },
    });
    if (!session) throw new NotFoundException('Sessão não encontrada');
    return this.resolveByPlanId(session.day.week.planId, user);
  }

  async resolveByExerciseId(exerciseId: string, user: AuthUser): Promise<PlanAccess> {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      select: { session: { select: { day: { select: { week: { select: { planId: true } } } } } } },
    });
    if (!exercise) throw new NotFoundException('Exercício não encontrado');
    return this.resolveByPlanId(exercise.session.day.week.planId, user);
  }
}
