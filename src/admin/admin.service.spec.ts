import * as bcrypt from 'bcrypt';
import * as emailTokens from '../auth/email-tokens';
import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordResetService } from '../auth/password-reset.service';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: any;
  let passwordReset: { sendWelcome: jest.Mock; sendResetLink: jest.Mock };

  beforeEach(async () => {
    passwordReset = { sendWelcome: jest.fn().mockResolvedValue(undefined), sendResetLink: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'coach-1', name: 'Luan Silveira', email: 'luan@aevonfit.com', aiImportEnabled: true, createdAt: new Date('2026-01-01'), lastLoginAt: null },
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
        findMany: jest.fn().mockResolvedValue([]),
      },
      subscription: { findMany: jest.fn().mockResolvedValue([]) },
      coachProfile: { findUnique: jest.fn().mockResolvedValue(null) },
      trainingPlan: { count: jest.fn().mockResolvedValue(0), findFirst: jest.fn().mockResolvedValue(null) },
      workoutSession: { count: jest.fn().mockResolvedValue(0) },
    };

    const module = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordResetService, useValue: passwordReset },
      ],
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
        platformFeePercent: 0, studentCount: 0, totalPaid: 0, gatewayFee: 0, platformCut: 0, coachCut: 0, pendingBreakdown: 0,
        subscriptions: { active: 0, trialing: 0, pastDue: 0, canceled: 0, withoutPlan: 0, mrrCents: 0 },
        alerts: ['NO_CONTRACT', 'NO_WALLET', 'PAGE_UNPUBLISHED'],
        usage: { plans: 0, aiImportedPlans: 0, completedWorkouts30d: 0, lastLoginAt: null, lastPlanUpdateAt: null },
      },
    ]);
  });

  const pago = (coachId: string, amount: number, netValue: number | null, pct: number | null, paidAt = new Date()) => ({
    amount, netValue, paidAt, subscription: { platformFeePercent: pct, student: { coachId } },
  });

  describe('governança: % por contrato, alunos e repasse real (mesma conta do Financeiro do coach)', () => {
    it('sem contrato cadastrado: % 0, mas ainda mostra alunos e o repasse real', async () => {
      prisma.student.count.mockResolvedValue(12);
      prisma.gatewayPayment.findMany.mockResolvedValue([pago('coach-1', 1200, 1170, 0)]);

      const [result] = await service.listCoaches();

      expect(result).toMatchObject({
        platformFeePercent: 0, studentCount: 12, totalPaid: 1200, gatewayFee: 30, platformCut: 0, coachCut: 1170,
      });
    });

    it('divide o LÍQUIDO (depois da taxa do Asaas) pelo % gravado em cada assinatura — não pelo % do contrato de hoje', async () => {
      prisma.coachContract.findUnique.mockResolvedValue({ platformFeePercent: '25.00' });
      prisma.gatewayPayment.findMany.mockResolvedValue([
        pago('coach-1', 100, 97, 10), // AEVON 9,70 / coach 87,30
        pago('coach-1', 100, 97, 20), // assinatura antiga: AEVON 19,40 / coach 77,60
      ]);

      const [result] = await service.listCoaches();

      expect(result.platformFeePercent).toBe(25);
      expect(result).toMatchObject({ totalPaid: 200, gatewayFee: 6, platformCut: 29.1, coachCut: 164.9, pendingBreakdown: 0 });
      expect(prisma.gatewayPayment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'paid' } }));
    });

    it('cobrança sem líquido ainda: conta no bruto e fica pendente, sem repasse inventado', async () => {
      prisma.gatewayPayment.findMany.mockResolvedValue([pago('coach-1', 150, null, 10)]);
      const [result] = await service.listCoaches();
      expect(result).toMatchObject({ totalPaid: 150, platformCut: 0, coachCut: 0, pendingBreakdown: 1 });
    });

    it('cada coach só soma as cobranças dos alunos dele', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'coach-1', name: 'Luan', email: 'luan@x.com', aiImportEnabled: true, createdAt: new Date() },
        { id: 'coach-2', name: 'Lucas', email: 'lucas@x.com', aiImportEnabled: true, createdAt: new Date() },
      ]);
      prisma.gatewayPayment.findMany.mockResolvedValue([pago('coach-1', 100, 100, 0), pago('coach-2', 40, 40, 0)]);

      const result = await service.listCoaches();

      expect(prisma.student.count).toHaveBeenCalledWith({ where: { coachId: 'coach-1', unlinkedAt: null } });
      expect(prisma.student.count).toHaveBeenCalledWith({ where: { coachId: 'coach-2', unlinkedAt: null } });
      expect(result.map(r => r.totalPaid)).toEqual([100, 40]);
    });

    it('sem nenhum pagamento pago ainda: tudo 0, não quebra', async () => {
      const [result] = await service.listCoaches();
      expect(result).toMatchObject({ totalPaid: 0, coachCut: 0, pendingBreakdown: 0 });
    });
  });

  describe('assinaturas, alertas e uso por coach', () => {
    const agora = new Date('2026-09-30T12:00:00Z');

    it('resume assinaturas dos alunos ativos, alerta o que falta configurar e mostra o uso', async () => {
      const login = new Date('2026-09-29T10:00:00Z');
      const editou = new Date('2026-09-28T10:00:00Z');
      prisma.user.findMany.mockResolvedValue([
        { id: 'coach-1', name: 'Luan', email: 'luan@x.com', aiImportEnabled: true, createdAt: new Date(), lastLoginAt: login },
      ]);
      prisma.coachContract.findUnique.mockResolvedValue({ platformFeePercent: '10.00', gatewayAccountRef: 'c0c1688f-636b-42c0-b6ee-7339182276b7' });
      prisma.student.count.mockResolvedValue(5);
      prisma.subscription.findMany.mockResolvedValue([
        { status: 'ACTIVE', plan: { priceCents: 14900 } },
        { status: 'PAST_DUE', plan: { priceCents: 14900 } },
      ]);
      prisma.coachProfile.findUnique.mockResolvedValue({ published: false });
      prisma.trainingPlan.count.mockResolvedValueOnce(7).mockResolvedValueOnce(2);
      prisma.workoutSession.count.mockResolvedValue(31);
      prisma.trainingPlan.findFirst.mockResolvedValue({ updatedAt: editou });

      const [r] = await service.listCoaches(agora);

      expect(r).not.toHaveProperty('lastLoginAt');
      expect(r.subscriptions).toEqual({ active: 1, trialing: 0, pastDue: 1, canceled: 0, withoutPlan: 3, mrrCents: 14900 });
      expect(r.alerts).toEqual(['PAGE_UNPUBLISHED']);
      expect(r.usage).toEqual({ plans: 7, aiImportedPlans: 2, completedWorkouts30d: 31, lastLoginAt: login, lastPlanUpdateAt: editou });
      expect(prisma.subscription.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { student: { coachId: 'coach-1', unlinkedAt: null } },
      }));
      expect(prisma.trainingPlan.count).toHaveBeenCalledWith({ where: { coachId: 'coach-1', importedByAi: true } });
      expect(prisma.workoutSession.count).toHaveBeenCalledWith({
        where: {
          status: 'Completed',
          finishedAt: { gte: new Date('2026-08-31T12:00:00Z') },
          session: { day: { week: { plan: { coachId: 'coach-1' } } } },
        },
      });
      expect(prisma.trainingPlan.findFirst).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { updatedAt: 'desc' } }));
    });

    it('contrato sem carteira do Asaas: alerta de carteira, não de contrato', async () => {
      prisma.coachContract.findUnique.mockResolvedValue({ platformFeePercent: '15.00', gatewayAccountRef: null });
      prisma.coachProfile.findUnique.mockResolvedValue({ published: true });
      const [r] = await service.listCoaches(agora);
      expect(r.alerts).toEqual(['NO_WALLET']);
    });
  });

  describe('financialOverview — mês a mês', () => {
    const agora = new Date(2026, 8, 20); // setembro/2026

    it('6 meses por coach e o total da plataforma, pelo mês do pagamento', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'coach-1', name: 'Ana', email: 'ana@x.com' },
        { id: 'coach-2', name: 'Bia', email: 'bia@x.com' },
      ]);
      prisma.gatewayPayment.findMany.mockResolvedValue([
        pago('coach-1', 100, 97, 10, new Date(2026, 8, 3)),
        pago('coach-1', 60, 58, 10, new Date(2026, 6, 10)),
      ]);

      const r = await service.financialOverview(agora);

      expect(r.months).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
      expect(r.coaches[0].months[5]).toMatchObject({ count: 1, gross: 100, gatewayFee: 3, platformFee: 9.7, coachNet: 87.3 });
      expect(r.coaches[0].months[3]).toMatchObject({ count: 1, gross: 60 });
      // Coach sem movimento: meses zerados, sem sumir da lista.
      expect(r.coaches[1].months).toHaveLength(6);
      expect(r.coaches[1].months.every((m: any) => m.count === 0)).toBe(true);
      expect(r.totals[5]).toMatchObject({ gross: 100 });
      expect(prisma.gatewayPayment.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { status: 'paid', paidAt: { gte: new Date(2026, 3, 1), lt: new Date(2026, 9, 1) } },
      }));
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { role: 'coach' }, orderBy: { name: 'asc' } }));
    });

    it('cobrança paga sem data (não deveria existir) fica fora do período, sem quebrar', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'coach-1', name: 'Ana', email: 'ana@x.com' }]);
      prisma.gatewayPayment.findMany.mockResolvedValue([{ ...pago('coach-1', 100, 97, 10), paidAt: null }]);
      const r = await service.financialOverview(agora);
      expect(r.totals.every((t: any) => t.count === 0)).toBe(true);
    });

    it('usa a data de agora quando não recebe uma', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      const r = await service.financialOverview();
      expect(r.months).toHaveLength(6);
    });
  });

  it('cria coach novo SEM senha conhecida e manda o "crie sua senha" por e-mail (o admin não vê senha)', async () => {
    const result = await service.createCoach({ name: 'Nova Coach', email: 'nova@aevonfit.com' });

    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { email: 'nova@aevonfit.com' } });
    const createCall = prisma.user.create.mock.calls[0][0];
    expect(createCall.data.role).toBe('coach');
    expect(createCall.data.email).toBe('nova@aevonfit.com');
    expect(createCall.data.passwordHash).toMatch(/^\$2[aby]\$10\$/);
    expect(createCall.data.emailVerifiedAt).toBeUndefined();
    expect(createCall.select).toEqual({ id: true, name: true, email: true });
    expect(passwordReset.sendWelcome).toHaveBeenCalledWith(
      { id: 'coach-2', name: 'Nova Coach', email: 'nova@aevonfit.com' },
      { tipo: 'admin' },
    );
    expect(result).toEqual({ id: 'coach-2', name: 'Nova Coach', email: 'nova@aevonfit.com', welcomeSent: true });
    expect(result).not.toHaveProperty('password');
  });

  it('a senha do coach novo é a aleatória de uso interno (ninguém conhece), nunca um valor fixo', async () => {
    jest.spyOn(emailTokens, 'unusablePassword').mockReturnValue('aleatoria-de-teste-123');
    await service.createCoach({ name: 'Nova Coach', email: 'nova@aevonfit.com' });
    expect(await bcrypt.compare('aleatoria-de-teste-123', prisma.user.create.mock.calls[0][0].data.passwordHash)).toBe(true);
    jest.restoreAllMocks();
  });

  it('falha no envio das boas-vindas não desfaz o cadastro (vai para o log)', async () => {
    const erro = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    passwordReset.sendWelcome.mockRejectedValue(new Error('banco fora'));
    await expect(service.createCoach({ name: 'Nova Coach', email: 'nova@aevonfit.com' })).resolves.toMatchObject({ id: 'coach-2' });
    expect(erro).toHaveBeenCalledWith(expect.stringContaining('coach-2'), expect.any(String));
    passwordReset.sendWelcome.mockRejectedValue('falha crua');
    await service.createCoach({ name: 'Nova Coach', email: 'nova@aevonfit.com' });
    expect(erro).toHaveBeenLastCalledWith(expect.any(String), 'falha crua');
  });

  it('lança ConflictException se o e-mail já existe, sem criar nada', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'existing' });

    await expect(service.createCoach({ name: 'X', email: 'ja-existe@aevonfit.com' })).rejects.toThrow(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('nova senha do coach: manda o link por e-mail e não mexe na senha atual', async () => {
    const coach = { id: 'coach-1', name: 'Luan', email: 'luan@example.com', role: 'coach', deletedAt: null };
    prisma.user.findUnique.mockResolvedValue(coach);
    await expect(service.resetCoachPassword('coach-1')).resolves.toEqual({ sent: true });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'coach-1' },
      select: { id: true, name: true, email: true, role: true, deletedAt: true },
    });
    expect(passwordReset.sendResetLink).toHaveBeenCalledWith(coach, 'admin');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('coach com conta excluída: 404 e nenhum e-mail', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'coach-1', role: 'coach', deletedAt: new Date() });
    await expect(service.resetCoachPassword('coach-1')).rejects.toThrow(NotFoundException);
    expect(passwordReset.sendResetLink).not.toHaveBeenCalled();
  });

  it('lança NotFoundException ao resetar senha de coach que não existe', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.resetCoachPassword('inexistente')).rejects.toThrow(NotFoundException);
    expect(passwordReset.sendResetLink).not.toHaveBeenCalled();
  });

  it('lança NotFoundException ao resetar senha de usuário que não é coach', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'athlete-1', role: 'athlete' });

    await expect(service.resetCoachPassword('athlete-1')).rejects.toThrow(NotFoundException);
    expect(passwordReset.sendResetLink).not.toHaveBeenCalled();
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
