import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkoutLogDto } from './dto/create-workout-log.dto';
import { StudentsService } from '../students/students.service';
import { PlanAccessService } from '../subscriptions/plan-access.service';

type AuthUser = { id: string; role: string };

@Injectable()
export class WorkoutLogsService {
  constructor(
    private prisma: PrismaService,
    private studentsService: StudentsService,
    private planAccess: PlanAccessService,
  ) {}

  /** Só o atleta com acesso ao plano do exercício (dono do individual, ou aluno do coach com a categoria liberada no compartilhado) registra o log. */
  async logExercise(user: AuthUser, dto: CreateWorkoutLogDto) {
    const access = await this.planAccess.resolveByExerciseId(dto.exerciseId, user);
    if (access.isCoach) throw new ForbiddenException('Somente o aluno registra a execução do treino.');

    return this.prisma.workoutLog.create({
      data: {
        exerciseId: dto.exerciseId,
        athleteId: user.id,
        setsCompleted: dto.setsCompleted,
        durationSeconds: dto.durationSeconds ?? null,
        notes: dto.notes,
        completedAt: dto.completedAt ? new Date(dto.completedAt) : new Date(),
      },
      include: {
        exercise: { select: { id: true, name: true, sessionId: true } },
      },
    });
  }

  async getHistory(athleteId: string, limit = 50) {
    return this.prisma.workoutLog.findMany({
      where: { athleteId },
      orderBy: { completedAt: 'desc' },
      take: limit,
      include: {
        exercise: {
          select: {
            id: true,
            name: true,
            session: {
              select: {
                id: true,
                name: true,
                type: true,
                day: {
                  select: {
                    dayOfWeek: true,
                    week: { select: { weekNumber: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  /** Histórico de treino de um aluno específico — só o coach dono (ou o próprio atleta). */
  async getStudentHistory(studentId: string, user: AuthUser, limit = 50) {
    const student = await this.studentsService.findOne(studentId, user);
    return this.getHistory(student.userId, limit);
  }

  async getSessionLogs(sessionId: string, athleteId: string) {
    return this.prisma.workoutLog.findMany({
      where: {
        athleteId,
        exercise: { sessionId },
      },
      orderBy: { completedAt: 'desc' },
      include: {
        exercise: { select: { id: true, name: true } },
      },
    });
  }

  async getExerciseHistory(exerciseId: string, athleteId: string) {
    return this.prisma.workoutLog.findMany({
      where: { exerciseId, athleteId },
      orderBy: { completedAt: 'desc' },
      take: 10,
    });
  }
}
