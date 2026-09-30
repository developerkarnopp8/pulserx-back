import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanAccessService } from '../subscriptions/plan-access.service';
import { MessagesService } from '../messages/messages.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateWorkoutSkipDto } from './dto/create-workout-skip.dto';
import { buildSkipMessage } from './skip-message';

type AuthUser = { id: string; role: string };

@Injectable()
export class WorkoutSkipsService {
  constructor(
    private prisma: PrismaService,
    private planAccess: PlanAccessService,
    private messagesService: MessagesService,
    private notificationsService: NotificationsService,
  ) {}

  async create(dto: CreateWorkoutSkipDto, user: AuthUser) {
    if ((!dto.exerciseId && !dto.sessionId) || (dto.exerciseId && dto.sessionId)) {
      throw new BadRequestException('Informe exatamente um entre exerciseId ou sessionId.');
    }

    const target = dto.exerciseId
      ? await this.loadExerciseContext(dto.exerciseId)
      : await this.loadSessionContext(dto.sessionId!);

    const access = await this.planAccess.resolveByPlanId(target.planId, user);
    if (access.isCoach) throw new ForbiddenException('Somente o aluno pula treino.');

    // Observação vazia ou só com espaços = sem observação (não é dado de saúde e não se grava texto vazio).
    const note = dto.note?.trim() || undefined;

    // "Lesão / dor" e a observação livre são dado de saúde (LGPD Art. 11): só com o consentimento do aluno.
    if (dto.reason === 'Injury' || note) {
      const conta = await this.prisma.user.findUnique({ where: { id: user.id }, select: { healthConsent: true } });
      if (conta?.healthConsent !== true) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'HEALTH_CONSENT_REQUIRED',
          message: 'Para registrar lesão ou observação, ative o compartilhamento de dados de saúde no seu perfil.',
        });
      }
    }

    const skip = await this.prisma.workoutSkip.create({
      data: {
        exerciseId: dto.exerciseId,
        sessionId: dto.sessionId,
        athleteId: user.id,
        reason: dto.reason,
        note,
        decision: dto.decision,
      },
    });

    const content = buildSkipMessage({ name: target.name, reason: dto.reason, decision: dto.decision, note });
    await this.messagesService.send(user.id, access.coachId, content, true);
    await this.notificationsService.create(
      access.coachId,
      'workout_skipped',
      'Aluno pulou um treino',
      content,
      `/coach/plan-builder/${access.studentId}`,
    );

    return skip;
  }

  private async loadExerciseContext(exerciseId: string) {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      include: { session: { include: { day: { include: { week: { include: { plan: true } } } } } } },
    });
    if (!exercise) throw new NotFoundException('Exercício não encontrado');
    return { name: exercise.name, planId: exercise.session.day.week.planId };
  }

  private async loadSessionContext(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { day: { include: { week: { include: { plan: true } } } } },
    });
    if (!session) throw new NotFoundException('Sessão não encontrada');
    return { name: session.name, planId: session.day.week.planId };
  }

  async getPendingCountByStudent(coachId: string) {
    const skips = await this.prisma.workoutSkip.findMany({
      where: {
        decision: 'Postponed',
        OR: [
          {
            exercise: {
              workoutLogs: { none: {} },
              session: { day: { week: { plan: { coachId } } } },
            },
          },
          {
            session: {
              exercises: { some: { workoutLogs: { none: {} } } },
              day: { week: { plan: { coachId } } },
            },
          },
        ],
      },
      select: { exerciseId: true, sessionId: true, athleteId: true },
    });

    // Quem pulou é sempre o aluno (skip.athleteId) — vale para plano individual e compartilhado
    // (que não tem studentId). Só entram alunos deste coach.
    const students = await this.prisma.student.findMany({
      where: { coachId },
      select: { id: true, userId: true },
    });
    const studentIdByUser = new Map(students.map(s => [s.userId, s.id]));

    // Um mesmo exercício/sessão pode ter sido pulado várias vezes (o item continua
    // pendente até ser feito) — dedupe por alvo (exerciseId ?? sessionId) pra cada
    // aluno contar no máximo 1 vez no badge de pendências.
    const targetsByStudent = new Map<string, Set<string>>();
    for (const skip of skips) {
      const studentId = studentIdByUser.get(skip.athleteId);
      const targetKey = skip.exerciseId ?? skip.sessionId;
      if (!studentId || !targetKey) continue;
      if (!targetsByStudent.has(studentId)) targetsByStudent.set(studentId, new Set());
      targetsByStudent.get(studentId)!.add(targetKey);
    }

    return Array.from(targetsByStudent, ([studentId, targets]) => ({ studentId, count: targets.size }));
  }
}
