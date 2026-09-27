import { Test } from '@nestjs/testing';
import { WorkoutLogsService } from './workout-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { PlanAccessService } from '../subscriptions/plan-access.service';

describe('WorkoutLogsService.getStudentHistory', () => {
  let service: WorkoutLogsService;
  let prisma: any;
  let studentsService: { findOne: jest.Mock };

  const coachUser = { id: 'coach-1', role: 'coach' };
  const student = { id: 'student-1', userId: 'athlete-1', coachId: 'coach-1' };

  beforeEach(async () => {
    prisma = { workoutLog: { findMany: jest.fn().mockResolvedValue([]) } };
    studentsService = { findOne: jest.fn().mockResolvedValue(student) };
    const module = await Test.createTestingModule({
      providers: [
        WorkoutLogsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: studentsService },
        { provide: PlanAccessService, useValue: { resolveByExerciseId: jest.fn() } },
      ],
    }).compile();
    service = module.get(WorkoutLogsService);
  });

  it('checa dono do aluno antes de retornar o histórico', async () => {
    await service.getStudentHistory('student-1', coachUser, 50);

    expect(studentsService.findOne).toHaveBeenCalledWith('student-1', coachUser);
    expect(prisma.workoutLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { athleteId: 'athlete-1' },
        take: 50,
      }),
    );
  });

  it('propaga ForbiddenException quando o coach não é dono do aluno, sem buscar nada', async () => {
    const { ForbiddenException } = await import('@nestjs/common');
    studentsService.findOne.mockRejectedValue(new ForbiddenException());

    await expect(
      service.getStudentHistory('student-1', coachUser, 50),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.workoutLog.findMany).not.toHaveBeenCalled();
  });

  it('usa o limit default de 50 quando não informado', async () => {
    await service.getStudentHistory('student-1', coachUser);

    expect(prisma.workoutLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });
});

describe('WorkoutLogsService.logExercise', () => {
  let service: WorkoutLogsService;
  let prisma: any;
  let planAccess: { resolveByExerciseId: jest.Mock };

  const athleteUser = { id: 'athlete-1', role: 'athlete' };
  const dto = { exerciseId: 'exercise-1', setsCompleted: 3, notes: undefined, completedAt: undefined };
  const athleteAccess = { isCoach: false, athleteId: 'athlete-1', studentId: 'student-1', coachId: 'coach-1' };

  beforeEach(async () => {
    prisma = { workoutLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) } };
    planAccess = { resolveByExerciseId: jest.fn().mockResolvedValue(athleteAccess) };
    const module = await Test.createTestingModule({
      providers: [
        WorkoutLogsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: { findOne: jest.fn() } },
        { provide: PlanAccessService, useValue: planAccess },
      ],
    }).compile();
    service = module.get(WorkoutLogsService);
  });

  it('confere o acesso ao plano do exercício antes de gravar, com o athleteId de quem pediu', async () => {
    await service.logExercise(athleteUser, dto as any);

    expect(planAccess.resolveByExerciseId).toHaveBeenCalledWith('exercise-1', athleteUser);
    expect(prisma.workoutLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ exerciseId: 'exercise-1', athleteId: 'athlete-1' }),
      }),
    );
  });

  it('propaga NotFound/Forbidden do acesso (exercício inexistente, plano de outro aluno, categoria não liberada) sem gravar', async () => {
    const { NotFoundException, ForbiddenException } = await import('@nestjs/common');
    planAccess.resolveByExerciseId.mockRejectedValueOnce(new NotFoundException());
    await expect(service.logExercise(athleteUser, dto as any)).rejects.toThrow(NotFoundException);

    planAccess.resolveByExerciseId.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.logExercise(athleteUser, dto as any)).rejects.toThrow(ForbiddenException);

    expect(prisma.workoutLog.create).not.toHaveBeenCalled();
  });

  it('nega o coach: quem registra a execução é o aluno (o log nunca fica no id do coach)', async () => {
    const { ForbiddenException } = await import('@nestjs/common');
    planAccess.resolveByExerciseId.mockResolvedValueOnce({ ...athleteAccess, isCoach: true });

    await expect(service.logExercise({ id: 'coach-1', role: 'coach' }, dto as any)).rejects.toThrow(ForbiddenException);
    expect(prisma.workoutLog.create).not.toHaveBeenCalled();
  });

  it('grava durationSeconds quando informado no dto', async () => {
    await service.logExercise(athleteUser, { ...dto, durationSeconds: 95 } as any);

    expect(prisma.workoutLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ durationSeconds: 95 }),
      }),
    );
  });

  it('usa a data informada no dto (completedAt), não a data atual', async () => {
    await service.logExercise(athleteUser, { ...dto, completedAt: '2026-01-05T10:00:00.000Z' } as any);
    expect(prisma.workoutLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ completedAt: new Date('2026-01-05T10:00:00.000Z') }) }),
    );
  });

  it('grava durationSeconds como null quando ausente', async () => {
    await service.logExercise(athleteUser, dto as any);

    expect(prisma.workoutLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ durationSeconds: null }),
      }),
    );
  });
});

describe('WorkoutLogsService.getHistory / getSessionLogs / getExerciseHistory', () => {
  let service: WorkoutLogsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { workoutLog: { findMany: jest.fn().mockResolvedValue([]) } };
    const module = await Test.createTestingModule({
      providers: [
        WorkoutLogsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StudentsService, useValue: { findOne: jest.fn() } },
        { provide: PlanAccessService, useValue: { resolveByExerciseId: jest.fn() } },
      ],
    }).compile();
    service = module.get(WorkoutLogsService);
  });

  it('getHistory filtra por athleteId e ordena por completedAt desc, com limit', async () => {
    await service.getHistory('athlete-1', 20);
    expect(prisma.workoutLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { athleteId: 'athlete-1' }, orderBy: { completedAt: 'desc' }, take: 20,
    }));
  });

  it('getHistory sem limit usa o default de 50', async () => {
    await service.getHistory('athlete-1');
    expect(prisma.workoutLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  it('getSessionLogs filtra pelo athleteId e pelo exercise.sessionId', async () => {
    await service.getSessionLogs('session-1', 'athlete-1');
    expect(prisma.workoutLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { athleteId: 'athlete-1', exercise: { sessionId: 'session-1' } },
    }));
  });

  it('getExerciseHistory filtra por exerciseId + athleteId, últimos 10', async () => {
    await service.getExerciseHistory('ex-1', 'athlete-1');
    expect(prisma.workoutLog.findMany).toHaveBeenCalledWith({
      where: { exerciseId: 'ex-1', athleteId: 'athlete-1' },
      orderBy: { completedAt: 'desc' },
      take: 10,
    });
  });
});
