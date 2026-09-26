import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanAccessService } from '../subscriptions/plan-access.service';

type AuthUser = { id: string; role: string };

@Injectable()
export class SessionsService {
  constructor(
    private prisma: PrismaService,
    private planAccess: PlanAccessService,
  ) {}

  async findById(id: string, user: AuthUser) {
    // Autoriza ANTES de trazer qualquer dado (histórico de IDOR no projeto): coach dono do plano,
    // aluno dono do plano individual, ou aluno do coach com a categoria liberada no plano compartilhado.
    const access = await this.planAccess.resolveBySessionId(id, user);

    // athleteId = de quem é o progresso exibido. Coach num plano individual vê o do aluno; coach num
    // plano compartilhado não tem progresso próprio (o filtro vira o dele mesmo e volta vazio).
    // Filtrar sempre evita vazar skip/log de outro aluno num plano compartilhado.
    const athleteId = access.athleteId ?? user.id;
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: {
        workoutSkips: { where: { athleteId }, orderBy: { createdAt: 'desc' }, take: 1 },
        exercises: {
          orderBy: { order: 'asc' },
          include: {
            workoutLogs: {
              where: { athleteId: user.id },
              orderBy: { completedAt: 'desc' },
              take: 1,
            },
            workoutSkips: { where: { athleteId }, orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
        day: {
          include: {
            week: {
              include: {
                plan: {
                  select: {
                    id: true,
                    title: true,
                    coachId: true,
                    student: { select: { userId: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!session) throw new NotFoundException('Sessão não encontrada');

    return session;
  }

  async findByDay(dayId: string) {
    return this.prisma.session.findMany({
      where: { dayId },
      orderBy: { order: 'asc' },
      include: {
        exercises: { orderBy: { order: 'asc' } },
      },
    });
  }
}
