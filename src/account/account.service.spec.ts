import * as bcrypt from 'bcrypt';
import { AccountService, NOME_ANONIMO } from './account.service';

const aluno = (over: Record<string, unknown> = {}) => ({
  role: 'athlete',
  deletedAt: null,
  name: 'Ana Souza',
  email: 'ana@example.com',
  student: { id: 's1', coachId: 'coach-1', unlinkedAt: null },
  ...over,
});

function build(user: unknown = aluno()) {
  const del = () => jest.fn().mockResolvedValue({ count: 1 });
  const tx: any = {
    user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
    workoutLog: { deleteMany: del() },
    workoutSession: { deleteMany: del() },
    workoutSkip: { deleteMany: del() },
    hydrationLog: { deleteMany: del() },
    calorieLog: { deleteMany: del() },
    personalRecord: { deleteMany: del() },
    movement: { deleteMany: del() },
    message: { deleteMany: del() },
    notification: { deleteMany: del() },
    lead: { deleteMany: del() },
    trainingPlan: { deleteMany: del() },
    student: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      findFirst: jest.fn(),
    },
    $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)),
  };
  const subscriptions = { endSubscription: jest.fn().mockResolvedValue(true) };
  return { service: new AccountService(prisma, subscriptions as any), prisma, tx, subscriptions };
}

describe('AccountService.anonymize — exclusão a pedido do titular', () => {
  it('cancela a cobrança ANTES de apagar qualquer coisa', async () => {
    const { service, prisma, subscriptions } = build();
    await expect(service.anonymize('u1', 'aluno')).resolves.toEqual({ deleted: true });
    expect(subscriptions.endSubscription).toHaveBeenCalledWith('s1');
    expect(subscriptions.endSubscription.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.$transaction.mock.invocationCallOrder[0],
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 15_000 });
  });

  it('Asaas recusou o cancelamento: nada é apagado', async () => {
    const { service, prisma, subscriptions } = build();
    subscriptions.endSubscription.mockRejectedValue(new Error('Asaas fora do ar'));
    await expect(service.anonymize('u1', 'aluno')).rejects.toThrow('Asaas fora do ar');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('apaga treino, saúde, progresso e movimentos próprios do aluno', async () => {
    const { service, tx } = build();
    await service.anonymize('u1', 'admin');
    for (const modelo of ['workoutLog', 'workoutSession', 'workoutSkip', 'hydrationLog', 'calorieLog', 'personalRecord', 'movement']) {
      expect(tx[modelo].deleteMany).toHaveBeenCalledWith({ where: { athleteId: 'u1' } });
    }
    expect(tx.trainingPlan.deleteMany).toHaveBeenCalledWith({ where: { studentId: 's1' } });
  });

  it('apaga as conversas, as notificações dele e as do coach que citam nome/e-mail/plano dele; e os contatos da landing', async () => {
    const { service, tx } = build();
    await service.anonymize('u1', 'aluno');
    expect(tx.message.deleteMany).toHaveBeenCalledWith({ where: { OR: [{ fromId: 'u1' }, { toId: 'u1' }] } });
    expect(tx.notification.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(tx.notification.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { type: 'new_message', title: 'Nova mensagem de Ana Souza' },
          { type: 'subscription_canceled', body: { startsWith: 'Ana Souza cancelou' } },
          { type: 'new_student', body: { startsWith: 'Ana Souza se inscreveu' } },
          { type: 'new_lead', body: { contains: '(ana@example.com)' } },
          { link: '/coach/plan-builder/s1' },
        ],
      },
    });
    expect(tx.lead.deleteMany).toHaveBeenCalledWith({ where: { email: { equals: 'ana@example.com', mode: 'insensitive' } } });
  });

  it('MANTÉM assinatura e cobranças (fiscal): nunca apaga subscription/gatewayPayment/payment nem o aluno', async () => {
    const { service, tx } = build();
    await service.anonymize('u1', 'aluno');
    expect(tx.subscription).toBeUndefined();
    expect(tx.gatewayPayment).toBeUndefined();
    expect(tx.payment).toBeUndefined();
    expect(tx.student.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { cpf: null, asaasCustomerId: null, goal: null, unlinkedAt: expect.any(Date) },
    });
  });

  it('troca nome e e-mail, inutiliza a senha e apaga o consentimento de saúde', async () => {
    const { service, tx } = build();
    await service.anonymize('u1', 'aluno');
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    const { data } = tx.user.update.mock.calls[0][0];
    expect(data).toMatchObject({
      name: NOME_ANONIMO,
      email: 'removido-u1@anonimo.invalid',
      healthConsent: null,
      healthConsentAt: null,
    });
    expect(await bcrypt.compare('', data.passwordHash)).toBe(false);
    expect(data.passwordHash).toMatch(/^\$2[aby]\$10\$/);
  });

  it('desvinculado antes pelo coach: mantém a data do desvínculo', async () => {
    const quando = new Date('2026-09-01T00:00:00Z');
    const { service, tx } = build(aluno({ student: { id: 's1', coachId: 'coach-1', unlinkedAt: quando } }));
    await service.anonymize('u1', 'admin');
    expect(tx.student.update.mock.calls[0][0].data.unlinkedAt).toBe(quando);
  });

  it('aluno sem perfil de aluno: anonimiza a conta sem mexer em cobrança nem plano', async () => {
    const { service, tx, subscriptions } = build(aluno({ student: null }));
    await expect(service.anonymize('u1', 'admin')).resolves.toEqual({ deleted: true });
    expect(subscriptions.endSubscription).not.toHaveBeenCalled();
    expect(tx.trainingPlan.deleteMany).not.toHaveBeenCalled();
    expect(tx.student.update).not.toHaveBeenCalled();
    expect(tx.notification.deleteMany.mock.calls[1][0].where.OR).toHaveLength(4);
  });

  it('dois pedidos ao mesmo tempo: o segundo não apaga nada (trava otimista)', async () => {
    const { service, tx } = build();
    tx.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.anonymize('u1', 'aluno')).resolves.toEqual({ deleted: false });
    expect(tx.message.deleteMany).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('conta já excluída: idempotente, não cancela nem apaga de novo', async () => {
    const { service, prisma, subscriptions } = build(aluno({ deletedAt: new Date() }));
    await expect(service.anonymize('u1', 'aluno')).resolves.toEqual({ deleted: false });
    expect(subscriptions.endSubscription).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['conta inexistente', null],
    ['coach', aluno({ role: 'coach' })],
    ['admin', aluno({ role: 'admin' })],
  ])('%s: 404 — só conta de aluno é excluída por aqui', async (_caso, user) => {
    const { service, prisma } = build(user);
    await expect(service.anonymize('u1', 'admin')).rejects.toThrow('Aluno não encontrado.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('AccountService.deleteMine — o próprio aluno, com a senha', () => {
  it('senha certa: anonimiza', async () => {
    const { service, prisma } = build();
    const passwordHash = await bcrypt.hash('senha-certa', 4);
    prisma.user.findUnique.mockResolvedValueOnce({ passwordHash });
    await expect(service.deleteMine('u1', 'senha-certa')).resolves.toEqual({ deleted: true });
    expect(prisma.user.findUnique.mock.calls[0][0]).toEqual({ where: { id: 'u1' }, select: { passwordHash: true } });
  });

  it('senha errada: 401, nada é apagado', async () => {
    const { service, prisma, subscriptions } = build();
    prisma.user.findUnique.mockResolvedValueOnce({ passwordHash: await bcrypt.hash('senha-certa', 4) });
    await expect(service.deleteMine('u1', 'errada')).rejects.toThrow('Senha incorreta.');
    expect(subscriptions.endSubscription).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('conta que sumiu entre o token e o pedido: 401', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.deleteMine('u1', 'x')).rejects.toThrow('Senha incorreta.');
  });
});

describe('AccountService.findAthleteByEmail — admin', () => {
  it('busca exata (sem diferenciar maiúsculas), só aluno ativo, e devolve o mínimo', async () => {
    const { service, prisma } = build();
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1', name: 'Ana', email: 'ana@example.com', createdAt: new Date('2026-09-01'),
      student: { unlinkedAt: new Date(), coach: { name: 'Luan' } },
    });
    await expect(service.findAthleteByEmail('  Ana@Example.com ')).resolves.toEqual({
      id: 'u1', name: 'Ana', email: 'ana@example.com', createdAt: new Date('2026-09-01'), coachName: 'Luan', unlinked: true,
    });
    expect(prisma.user.findFirst.mock.calls[0][0].where).toEqual({
      email: { equals: 'Ana@Example.com', mode: 'insensitive' },
      role: 'athlete',
      deletedAt: null,
    });
  });

  it('aluno sem perfil de aluno: coachName null e não desvinculado', async () => {
    const { service, prisma } = build();
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', name: 'Ana', email: 'a@example.com', createdAt: new Date(), student: null });
    await expect(service.findAthleteByEmail('a@example.com')).resolves.toMatchObject({ coachName: null, unlinked: false });
  });

  it('ninguém com o e-mail: 404', async () => {
    const { service, prisma } = build();
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.findAthleteByEmail('x@example.com')).rejects.toThrow('Nenhum aluno com este e-mail.');
  });
});
