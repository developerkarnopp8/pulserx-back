import { SubscriptionsService } from './subscriptions.service';

const coach = { id: 'coach-1', role: 'coach' };
const admin = { id: 'admin-1', role: 'admin' };
const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

function build(over: { student?: any; plan?: any; current?: any } = {}) {
  const prisma = {
    student: {
      findUnique: jest.fn().mockResolvedValue('student' in over ? over.student : { id: 's1', coachId: 'coach-1' }),
      findFirst: jest.fn().mockResolvedValue({ id: 's1' }),
    },
    subscriptionPlan: {
      findUnique: jest.fn().mockResolvedValue('plan' in over ? over.plan : { id: 'p1', coachId: 'coach-1', active: true }),
    },
    subscription: {
      findUnique: jest.fn().mockResolvedValue('current' in over ? over.current : null),
      upsert: jest.fn().mockImplementation(async ({ create }) => ({ id: 'sub1', ...create })),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const access = { getViewableCategories: jest.fn().mockResolvedValue(['CORE']) };
  return { service: new SubscriptionsService(prisma as any, access as any), prisma, access };
}

describe('SubscriptionsService.assign', () => {
  it('coach dono atribui o plano do próprio catálogo: ACTIVE por padrão, sem fim de teste', async () => {
    const { service, prisma } = build();
    await service.assign('s1', coach, { planId: 'p1' });
    expect(prisma.subscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { studentId: 's1' },
      create: { studentId: 's1', planId: 'p1', status: 'ACTIVE', trialEndsAt: null, canceledAt: null },
      update: { planId: 'p1', status: 'ACTIVE', trialEndsAt: null, canceledAt: null },
    }));
  });

  it('IDOR: coach de outro aluno é barrado (403) e nada é gravado', async () => {
    const { service, prisma } = build({ student: { id: 's1', coachId: 'coach-9' } });
    await expect(service.assign('s1', coach, { planId: 'p1' })).rejects.toThrow('Você não tem acesso a este aluno.');
    expect(prisma.subscriptionPlan.findUnique).not.toHaveBeenCalled();
    expect(prisma.subscription.upsert).not.toHaveBeenCalled();
  });

  it('IDOR: plano de OUTRO coach é tratado como inexistente (404), mesmo para o admin', async () => {
    const { service, prisma } = build({ plan: { id: 'p1', coachId: 'coach-9', active: true } });
    await expect(service.assign('s1', coach, { planId: 'p1' })).rejects.toThrow('Plano não encontrado');
    await expect(service.assign('s1', admin, { planId: 'p1' })).rejects.toThrow('Plano não encontrado');
    expect(prisma.subscription.upsert).not.toHaveBeenCalled();
  });

  it('plano inexistente → 404; aluno inexistente → 404; papel de aluno → 403', async () => {
    await expect(build({ plan: null }).service.assign('s1', coach, { planId: 'x' })).rejects.toThrow('Plano não encontrado');
    await expect(build({ student: null }).service.assign('s1', coach, { planId: 'p1' })).rejects.toThrow('Aluno não encontrado');
    await expect(build().service.assign('s1', { id: 'u', role: 'athlete' }, { planId: 'p1' })).rejects.toThrow('Você não tem acesso a este aluno.');
  });

  it('admin atribui a aluno de qualquer coach, usando o plano DAQUELE coach', async () => {
    const { service, prisma } = build({ student: { id: 's1', coachId: 'coach-9' }, plan: { id: 'p9', coachId: 'coach-9', active: true } });
    await service.assign('s1', admin, { planId: 'p9' });
    expect(prisma.subscription.upsert).toHaveBeenCalled();
  });

  it('plano inativo não entra para aluno novo, mas quem já está nele pode ter o status alterado', async () => {
    const inactive = { id: 'p1', coachId: 'coach-1', active: false };
    const blocked = build({ plan: inactive, current: { planId: 'outro' } });
    await expect(blocked.service.assign('s1', coach, { planId: 'p1' })).rejects.toThrow('inativo');
    await expect(build({ plan: inactive, current: null }).service.assign('s1', coach, { planId: 'p1' })).rejects.toThrow('inativo');

    const same = build({ plan: inactive, current: { planId: 'p1' } });
    await same.service.assign('s1', coach, { planId: 'p1', status: 'PAST_DUE' as any });
    expect(same.prisma.subscription.upsert).toHaveBeenCalled();
  });

  it('TRIALING exige fim de teste no futuro', async () => {
    const { service, prisma } = build();
    await expect(service.assign('s1', coach, { planId: 'p1', status: 'TRIALING' as any })).rejects.toThrow('data de término no futuro');
    await expect(service.assign('s1', coach, { planId: 'p1', status: 'TRIALING' as any, trialEndsAt: PAST })).rejects.toThrow('data de término no futuro');
    expect(prisma.subscription.upsert).not.toHaveBeenCalled();

    await service.assign('s1', coach, { planId: 'p1', status: 'TRIALING' as any, trialEndsAt: FUTURE });
    expect(prisma.subscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ status: 'TRIALING', trialEndsAt: new Date(FUTURE) }),
    }));
  });

  it('data de teste com outro status é rejeitada (não grava dado que não vale)', async () => {
    const { service, prisma } = build();
    await expect(service.assign('s1', coach, { planId: 'p1', status: 'ACTIVE' as any, trialEndsAt: FUTURE })).rejects.toThrow('só vale para o status TRIALING');
    expect(prisma.subscription.upsert).not.toHaveBeenCalled();
  });

  it('CANCELED registra canceledAt; voltar a ACTIVE limpa', async () => {
    const { service, prisma } = build();
    await service.assign('s1', coach, { planId: 'p1', status: 'CANCELED' as any });
    expect(prisma.subscription.upsert.mock.calls[0][0].update.canceledAt).toBeInstanceOf(Date);
    await service.assign('s1', coach, { planId: 'p1', status: 'ACTIVE' as any });
    expect(prisma.subscription.upsert.mock.calls[1][0].update.canceledAt).toBeNull();
  });
});

describe('SubscriptionsService.getForStudent / remove', () => {
  it('coach dono lê a assinatura; outro coach é barrado', async () => {
    const { service, prisma } = build({ current: { id: 'sub1' } });
    await expect(service.getForStudent('s1', coach)).resolves.toEqual({ id: 'sub1' });
    expect(prisma.subscription.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { studentId: 's1' } }));
    await expect(service.getForStudent('s1', { id: 'coach-9', role: 'coach' })).rejects.toThrow('Você não tem acesso a este aluno.');
  });

  it('a seleção da assinatura nunca inclui gateway/gatewaySubscriptionId', async () => {
    const { service, prisma } = build();
    await service.getForStudent('s1', coach);
    const select = prisma.subscription.findUnique.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('gateway');
    expect(select).not.toHaveProperty('gatewaySubscriptionId');
  });

  it('remove apaga só a do aluno informado; idempotente (nada a remover → removed false)', async () => {
    const { service, prisma } = build();
    await expect(service.remove('s1', coach)).resolves.toEqual({ removed: true });
    expect(prisma.subscription.deleteMany).toHaveBeenCalledWith({ where: { studentId: 's1' } });
    prisma.subscription.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.remove('s1', admin)).resolves.toEqual({ removed: false });
  });

  it('remove: outro coach é barrado sem apagar', async () => {
    const { service, prisma } = build({ student: { id: 's1', coachId: 'coach-9' } });
    await expect(service.remove('s1', coach)).rejects.toThrow('Você não tem acesso a este aluno.');
    expect(prisma.subscription.deleteMany).not.toHaveBeenCalled();
  });
});

describe('SubscriptionsService.getMine', () => {
  it('devolve a assinatura do próprio aluno e as categorias que enxerga hoje', async () => {
    const { service, prisma, access } = build({ current: { id: 'sub1' } });
    await expect(service.getMine({ id: 'u1', role: 'athlete' })).resolves.toEqual({ subscription: { id: 'sub1' }, categories: ['CORE'] });
    expect(prisma.student.findFirst).toHaveBeenCalledWith({ where: { userId: 'u1' }, select: { id: true } });
    expect(access.getViewableCategories).toHaveBeenCalledWith('s1');
  });

  it('usuário sem perfil de aluno → 404', async () => {
    const { service, prisma } = build();
    prisma.student.findFirst.mockResolvedValue(null);
    await expect(service.getMine({ id: 'u9', role: 'athlete' })).rejects.toThrow('Perfil de aluno não encontrado');
  });
});
