import { ForbiddenException } from '@nestjs/common';
import { SubscriptionStatus, TrainingCategory } from '@prisma/client';
import { SubscriptionAccessService } from './subscription-access.service';

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
    expect(prisma.subscription.findUnique).toHaveBeenCalledWith({
      where: { studentId: 's1' },
      include: { plan: { select: { categories: true } } },
    });
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
