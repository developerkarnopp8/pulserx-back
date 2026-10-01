import { ForbiddenException } from '@nestjs/common';
import { SubscriptionStatus, TrainingCategory } from '@prisma/client';
import { ACCESS_INCLUDE, accessState, FREE_SAMPLE_WEEKS, PAST_DUE_GRACE_DAYS, SubscriptionAccessService } from './subscription-access.service';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function makeService(opts: { enforced?: boolean | null; subscription?: unknown } = {}) {
  const prisma = {
    platformSettings: {
      findUnique: jest.fn().mockResolvedValue(
        opts.enforced === null ? null : { id: 'singleton', enforceSubscriptionAccess: opts.enforced ?? false },
      ),
    },
    subscription: { findUnique: jest.fn().mockResolvedValue(opts.subscription ?? null) },
  };
  return { service: new SubscriptionAccessService(prisma as any), prisma };
}

const sub = (over: Record<string, unknown> = {}, categories: TrainingCategory[] = ['CORE']) => ({
  status: SubscriptionStatus.ACTIVE,
  trialEndsAt: null,
  plan: { categories },
  ...over,
});

describe('SubscriptionAccessService.getAccessibleCategories', () => {
  it('sem assinatura → nenhuma categoria', async () => {
    const { service } = makeService({ subscription: null });
    await expect(service.getAccessibleCategories('s1', NOW)).resolves.toEqual([]);
  });

  it('ACTIVE → categorias do plano', async () => {
    const { service } = makeService({ subscription: sub({}, ['CORE', 'LPO']) });
    await expect(service.getAccessibleCategories('s1', NOW)).resolves.toEqual(['CORE', 'LPO']);
  });

  it.each([SubscriptionStatus.PAST_DUE, SubscriptionStatus.CANCELED])('%s → não libera (regra de carência ainda não decidida)', async status => {
    const { service } = makeService({ subscription: sub({ status }) });
    await expect(service.getAccessibleCategories('s1', NOW)).resolves.toEqual([]);
  });

  it('TRIALING dentro do prazo → libera', async () => {
    const { service } = makeService({ subscription: sub({ status: SubscriptionStatus.TRIALING, trialEndsAt: new Date(NOW.getTime() + DAY) }) });
    await expect(service.getAccessibleCategories('s1', NOW)).resolves.toEqual(['CORE']);
  });

  it('TRIALING sem data de fim → libera (não inventa expiração)', async () => {
    const { service } = makeService({ subscription: sub({ status: SubscriptionStatus.TRIALING }) });
    await expect(service.getAccessibleCategories('s1', NOW)).resolves.toEqual(['CORE']);
  });

  it('TRIALING com prazo vencido (job ainda não rodou) → não libera', async () => {
    const { service } = makeService({ subscription: sub({ status: SubscriptionStatus.TRIALING, trialEndsAt: new Date(NOW.getTime() - 1000) }) });
    await expect(service.getAccessibleCategories('s1', NOW)).resolves.toEqual([]);
  });

  it('plano desativado (active=false) NÃO corta quem já assina — o select nem lê `active`', async () => {
    const { service, prisma } = makeService({ subscription: sub() });
    await expect(service.getAccessibleCategories('s1', NOW)).resolves.toEqual(['CORE']);
    expect(prisma.subscription.findUnique).toHaveBeenCalledWith({ where: { studentId: 's1' }, include: ACCESS_INCLUDE });
    expect(JSON.stringify(ACCESS_INCLUDE.plan)).not.toContain('active');
  });
});

describe('SubscriptionAccessService — flag enforceSubscriptionAccess', () => {
  it('sem linha de settings → não aplica o bloqueio (default seguro)', async () => {
    const { service } = makeService({ enforced: null, subscription: null });
    await expect(service.isEnforced()).resolves.toBe(false);
  });

  it('desligada → acesso liberado mesmo sem assinatura (comportamento pré-v2), sem nem consultar a assinatura', async () => {
    const { service, prisma } = makeService({ enforced: false, subscription: null });
    await expect(service.canAccessCategory('s1', 'PERFORMANCE')).resolves.toBe(true);
    expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
  });

  it('ligada → só as categorias do plano', async () => {
    const { service } = makeService({ enforced: true, subscription: sub({}, ['CORE']) });
    await expect(service.canAccessCategory('s1', 'CORE')).resolves.toBe(true);
    await expect(service.canAccessCategory('s1', 'LPO')).resolves.toBe(false);
  });

  it('ligada + sem assinatura → nada liberado', async () => {
    const { service } = makeService({ enforced: true, subscription: null });
    await expect(service.canAccessCategory('s1', 'CORE')).resolves.toBe(false);
  });

  it('assertCanAccessCategory lança 403 quando o plano não inclui a categoria e passa quando inclui', async () => {
    const { service } = makeService({ enforced: true, subscription: sub({}, ['CORE']) });
    await expect(service.assertCanAccessCategory('s1', 'LPO')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.assertCanAccessCategory('s1', 'CORE')).resolves.toBeUndefined();
  });
});

describe('SubscriptionAccessService.getViewableCategories', () => {
  it('bloqueio desligado → todas as categorias (comportamento pré-v2), sem consultar a assinatura', async () => {
    const { service, prisma } = makeService({ enforced: false });
    await expect(service.getViewableCategories('s1')).resolves.toEqual(['CORE', 'LPO', 'PERFORMANCE']);
    expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
  });

  it('bloqueio ligado → só as categorias da assinatura', async () => {
    const { service } = makeService({ enforced: true, subscription: sub({}, ['LPO']) });
    await expect(service.getViewableCategories('s1')).resolves.toEqual(['LPO']);
  });

  it('bloqueio ligado e sem assinatura → nenhuma', async () => {
    const { service } = makeService({ enforced: true, subscription: null });
    await expect(service.getViewableCategories('s1')).resolves.toEqual([]);
  });
});

describe('SubscriptionAccessService.filterStudentsWithCategory', () => {
  const rows = [
    { studentId: 'a', ...sub({}, ['CORE']) },
    { studentId: 'b', ...sub({}, ['LPO']) },
    { studentId: 'c', ...sub({ status: SubscriptionStatus.PAST_DUE }, ['CORE']) },
    { studentId: 'f', ...sub({ status: SubscriptionStatus.PAST_DUE, gatewayPayments: [{ status: 'overdue', dueDate: new Date(NOW.getTime() - 2 * DAY) }] }, ['CORE']) },
    { studentId: 'g', ...sub({ gatewayPayments: [{ status: 'chargeback', dueDate: NOW }] }, ['CORE']) },
    { studentId: 'd', ...sub({ status: SubscriptionStatus.TRIALING, trialEndsAt: new Date(NOW.getTime() - DAY) }, ['CORE']) },
    { studentId: 'e', ...sub({ status: SubscriptionStatus.TRIALING, trialEndsAt: new Date(NOW.getTime() + DAY) }, ['CORE']) },
  ];

  it('lista vazia → vazia, sem consultar nada', async () => {
    const { service, prisma } = makeService({ enforced: true });
    await expect(service.filterStudentsWithCategory([], 'CORE', NOW)).resolves.toEqual([]);
    expect(prisma.platformSettings.findUnique).not.toHaveBeenCalled();
  });

  it('bloqueio desligado → todos passam, sem consultar assinaturas', async () => {
    const { service, prisma } = makeService({ enforced: false });
    await expect(service.filterStudentsWithCategory(['a', 'x'], 'CORE', NOW)).resolves.toEqual(['a', 'x']);
    expect((prisma.subscription as any).findMany).toBeUndefined();
  });

  it('bloqueio ligado → só quem tem a categoria com status válido (mesma regra do acesso individual), numa consulta só', async () => {
    const { service, prisma } = makeService({ enforced: true });
    (prisma.subscription as any).findMany = jest.fn().mockResolvedValue(rows);

    await expect(
      service.filterStudentsWithCategory(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'sem-assinatura'], 'CORE', NOW),
    ).resolves.toEqual(['a', 'f', 'e']);
    expect((prisma.subscription as any).findMany).toHaveBeenCalledTimes(1);
    expect((prisma.subscription as any).findMany.mock.calls[0][0].include).toBe(ACCESS_INCLUDE);
  });

  it('sem informar "now": usa a data atual por padrão', async () => {
    const { service } = makeService({ enforced: false });
    await expect(service.filterStudentsWithCategory(['a'], 'CORE')).resolves.toEqual(['a']);
  });
});

describe('accessState — regra única de acesso pela assinatura (decisões do dono, 2026-10-01)', () => {
  const vencida = (diasAtras: number) => ({ status: 'overdue' as const, dueDate: new Date(NOW.getTime() - diasAtras * DAY) });

  it('a regra pede só as cobranças vencidas e contestadas', () => {
    expect(ACCESS_INCLUDE.gatewayPayments.where).toEqual({ status: { in: ['overdue', 'chargeback'] } });
    // isFree é o que corta a amostra do Free: sem ele, o Free veria todas as semanas.
    expect(ACCESS_INCLUDE.plan.select).toEqual({ categories: true, isFree: true });
    expect(PAST_DUE_GRACE_DAYS).toBe(5);
  });

  it('sem assinatura ou cancelada → nada', () => {
    expect(accessState(null, NOW)).toEqual({ categories: [], graceUntil: null, chargeback: false, sampleWeeks: null });
    expect(accessState(sub({ status: SubscriptionStatus.CANCELED }), NOW).categories).toEqual([]);
  });

  it('inadimplente com a fatura mais antiga vencida há 2 dias: continua vendo, com o prazo (vencimento + 5 dias)', () => {
    const r = accessState(sub({ status: SubscriptionStatus.PAST_DUE, gatewayPayments: [vencida(1), vencida(2)] }), NOW);
    expect(r.categories).toEqual(['CORE']);
    expect(r.graceUntil).toEqual(new Date(NOW.getTime() + 3 * DAY));
    expect(r.chargeback).toBe(false);
  });

  it('inadimplente há 5 dias ou mais: perde o acesso (limite exato conta como fora)', () => {
    expect(accessState(sub({ status: SubscriptionStatus.PAST_DUE, gatewayPayments: [vencida(5)] }), NOW).categories).toEqual([]);
    expect(accessState(sub({ status: SubscriptionStatus.PAST_DUE, gatewayPayments: [vencida(1), vencida(9)] }), NOW).categories).toEqual([]);
  });

  it('inadimplente posto à mão pelo coach (sem fatura vencida no Asaas): sem tolerância', () => {
    expect(accessState(sub({ status: SubscriptionStatus.PAST_DUE }), NOW)).toEqual({ categories: [], graceUntil: null, chargeback: false, sampleWeeks: null });
  });

  it('cobrança contestada: sem acesso até resolver, mesmo com a assinatura ativa ou em teste', () => {
    const contestada = [{ status: 'chargeback' as const, dueDate: NOW }];
    expect(accessState(sub({ gatewayPayments: contestada }), NOW)).toEqual({ categories: [], graceUntil: null, chargeback: true, sampleWeeks: null });
    expect(accessState(sub({ status: SubscriptionStatus.TRIALING, gatewayPayments: contestada }), NOW).categories).toEqual([]);
  });
});

describe('SubscriptionAccessService.getAccessState', () => {
  it('consulta a assinatura com as cobranças vencidas/contestadas e devolve o estado', async () => {
    const { service, prisma } = makeService({
      subscription: sub({ status: SubscriptionStatus.PAST_DUE, gatewayPayments: [{ status: 'overdue', dueDate: new Date(NOW.getTime() - DAY) }] }),
    });
    const r = await service.getAccessState('s1', NOW);
    expect(prisma.subscription.findUnique).toHaveBeenCalledWith({ where: { studentId: 's1' }, include: ACCESS_INCLUDE });
    expect(r.graceUntil).toEqual(new Date(NOW.getTime() + 4 * DAY));
  });

  it('sem informar "now": usa a data atual', async () => {
    const { service } = makeService({ subscription: sub() });
    await expect(service.getAccessState('s1')).resolves.toMatchObject({ categories: ['CORE'] });
  });
});

describe('Free = amostra do Core (decisão do dono, 2026-10-01)', () => {
  it('Free ativo: libera as categorias do plano, mas só a 1ª semana; pago: sem limite', () => {
    expect(FREE_SAMPLE_WEEKS).toBe(1);
    expect(accessState(sub({}, ['CORE']), NOW)).toEqual({ categories: ['CORE'], graceUntil: null, chargeback: false, sampleWeeks: null });
    const free = { ...sub({}, ['CORE']), plan: { categories: ['CORE'] as TrainingCategory[], isFree: true } };
    expect(accessState(free, NOW)).toEqual({ categories: ['CORE'], graceUntil: null, chargeback: false, sampleWeeks: 1 });
  });

  it('weekLimit: com o bloqueio ligado vem da assinatura; desligado, sem limite (nem consulta)', async () => {
    const free = makeService({ enforced: true, subscription: { ...sub(), plan: { categories: ['CORE'], isFree: true } } });
    await expect(free.service.weekLimit('s1')).resolves.toBe(1);

    const pago = makeService({ enforced: true, subscription: sub() });
    await expect(pago.service.weekLimit('s1')).resolves.toBeNull();

    const desligado = makeService({ enforced: false, subscription: { ...sub(), plan: { categories: ['CORE'], isFree: true } } });
    await expect(desligado.service.weekLimit('s1')).resolves.toBeNull();
    expect(desligado.prisma.subscription.findUnique).not.toHaveBeenCalled();
  });
});
