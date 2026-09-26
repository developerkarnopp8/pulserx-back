import { SubscriptionPlansService } from './subscription-plans.service';
import { DEFAULT_PLAN_TEMPLATES } from './default-plans';

function makeService(existing: number) {
  const prisma = {
    subscriptionPlan: {
      count: jest.fn().mockResolvedValue(existing),
      createMany: jest.fn().mockImplementation(async ({ data }) => ({ count: data.length })),
    },
  };
  return { service: new SubscriptionPlansService(prisma as any), prisma };
}

describe('SubscriptionPlansService.ensureDefaultPlans', () => {
  it('coach sem planos → cria Combo/Core/LPO/Free, todos com o coachId', async () => {
    const { service, prisma } = makeService(0);

    await expect(service.ensureDefaultPlans('coach-1')).resolves.toEqual({ created: 4 });

    const { data } = prisma.subscriptionPlan.createMany.mock.calls[0][0];
    expect(data.map((p: any) => p.name)).toEqual(['Combo (Core + LPO + Performance)', 'Core', 'LPO', 'Free']);
    expect(data.every((p: any) => p.coachId === 'coach-1')).toBe(true);
  });

  it('idempotente: coach que já tem plano não recebe duplicata', async () => {
    const { service, prisma } = makeService(2);

    await expect(service.ensureDefaultPlans('coach-1')).resolves.toEqual({ created: 0 });
    expect(prisma.subscriptionPlan.createMany).not.toHaveBeenCalled();
  });
});

describe('DEFAULT_PLAN_TEMPLATES', () => {
  it('não inventa preço: todos em 0, e os pagos nascem inativos até o coach definir o valor', () => {
    expect(DEFAULT_PLAN_TEMPLATES.every(t => t.priceCents === 0)).toBe(true);
    expect(DEFAULT_PLAN_TEMPLATES.filter(t => !t.isFree).every(t => t.active === false)).toBe(true);
  });

  it('Combo inclui as 3 categorias; Core e LPO só a própria; Free não inclui nenhuma por padrão', () => {
    const byName = Object.fromEntries(DEFAULT_PLAN_TEMPLATES.map(t => [t.name.split(' ')[0], t]));
    expect(byName['Combo'].categories).toEqual(['CORE', 'LPO', 'PERFORMANCE']);
    expect(byName['Core'].categories).toEqual(['CORE']);
    expect(byName['LPO'].categories).toEqual(['LPO']);
    expect(byName['Free'].categories).toEqual([]);
    expect(byName['Free'].isFree).toBe(true);
  });
});
