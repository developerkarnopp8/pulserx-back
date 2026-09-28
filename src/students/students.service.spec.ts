import { Test } from '@nestjs/testing';
import { StudentsService } from './students.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * completionPercent era uma coluna estática do banco (@default(0), nunca
 * recalculada em lugar nenhum — na prática ficou travada no valor de seed
 * "68" migrado do antigo db.json mock) — reportado pelo usuário ("E o dash
 * do coach esta 68") vendo o número não bater com o progresso real do
 * atleta. Agora é computado dinamicamente a partir dos exercícios com
 * WorkoutLog no plano do mês atual do aluno.
 */
describe('StudentsService.findAll — completionPercent computado dinamicamente', () => {
  let service: StudentsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      student: { findMany: jest.fn() },
      trainingPlan: { findFirst: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [StudentsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(StudentsService);
  });

  it('calcula o % real de exercícios concluídos no plano do mês atual do aluno', async () => {
    prisma.student.findMany.mockResolvedValue([
      { id: 'student-1', userId: 'athlete-1', currentMonth: 2, completionPercent: 68 },
    ]);
    prisma.trainingPlan.findFirst.mockResolvedValue({
      weeks: [
        {
          days: [
            {
              sessions: [
                { exercises: [{ workoutLogs: [{ id: 'log-1' }] }, { workoutLogs: [] }] },
                { exercises: [{ workoutLogs: [{ id: 'log-2' }] }] },
              ],
            },
          ],
        },
      ],
    });

    const result = await service.findAll('coach-1');

    // 2 de 3 exercicios com log = 67%
    expect(result[0].completionPercent).toBe(67);
    expect(prisma.trainingPlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { studentId: 'student-1', month: 2 } }),
    );
  });

  it('a seleção nunca inclui cpf/asaasCustomerId (listagem do coach não precisa disso)', async () => {
    prisma.student.findMany.mockResolvedValue([]);
    await service.findAll('coach-1');
    const select = prisma.student.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('cpf');
    expect(select).not.toHaveProperty('asaasCustomerId');
  });

  it('retorna 0% quando o aluno nao tem plano no mes atual', async () => {
    prisma.student.findMany.mockResolvedValue([
      { id: 'student-1', userId: 'athlete-1', currentMonth: 3, completionPercent: 68 },
    ]);
    prisma.trainingPlan.findFirst.mockResolvedValue(null);

    const result = await service.findAll('coach-1');

    expect(result[0].completionPercent).toBe(0);
  });

  it('retorna 0% quando o plano nao tem nenhum exercicio ainda', async () => {
    prisma.student.findMany.mockResolvedValue([
      { id: 'student-1', userId: 'athlete-1', currentMonth: 1, completionPercent: 68 },
    ]);
    prisma.trainingPlan.findFirst.mockResolvedValue({ weeks: [] });

    const result = await service.findAll('coach-1');

    expect(result[0].completionPercent).toBe(0);
  });

  it('filtra workoutLogs pelo userId (athleteId) do proprio aluno, nao de outro', async () => {
    prisma.student.findMany.mockResolvedValue([
      { id: 'student-1', userId: 'athlete-1', currentMonth: 2, completionPercent: 68 },
    ]);
    prisma.trainingPlan.findFirst.mockResolvedValue({ weeks: [] });

    await service.findAll('coach-1');

    expect(prisma.trainingPlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          weeks: expect.objectContaining({
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
        }),
      }),
    );
  });
});

describe('StudentsService.findByUserId', () => {
  it('encontra o aluno pelo userId, incluindo o user resumido', async () => {
    const prisma: any = { student: { findFirst: jest.fn().mockResolvedValue({ id: 's1', userId: 'u1', user: { id: 'u1' } }) } };
    const service = new StudentsService(prisma);

    await expect(service.findByUserId('u1')).resolves.toEqual({ id: 's1', userId: 'u1', user: { id: 'u1' } });
    expect(prisma.student.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1' } }));
  });

  it('sem perfil de aluno pra esse userId → 404', async () => {
    const prisma: any = { student: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new StudentsService(prisma);
    await expect(service.findByUserId('u1')).rejects.toThrow('Perfil de aluno não encontrado');
  });

  it('a seleção nunca inclui cpf/asaasCustomerId (dado de pagamento, não é do perfil geral)', async () => {
    const prisma: any = { student: { findFirst: jest.fn().mockResolvedValue({ id: 's1' }) } };
    const service = new StudentsService(prisma);
    await service.findByUserId('u1');
    const select = prisma.student.findFirst.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('cpf');
    expect(select).not.toHaveProperty('asaasCustomerId');
  });
});

describe('StudentsService.findOne — checagem de dono (IDOR)', () => {
  const student = { id: 's1', coachId: 'coach-1', userId: 'athlete-1' };

  function build(found: unknown = student) {
    const prisma: any = { student: { findUnique: jest.fn().mockResolvedValue(found) } };
    return { service: new StudentsService(prisma), prisma };
  }

  it('coach dono: acesso liberado', async () => {
    const { service } = build();
    await expect(service.findOne('s1', { id: 'coach-1', role: 'coach' })).resolves.toEqual(student);
  });

  it('o próprio aluno: acesso liberado', async () => {
    const { service } = build();
    await expect(service.findOne('s1', { id: 'athlete-1', role: 'athlete' })).resolves.toEqual(student);
  });

  it('coach de outro aluno: 403 (IDOR)', async () => {
    const { service } = build();
    await expect(service.findOne('s1', { id: 'coach-9', role: 'coach' })).rejects.toThrow('Você não tem acesso a este aluno.');
  });

  it('outro atleta: 403 (IDOR)', async () => {
    const { service } = build();
    await expect(service.findOne('s1', { id: 'athlete-9', role: 'athlete' })).rejects.toThrow('Você não tem acesso a este aluno.');
  });

  it('admin não tem acesso especial aqui (só coach dono ou o próprio)', async () => {
    const { service } = build();
    await expect(service.findOne('s1', { id: 'admin-1', role: 'admin' })).rejects.toThrow('Você não tem acesso a este aluno.');
  });

  it('a seleção nunca inclui cpf/asaasCustomerId (coach não precisa ver o CPF do aluno aqui)', async () => {
    const { service, prisma } = build();
    await service.findOne('s1', { id: 'coach-1', role: 'coach' });
    const select = prisma.student.findUnique.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('cpf');
    expect(select).not.toHaveProperty('asaasCustomerId');
  });

  it('aluno inexistente → 404', async () => {
    const { service } = build(null);
    await expect(service.findOne('x', { id: 'coach-1', role: 'coach' })).rejects.toThrow('Aluno não encontrado');
  });
});

describe('StudentsService.create', () => {
  function build() {
    const tx = {
      user: { create: jest.fn().mockResolvedValue({ id: 'u1', email: 'gustavo@example.com' }) },
      student: { create: jest.fn().mockResolvedValue({ id: 's1', userId: 'u1', coachId: 'coach-1' }) },
    };
    const prisma: any = {
      user: { findUnique: jest.fn() },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    return { service: new StudentsService(prisma), prisma, tx };
  }
  const dto = { name: 'Gustavo', email: 'gustavo@example.com', password: 'senha123', goal: 'Força' };

  it('e-mail já cadastrado → 409, sem transação', async () => {
    const { service, prisma, tx } = build();
    prisma.user.findUnique.mockResolvedValue({ id: 'existente' });

    await expect(service.create('coach-1', dto)).rejects.toThrow('E-mail já cadastrado');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('cria o usuário (role athlete, senha hasheada) e o aluno vinculado ao coach do token', async () => {
    const { service, prisma, tx } = build();
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await service.create('coach-1', dto);

    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'Gustavo', email: 'gustavo@example.com', role: 'athlete' }),
    }));
    expect(tx.user.create.mock.calls[0][0].data.passwordHash).not.toBe('senha123');
    expect(tx.student.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { userId: 'u1', coachId: 'coach-1', goal: 'Força' },
    }));
    expect(result).toEqual({ id: 's1', userId: 'u1', coachId: 'coach-1' });
  });
});

describe('StudentsService.update / remove — dono (coach) via getOwnedByCoach', () => {
  function build(found: unknown) {
    const prisma: any = {
      student: { findUnique: jest.fn().mockResolvedValue(found), update: jest.fn().mockResolvedValue({ id: 's1', goal: 'novo' }) },
      user: { delete: jest.fn().mockResolvedValue({ id: 'u1' }) },
    };
    return { service: new StudentsService(prisma), prisma };
  }
  const owned = { id: 's1', coachId: 'coach-1', userId: 'u1' };

  it('update: aluno inexistente → 404', async () => {
    const { service } = build(null);
    await expect(service.update('s1', 'coach-1', { goal: 'x' })).rejects.toThrow('Aluno não encontrado');
  });

  it('update: aluno de outro coach → 403 (IDOR), sem escrever', async () => {
    const { service, prisma } = build({ ...owned, coachId: 'coach-9' });
    await expect(service.update('s1', 'coach-1', { goal: 'x' })).rejects.toThrow('Você não tem acesso a este aluno.');
    expect(prisma.student.update).not.toHaveBeenCalled();
  });

  it('update: coach dono atualiza', async () => {
    const { service, prisma } = build(owned);
    await expect(service.update('s1', 'coach-1', { goal: 'novo' })).resolves.toEqual({ id: 's1', goal: 'novo' });
    const call = prisma.student.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 's1' });
    expect(call.data).toEqual({ goal: 'novo' });
  });

  it('update: a resposta nunca inclui cpf/asaasCustomerId (dado de pagamento, não é pra essa rota)', async () => {
    const { service, prisma } = build(owned);
    await service.update('s1', 'coach-1', { goal: 'novo' });
    const select = prisma.student.update.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('cpf');
    expect(select).not.toHaveProperty('asaasCustomerId');
  });

  it('remove: aluno de outro coach → 403, sem deletar', async () => {
    const { service, prisma } = build({ ...owned, coachId: 'coach-9' });
    await expect(service.remove('s1', 'coach-1')).rejects.toThrow('Você não tem acesso a este aluno.');
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('remove: coach dono — deleta o USER (cascata apaga o student)', async () => {
    const { service, prisma } = build(owned);
    await expect(service.remove('s1', 'coach-1')).resolves.toEqual({ id: 'u1' });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
  });
});

describe('StudentsService.getCurrentPlan', () => {
  it('checa dono via findOne e devolve student + plano mais recente publicado ou não', async () => {
    const student = { id: 's1', coachId: 'coach-1', userId: 'athlete-1' };
    const plan = { id: 'plan-1', month: 3 };
    const prisma: any = {
      student: { findUnique: jest.fn().mockResolvedValue(student) },
      trainingPlan: { findFirst: jest.fn().mockResolvedValue(plan) },
    };
    const service = new StudentsService(prisma);

    await expect(service.getCurrentPlan('s1', { id: 'coach-1', role: 'coach' })).resolves.toEqual({ student, plan });
    expect(prisma.trainingPlan.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { studentId: 's1' } }));
  });

  it('sem plano nenhum: plan vem null', async () => {
    const student = { id: 's1', coachId: 'coach-1', userId: 'athlete-1' };
    const prisma: any = {
      student: { findUnique: jest.fn().mockResolvedValue(student) },
      trainingPlan: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new StudentsService(prisma);

    await expect(service.getCurrentPlan('s1', { id: 'coach-1', role: 'coach' })).resolves.toEqual({ student, plan: null });
  });

  it('propaga o 403 de findOne (não vaza plano de aluno que não é seu)', async () => {
    const student = { id: 's1', coachId: 'coach-9', userId: 'athlete-1' };
    const prisma: any = { student: { findUnique: jest.fn().mockResolvedValue(student) }, trainingPlan: { findFirst: jest.fn() } };
    const service = new StudentsService(prisma);

    await expect(service.getCurrentPlan('s1', { id: 'coach-1', role: 'coach' })).rejects.toThrow('Você não tem acesso a este aluno.');
    expect(prisma.trainingPlan.findFirst).not.toHaveBeenCalled();
  });
});
