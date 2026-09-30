import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'coach-1', name: 'Luan Silveira', email: 'luan@aevonfit.com', aiImportEnabled: true, createdAt: new Date('2026-01-01') },
        ]),
        findUnique: jest.fn().mockResolvedValue({ id: 'coach-1', role: 'coach' }),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'coach-2', name: 'Nova Coach', email: 'nova@aevonfit.com' }),
        update: jest.fn().mockResolvedValue({ id: 'coach-1', passwordHash: 'hash' }),
      },
      coachContract: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      student: {
        count: jest.fn().mockResolvedValue(0),
      },
      gatewayPayment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
      },
    };

    const module = await Test.createTestingModule({
      providers: [AdminService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(AdminService);
  });

  it('lista só usuários com role coach', async () => {
    const result = await service.listCoaches();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: 'coach' } }),
    );
    expect(result).toEqual([
      {
        id: 'coach-1', name: 'Luan Silveira', email: 'luan@aevonfit.com', aiImportEnabled: true, createdAt: new Date('2026-01-01'),
        platformFeePercent: 0, studentCount: 0, totalPaid: 0, platformCut: 0, coachCut: 0,
      },
    ]);
  });

  describe('governança: % por contrato, alunos e repasse real', () => {
    it('sem contrato cadastrado: % 0, mas ainda mostra alunos/repasse reais', async () => {
      prisma.coachContract.findUnique.mockResolvedValue(null);
      prisma.student.count.mockResolvedValue(12);
      prisma.gatewayPayment.aggregate.mockResolvedValue({ _sum: { amount: 1200 } });

      const [result] = await service.listCoaches();

      expect(result.platformFeePercent).toBe(0);
      expect(result.studentCount).toBe(12);
      expect(result.totalPaid).toBe(1200);
      expect(result.platformCut).toBe(0);
      expect(result.coachCut).toBe(1200);
    });

    it('com contrato: divide o total pago entre plataforma e coach pela % configurada', async () => {
      prisma.coachContract.findUnique.mockResolvedValue({ platformFeePercent: '10.00' });
      prisma.student.count.mockResolvedValue(100);
      prisma.gatewayPayment.aggregate.mockResolvedValue({ _sum: { amount: 10000 } });

      const [result] = await service.listCoaches();

      expect(result.platformFeePercent).toBe(10);
      expect(result.platformCut).toBe(1000);
      expect(result.coachCut).toBe(9000);
    });

    it('escopa alunos e pagamentos pelo coachId — cada coach é consultado separadamente', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'coach-1', name: 'Luan', email: 'luan@x.com', aiImportEnabled: true, createdAt: new Date() },
        { id: 'coach-2', name: 'Lucas', email: 'lucas@x.com', aiImportEnabled: true, createdAt: new Date() },
      ]);

      await service.listCoaches();

      expect(prisma.student.count).toHaveBeenCalledWith({ where: { coachId: 'coach-1', unlinkedAt: null } });
      expect(prisma.student.count).toHaveBeenCalledWith({ where: { coachId: 'coach-2', unlinkedAt: null } });
      expect(prisma.gatewayPayment.aggregate).toHaveBeenCalledWith(expect.objectContaining({
        where: { status: 'paid', subscription: { student: { coachId: 'coach-1' } } },
      }));
    });

    it('sem nenhum pagamento pago ainda: totalPaid 0, não quebra', async () => {
      prisma.gatewayPayment.aggregate.mockResolvedValue({ _sum: { amount: null } });
      const [result] = await service.listCoaches();
      expect(result.totalPaid).toBe(0);
      expect(result.coachCut).toBe(0);
    });
  });

  it('cria coach novo com senha forte gerada, devolvida uma única vez', async () => {
    const result = await service.createCoach({ name: 'Nova Coach', email: 'nova@aevonfit.com' });

    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { email: 'nova@aevonfit.com' } });
    const createCall = prisma.user.create.mock.calls[0][0];
    expect(createCall.data.role).toBe('coach');
    expect(createCall.data.email).toBe('nova@aevonfit.com');
    expect(createCall.data.passwordHash).toBeDefined();
    expect(createCall.data.passwordHash).not.toBe(result.password); // hash, nunca a senha em texto puro
    expect(result.password.length).toBeGreaterThan(15);
    expect(result.id).toBe('coach-2');
  });

  it('lança ConflictException se o e-mail já existe, sem criar nada', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'existing' });

    await expect(service.createCoach({ name: 'X', email: 'ja-existe@aevonfit.com' })).rejects.toThrow(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('reseta a senha de um coach existente, devolvendo a senha nova uma única vez', async () => {
    const result = await service.resetCoachPassword('coach-1');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'coach-1' }, select: { role: true } });
    const updateCall = prisma.user.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: 'coach-1' });
    expect(updateCall.data.passwordHash).toBeDefined();
    expect(result.password.length).toBeGreaterThan(15);
  });

  it('lança NotFoundException ao resetar senha de coach que não existe', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.resetCoachPassword('inexistente')).rejects.toThrow(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('lança NotFoundException ao resetar senha de usuário que não é coach', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'athlete-1', role: 'athlete' });

    await expect(service.resetCoachPassword('athlete-1')).rejects.toThrow(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('liga/desliga aiImportEnabled de um coach', async () => {
    prisma.user.update.mockResolvedValue({ id: 'coach-1', aiImportEnabled: false });

    const result = await service.toggleCoachAi('coach-1', false);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'coach-1' },
      data: { aiImportEnabled: false },
      select: { id: true, aiImportEnabled: true },
    });
    expect(result).toEqual({ id: 'coach-1', aiImportEnabled: false });
  });

  it('lança NotFoundException ao ligar/desligar IA de coach que não existe', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.toggleCoachAi('inexistente', true)).rejects.toThrow(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('lança NotFoundException ao ligar/desligar IA de usuário que não é coach', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'athlete-1', role: 'athlete' });

    await expect(service.toggleCoachAi('athlete-1', true)).rejects.toThrow(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
