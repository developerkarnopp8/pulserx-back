import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TrainingPlansService } from './training-plans.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlanAccessService } from '../subscriptions/plan-access.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';

/**
 * Cobre o achado 1 da revisão final: `fullPlanInclude` precisa filtrar
 * `workoutLogs`/`workoutSkips` pelo `athleteId` dono do plano — sem isso,
 * dado de outro aluno (log/skip de um exerciseId que não é dele) vazaria
 * no plano visualizado (histórico de IDOR no projeto).
 */
describe('TrainingPlansService — filtro por athleteId em fullPlanInclude', () => {
  let service: TrainingPlansService;
  let prisma: any;

  const athleteUser = { id: 'athlete-1', role: 'athlete' };

  const expectedInclude = (athleteId: string) => ({
    weeks: expect.objectContaining({
      include: expect.objectContaining({
        days: expect.objectContaining({
          include: expect.objectContaining({
            sessions: expect.objectContaining({
              include: expect.objectContaining({
                workoutSkips: expect.objectContaining({ where: { athleteId } }),
                exercises: expect.objectContaining({
                  include: expect.objectContaining({
                    workoutLogs: expect.objectContaining({ where: { athleteId } }),
                    workoutSkips: expect.objectContaining({ where: { athleteId } }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  });

  let planAccess: { resolveByPlanId: jest.Mock };
  let subscriptionAccess: { getViewableCategories: jest.Mock; canAccessCategory: jest.Mock };

  beforeEach(async () => {
    prisma = {
      student: { findUnique: jest.fn() },
      trainingPlan: { findUnique: jest.fn(), findMany: jest.fn() },
    };
    planAccess = { resolveByPlanId: jest.fn() };
    subscriptionAccess = {
      getViewableCategories: jest.fn().mockResolvedValue(['CORE', 'LPO', 'PERFORMANCE']),
      canAccessCategory: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        TrainingPlansService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        { provide: PlanAccessService, useValue: planAccess },
        { provide: SubscriptionAccessService, useValue: subscriptionAccess },
      ],
    }).compile();

    service = module.get(TrainingPlansService);
  });

  it('findByStudent (aluno) filtra workoutLogs/workoutSkips pelo userId do aluno dono (não pelo id de quem pediu)', async () => {
    prisma.student.findUnique.mockResolvedValue({ coachId: 'coach-1', userId: 'athlete-1' });
    prisma.trainingPlan.findMany.mockResolvedValue([]);

    await service.findByStudent('student-1', athleteUser);

    expect(prisma.trainingPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: expectedInclude('athlete-1') }),
    );
  });

  it('findByStudent (coach dono) lista só os planos individuais do aluno, com o progresso do aluno', async () => {
    prisma.student.findUnique.mockResolvedValue({ coachId: 'coach-1', userId: 'athlete-1' });
    prisma.trainingPlan.findMany.mockResolvedValue([]);

    await service.findByStudent('student-1', { id: 'coach-1', role: 'coach' });

    expect(prisma.trainingPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { studentId: 'student-1' }, include: expectedInclude('athlete-1') }),
    );
  });

  it('findByStudent (aluno) inclui os planos compartilhados PUBLICADOS do coach dele, só nas categorias liberadas', async () => {
    prisma.student.findUnique.mockResolvedValue({ coachId: 'coach-1', userId: 'athlete-1' });
    prisma.trainingPlan.findMany.mockResolvedValue([]);
    subscriptionAccess.getViewableCategories.mockResolvedValue(['LPO']);

    await service.findByStudent('student-1', athleteUser);

    expect(subscriptionAccess.getViewableCategories).toHaveBeenCalledWith('student-1');
    expect(prisma.trainingPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          category: { in: ['LPO'] },
          OR: [
            { studentId: 'student-1', scope: 'INDIVIDUAL' },
            { scope: 'SHARED', published: true, coachId: 'coach-1' },
          ],
        },
      }),
    );
  });

  it('findByStudent nega acesso a quem não é o coach dono nem o próprio aluno', async () => {
    prisma.student.findUnique.mockResolvedValue({ coachId: 'coach-1', userId: 'athlete-1' });

    await expect(
      service.findByStudent('student-1', { id: 'intruso', role: 'athlete' }),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.trainingPlan.findMany).not.toHaveBeenCalled();
  });

  it('findByStudent lança NotFoundException quando o aluno não existe', async () => {
    prisma.student.findUnique.mockResolvedValue(null);
    await expect(service.findByStudent('x', athleteUser)).rejects.toThrow(NotFoundException);
  });

  it('findById filtra workoutLogs/workoutSkips pelo aluno dono do plano individual, mesmo quando é o coach que consulta', async () => {
    const coachUser = { id: 'coach-1', role: 'coach' };
    planAccess.resolveByPlanId.mockResolvedValue({ athleteId: 'athlete-1' });
    prisma.trainingPlan.findUnique.mockResolvedValue({ id: 'plan-1' });

    await service.findById('plan-1', coachUser);

    expect(planAccess.resolveByPlanId).toHaveBeenCalledWith('plan-1', coachUser);
    expect(prisma.trainingPlan.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({ include: expectedInclude('athlete-1') }),
    );
  });

  it('findById num plano compartilhado visto pelo coach filtra pelo id do coach (nunca traz progresso de aluno)', async () => {
    planAccess.resolveByPlanId.mockResolvedValue({ athleteId: null });
    prisma.trainingPlan.findUnique.mockResolvedValue({ id: 'plan-1' });

    await service.findById('plan-1', { id: 'coach-1', role: 'coach' });

    expect(prisma.trainingPlan.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({ include: expectedInclude('coach-1') }),
    );
  });

  it('findById propaga o Forbidden do acesso sem ler o plano', async () => {
    planAccess.resolveByPlanId.mockRejectedValue(new ForbiddenException());

    await expect(service.findById('plan-1', athleteUser)).rejects.toThrow(ForbiddenException);
    expect(prisma.trainingPlan.findUnique).not.toHaveBeenCalled();
  });

  it('findById lança NotFoundException quando o plano some entre a checagem e a leitura', async () => {
    planAccess.resolveByPlanId.mockResolvedValue({ athleteId: 'athlete-1' });
    prisma.trainingPlan.findUnique.mockResolvedValue(null);

    await expect(service.findById('plano-inexistente', athleteUser)).rejects.toThrow(NotFoundException);
  });

  it('findSharedByCoach lista só os SHARED do próprio coach, com filtro opcional de categoria', async () => {
    prisma.trainingPlan.findMany.mockResolvedValue([]);

    await service.findSharedByCoach('coach-1');
    expect(prisma.trainingPlan.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { coachId: 'coach-1', scope: 'SHARED' } }),
    );

    await service.findSharedByCoach('coach-1', 'CORE' as any);
    expect(prisma.trainingPlan.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { coachId: 'coach-1', scope: 'SHARED', category: 'CORE' } }),
    );
  });
});

/**
 * Dashboard do coach mostrava um gráfico de "Taxa de Conclusão" 100%
 * hardcoded (array literal fixo, sem nenhuma ligação com dado real) —
 * reportado pelo usuário testando local. getWeeklyCompletionByDayIndex
 * agrega, por dia da semana (dayIndex 0-6), o % real de exercícios
 * concluídos (com WorkoutLog) entre TODOS os alunos do coach, na semana
 * atual de cada um.
 */
describe('TrainingPlansService.getWeeklyCompletionByDayIndex', () => {
  let service: TrainingPlansService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      student: { findMany: jest.fn() },
      week: { findFirst: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [
        TrainingPlansService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        { provide: PlanAccessService, useValue: { resolveByPlanId: jest.fn() } },
        { provide: SubscriptionAccessService, useValue: { getViewableCategories: jest.fn(), canAccessCategory: jest.fn() } },
      ],
    }).compile();

    service = module.get(TrainingPlansService);
  });

  it('agrega exercícios concluídos vs total por dayIndex, entre múltiplos alunos', async () => {
    prisma.student.findMany.mockResolvedValue([
      { id: 'student-1', userId: 'athlete-1', currentMonth: 2, currentWeek: 2 },
      { id: 'student-2', userId: 'athlete-2', currentMonth: 1, currentWeek: 3 },
    ]);

    prisma.week.findFirst
      .mockResolvedValueOnce({
        days: [
          {
            dayIndex: 1,
            sessions: [
              { exercises: [{ workoutLogs: [{ id: 'log-1' }] }, { workoutLogs: [] }] },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        days: [
          {
            dayIndex: 1,
            sessions: [{ exercises: [{ workoutLogs: [{ id: 'log-2' }] }] }],
          },
        ],
      });

    const result = await service.getWeeklyCompletionByDayIndex('coach-1');

    // dayIndex 1: student-1 (1/2 feito) + student-2 (1/1 feito) = 2/3 = 67%
    expect(result.find(r => r.dayIndex === 1)).toEqual({ dayIndex: 1, percent: 67 });
    // demais dias sem exercício nenhum agregado -> 0%
    expect(result.find(r => r.dayIndex === 0)).toEqual({ dayIndex: 0, percent: 0 });
    expect(result).toHaveLength(7);
  });

  it('filtra workoutLogs pelo athleteId (userId) do próprio aluno dono do plano', async () => {
    prisma.student.findMany.mockResolvedValue([
      { id: 'student-1', userId: 'athlete-1', currentMonth: 2, currentWeek: 2 },
    ]);
    prisma.week.findFirst.mockResolvedValue({ days: [] });

    await service.getWeeklyCompletionByDayIndex('coach-1');

    expect(prisma.week.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { weekNumber: 2, plan: { studentId: 'student-1', month: 2 } },
        include: expect.objectContaining({
          days: expect.objectContaining({
            include: expect.objectContaining({
              sessions: expect.objectContaining({
                include: expect.objectContaining({
                  exercises: expect.objectContaining({
                    include: { workoutLogs: { where: { athleteId: 'athlete-1' }, select: { id: true } } },
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    );
  });

  it('pula aluno sem semana atual encontrada (plano não inicializado), sem quebrar', async () => {
    prisma.student.findMany.mockResolvedValue([
      { id: 'student-1', userId: 'athlete-1', currentMonth: 5, currentWeek: 1 },
    ]);
    prisma.week.findFirst.mockResolvedValue(null);

    const result = await service.getWeeklyCompletionByDayIndex('coach-1');

    expect(result).toHaveLength(7);
    expect(result.every(r => r.percent === 0)).toBe(true);
  });

  it('retorna 0% em todos os dias quando o coach não tem alunos', async () => {
    prisma.student.findMany.mockResolvedValue([]);

    const result = await service.getWeeklyCompletionByDayIndex('coach-1');

    expect(result).toEqual([0, 1, 2, 3, 4, 5, 6].map(dayIndex => ({ dayIndex, percent: 0 })));
  });
});

describe('TrainingPlansService.create — normalização de startDate', () => {
  let service: TrainingPlansService;
  let prisma: any;

  beforeEach(async () => {
    const txPlan = { id: 'plan-1' };
    const tx = {
      trainingPlan: {
        create: jest.fn().mockResolvedValue(txPlan),
        findUnique: jest.fn().mockResolvedValue({ id: 'plan-1', weeks: [] }),
      },
      week: { create: jest.fn().mockResolvedValue({ id: 'week-1' }) },
      trainingDay: { createMany: jest.fn() },
    };
    prisma = {
      student: { findUnique: jest.fn().mockResolvedValue({ userId: 'athlete-1', coachId: 'coach-1' }) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      __tx: tx,
    };

    const module = await Test.createTestingModule({
      providers: [
        TrainingPlansService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        { provide: PlanAccessService, useValue: { resolveByPlanId: jest.fn() } },
        { provide: SubscriptionAccessService, useValue: { getViewableCategories: jest.fn(), canAccessCategory: jest.fn() } },
      ],
    }).compile();

    service = module.get(TrainingPlansService);
  });

  it('normaliza uma quarta-feira (2026-03-11) pra a segunda-feira da mesma semana (2026-03-09)', async () => {
    await service.create('coach-1', {
      studentId: 'student-1', month: 1, title: 'Mesociclo 1', startDate: '2026-03-11',
    } as any);

    const dataGravada = prisma.__tx.trainingPlan.create.mock.calls[0][0].data;
    expect(dataGravada.startDate.toISOString().slice(0, 10)).toBe('2026-03-09');
  });

  it('mantém uma segunda-feira (2026-03-09) igual', async () => {
    await service.create('coach-1', {
      studentId: 'student-1', month: 1, title: 'Mesociclo 1', startDate: '2026-03-09',
    } as any);

    const dataGravada = prisma.__tx.trainingPlan.create.mock.calls[0][0].data;
    expect(dataGravada.startDate.toISOString().slice(0, 10)).toBe('2026-03-09');
  });

  it('normaliza um domingo (2026-03-15) pra a segunda-feira ANTERIOR (2026-03-09), não a próxima', async () => {
    await service.create('coach-1', {
      studentId: 'student-1', month: 1, title: 'Mesociclo 1', startDate: '2026-03-15',
    } as any);

    const dataGravada = prisma.__tx.trainingPlan.create.mock.calls[0][0].data;
    expect(dataGravada.startDate.toISOString().slice(0, 10)).toBe('2026-03-09');
  });
});

describe('TrainingPlansService.create — checagem de dono do aluno', () => {
  let service: TrainingPlansService;
  let prisma: any;

  beforeEach(async () => {
    const tx = {
      trainingPlan: {
        create: jest.fn().mockResolvedValue({ id: 'plan-1' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'plan-1', weeks: [] }),
      },
      week: { create: jest.fn().mockResolvedValue({ id: 'week-1' }) },
      trainingDay: { createMany: jest.fn() },
    };
    prisma = {
      student: { findUnique: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      __tx: tx,
    };

    const module = await Test.createTestingModule({
      providers: [
        TrainingPlansService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        { provide: PlanAccessService, useValue: { resolveByPlanId: jest.fn() } },
        { provide: SubscriptionAccessService, useValue: { getViewableCategories: jest.fn(), canAccessCategory: jest.fn() } },
      ],
    }).compile();

    service = module.get(TrainingPlansService);
  });

  it('cria o plano quando o aluno pertence ao coach autenticado', async () => {
    prisma.student.findUnique.mockResolvedValue({ userId: 'athlete-1', coachId: 'coach-1' });

    await service.create('coach-1', {
      studentId: 'student-1', month: 1, title: 'Mesociclo 1', startDate: '2026-03-09',
    } as any);

    expect(prisma.__tx.trainingPlan.create).toHaveBeenCalled();
  });

  it('rejeita com ForbiddenException quando o aluno pertence a OUTRO coach (IDOR)', async () => {
    const { ForbiddenException } = await import('@nestjs/common');
    prisma.student.findUnique.mockResolvedValue({ userId: 'athlete-1', coachId: 'coach-9' });

    await expect(
      service.create('coach-1', {
        studentId: 'student-1', month: 1, title: 'Mesociclo 1', startDate: '2026-03-09',
      } as any),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.__tx.trainingPlan.create).not.toHaveBeenCalled();
  });
});

describe('TrainingPlansService.publish — notifica', () => {
  let service: TrainingPlansService;
  let prisma: any;
  let notificationsService: { create: jest.Mock };
  let subscriptionAccess: { filterStudentsWithCategory: jest.Mock };

  beforeEach(async () => {
    prisma = {
      student: { findMany: jest.fn() },
      trainingPlan: {
        findUnique: jest.fn().mockResolvedValue({ coachId: 'coach-1' }),
        update: jest.fn().mockResolvedValue({
          id: 'plan-1',
          title: 'Mesociclo 1',
          scope: 'INDIVIDUAL',
          category: 'PERFORMANCE',
          student: { userId: 'athlete-1' },
        }),
      },
    };
    notificationsService = { create: jest.fn() };
    subscriptionAccess = { filterStudentsWithCategory: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        TrainingPlansService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: PlanAccessService, useValue: { resolveByPlanId: jest.fn() } },
        { provide: SubscriptionAccessService, useValue: subscriptionAccess },
      ],
    }).compile();

    service = module.get(TrainingPlansService);
  });

  it('notifica o atleta dono do plano individual quando o coach publica', async () => {
    await service.publish('plan-1', 'coach-1');

    expect(notificationsService.create).toHaveBeenCalledWith(
      'athlete-1',
      'plan_published',
      'Novo plano publicado',
      'Seu coach publicou "Mesociclo 1"',
      '/athlete/weekly',
    );
    expect(prisma.student.findMany).not.toHaveBeenCalled();
  });

  it('plano compartilhado: notifica só os alunos do coach que enxergam a categoria', async () => {
    prisma.trainingPlan.update.mockResolvedValue({
      id: 'plan-2', title: 'Core — Março', scope: 'SHARED', category: 'CORE', student: null,
    });
    prisma.student.findMany.mockResolvedValue([
      { id: 's1', userId: 'u1' },
      { id: 's2', userId: 'u2' },
    ]);
    subscriptionAccess.filterStudentsWithCategory.mockResolvedValue(['s1']);

    await service.publish('plan-2', 'coach-1');

    expect(prisma.student.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { coachId: 'coach-1' } }));
    expect(subscriptionAccess.filterStudentsWithCategory).toHaveBeenCalledWith(['s1', 's2'], 'CORE');
    expect(notificationsService.create).toHaveBeenCalledTimes(1);
    expect(notificationsService.create).toHaveBeenCalledWith(
      'u1', 'plan_published', 'Novo plano publicado', 'Seu coach publicou "Core — Março"', '/athlete/weekly',
    );
  });

  it('plano compartilhado: notifica em lotes de 25 (sem estourar o pool do banco)', async () => {
    prisma.trainingPlan.update.mockResolvedValue({
      id: 'plan-2', title: 'Core', scope: 'SHARED', category: 'CORE', student: null,
    });
    const students = Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, userId: `u${i}` }));
    prisma.student.findMany.mockResolvedValue(students);
    subscriptionAccess.filterStudentsWithCategory.mockResolvedValue(students.map(s => s.id));

    let inFlight = 0;
    let maxInFlight = 0;
    notificationsService.create.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 1));
      inFlight--;
    });

    await service.publish('plan-2', 'coach-1');

    expect(notificationsService.create).toHaveBeenCalledTimes(60);
    expect(maxInFlight).toBeLessThanOrEqual(25);
  });

  it('nega publicar plano de outro coach (IDOR) sem notificar ninguém', async () => {
    prisma.trainingPlan.findUnique.mockResolvedValue({ coachId: 'coach-9' });

    await expect(service.publish('plan-1', 'coach-1')).rejects.toThrow(ForbiddenException);
    expect(prisma.trainingPlan.update).not.toHaveBeenCalled();
    expect(notificationsService.create).not.toHaveBeenCalled();
  });
});

describe('TrainingPlansService.createShared', () => {
  let service: TrainingPlansService;
  let prisma: any;
  let tx: any;

  beforeEach(async () => {
    tx = {
      trainingPlan: {
        create: jest.fn().mockResolvedValue({ id: 'plan-1' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'plan-1' }),
      },
      week: { create: jest.fn().mockResolvedValue({ id: 'week-1' }) },
      trainingDay: { createMany: jest.fn() },
    };
    prisma = { $transaction: jest.fn(async (cb: any) => cb(tx)) };

    const module = await Test.createTestingModule({
      providers: [
        TrainingPlansService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        { provide: PlanAccessService, useValue: { resolveByPlanId: jest.fn() } },
        { provide: SubscriptionAccessService, useValue: { getViewableCategories: jest.fn(), canAccessCategory: jest.fn() } },
      ],
    }).compile();
    service = module.get(TrainingPlansService);
  });

  it('cria plano SHARED do coach, sem aluno, com a categoria pedida e 4 semanas × 6 dias', async () => {
    await service.createShared('coach-1', { category: 'LPO', month: 1, title: 'LPO — Março', startDate: '2026-03-11' } as any);

    const data = tx.trainingPlan.create.mock.calls[0][0].data;
    expect(data).toEqual({
      coachId: 'coach-1',
      scope: 'SHARED',
      category: 'LPO',
      month: 1,
      title: 'LPO — Março',
      startDate: expect.any(Date),
    });
    expect(data.startDate.toISOString().slice(0, 10)).toBe('2026-03-09');
    expect(data).not.toHaveProperty('studentId');
    expect(tx.week.create).toHaveBeenCalledTimes(4);
    expect(tx.trainingDay.createMany).toHaveBeenCalledTimes(4);
  });

  it('o coach é sempre o do token — nada vindo do body define dono/escopo', async () => {
    await service.createShared('coach-1', {
      category: 'CORE', month: 1, title: 'x', startDate: '2026-03-09', coachId: 'coach-9', scope: 'INDIVIDUAL', studentId: 's1',
    } as any);

    const data = tx.trainingPlan.create.mock.calls[0][0].data;
    expect(data.coachId).toBe('coach-1');
    expect(data.scope).toBe('SHARED');
    expect(data).not.toHaveProperty('studentId');
  });
});

describe('TrainingPlansService.initializeWeeks — progresso exibido', () => {
  let service: TrainingPlansService;
  let prisma: any;
  let planAccess: { resolveByPlanId: jest.Mock };

  beforeEach(async () => {
    prisma = {
      trainingPlan: { findUnique: jest.fn() },
      week: { count: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'w' }) },
      trainingDay: { createMany: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    planAccess = { resolveByPlanId: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        TrainingPlansService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        { provide: PlanAccessService, useValue: planAccess },
        { provide: SubscriptionAccessService, useValue: { getViewableCategories: jest.fn(), canAccessCategory: jest.fn() } },
      ],
    }).compile();
    service = module.get(TrainingPlansService);
  });

  it('plano individual já inicializado: devolve com o progresso do aluno', async () => {
    prisma.trainingPlan.findUnique
      .mockResolvedValueOnce({ coachId: 'coach-1' }) // assertCoachOwnsPlan
      .mockResolvedValueOnce({ id: 'plan-1' });
    planAccess.resolveByPlanId.mockResolvedValue({ athleteId: 'athlete-1' });
    prisma.week.count.mockResolvedValue(4);

    await service.initializeWeeks('plan-1', 'coach-1');

    expect(planAccess.resolveByPlanId).toHaveBeenCalledWith('plan-1', { id: 'coach-1', role: 'coach' });
    expect(prisma.trainingPlan.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({ include: expect.objectContaining({ weeks: expect.anything() }) }),
    );
    expect(prisma.week.create).not.toHaveBeenCalled();
  });

  it('plano compartilhado sem semanas: cria 4 × 6 e usa o id do coach como filtro (sem progresso)', async () => {
    prisma.trainingPlan.findUnique
      .mockResolvedValueOnce({ coachId: 'coach-1' })
      .mockResolvedValueOnce({ id: 'plan-s' });
    planAccess.resolveByPlanId.mockResolvedValue({ athleteId: null });
    prisma.week.count.mockResolvedValue(0);

    await service.initializeWeeks('plan-s', 'coach-1');

    expect(prisma.week.create).toHaveBeenCalledTimes(4);
    expect(prisma.trainingDay.createMany).toHaveBeenCalledTimes(4);
  });

  it('coach de outro plano: barrado antes de qualquer escrita', async () => {
    prisma.trainingPlan.findUnique.mockResolvedValueOnce({ coachId: 'coach-9' });
    await expect(service.initializeWeeks('plan-s', 'coach-1')).rejects.toThrow(ForbiddenException);
    expect(prisma.week.create).not.toHaveBeenCalled();
  });
});
