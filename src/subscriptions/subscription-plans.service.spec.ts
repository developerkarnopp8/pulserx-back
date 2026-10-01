import { SubscriptionPlansService } from './subscription-plans.service';
import { DEFAULT_PLAN_TEMPLATES } from './default-plans';

function makeService(existing: number) {
  const prisma: any = {
    subscriptionPlan: {
      count: jest.fn().mockResolvedValue(existing),
      createMany: jest.fn().mockImplementation(async ({ data }) => ({ count: data.length })),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
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

  it('serializa por coach com lock de aconselhamento dentro da transação (2 acessos simultâneos não duplicam)', async () => {
    const { service, prisma } = makeService(0);

    await service.ensureDefaultPlans('coach-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = prisma.$executeRaw.mock.calls[0];
    expect(strings.join('?')).toContain('pg_advisory_xact_lock');
    expect(values).toEqual(['coach-1']); // parametrizado, nunca concatenado
    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.subscriptionPlan.count.mock.invocationCallOrder[0]);
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

  it('Combo inclui as 3 categorias; Core e LPO só a própria; Free mostra o Core como amostra (decisão do dono)', () => {
    const byName = Object.fromEntries(DEFAULT_PLAN_TEMPLATES.map(t => [t.name.split(' ')[0], t]));
    expect(byName['Combo'].categories).toEqual(['CORE', 'LPO', 'PERFORMANCE']);
    expect(byName['Core'].categories).toEqual(['CORE']);
    expect(byName['LPO'].categories).toEqual(['LPO']);
    expect(byName['Free'].categories).toEqual(['CORE']);
    expect(byName['Free'].description).toBe('Amostra do Core, para conhecer a plataforma.');
    expect(byName['Free'].isFree).toBe(true);
  });
});

describe('SubscriptionPlansService — catálogo (coach/admin)', () => {
  const coach = { id: 'coach-1', role: 'coach' };
  const admin = { id: 'admin-1', role: 'admin' };

  function build(plan: any = null) {
    const prisma: any = {
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'coach' }) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      subscriptionPlan: {
        count: jest.fn().mockResolvedValue(4),
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(plan),
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'novo', ...data })),
        update: jest.fn().mockImplementation(async ({ data }) => ({ id: 'p1', ...data })),
      },
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    return { service: new SubscriptionPlansService(prisma as any), prisma };
  }

  const existing = { id: 'p1', coachId: 'coach-1', isFree: false, priceCents: 14900, categories: ['CORE'] };
  const newPlan = { name: '  Core  ', priceCents: 14900, categories: ['CORE'] as any };

  describe('list', () => {
    it('coach lista o próprio catálogo (e garante os planos-modelo no 1º acesso)', async () => {
      const { service, prisma } = build();
      await service.list(coach);
      expect(prisma.subscriptionPlan.count).toHaveBeenCalledWith({ where: { coachId: 'coach-1' } });
      expect(prisma.subscriptionPlan.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { coachId: 'coach-1' } }));
    });

    it('IDOR: coach não lê o catálogo de outro coach', async () => {
      const { service, prisma } = build();
      await expect(service.list(coach, 'coach-9')).rejects.toThrow('Você não tem acesso a este catálogo.');
      expect(prisma.subscriptionPlan.findMany).not.toHaveBeenCalled();
    });

    it('coach pode informar o próprio id', async () => {
      const { service } = build();
      await expect(service.list(coach, 'coach-1')).resolves.toEqual([]);
    });

    it('admin precisa informar o coachId, e ele precisa ser um coach', async () => {
      const { service, prisma } = build();
      await expect(service.list(admin)).rejects.toThrow('Informe o coachId.');
      prisma.user.findUnique.mockResolvedValueOnce({ role: 'athlete' });
      await expect(service.list(admin, 'user-x')).rejects.toThrow('Coach não encontrado');
      prisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.list(admin, 'nao-existe')).rejects.toThrow('Coach não encontrado');
      await service.list(admin, 'coach-9');
      expect(prisma.subscriptionPlan.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { coachId: 'coach-9' } }));
    });

    it('aluno (ou qualquer outro papel) é barrado', async () => {
      const { service } = build();
      await expect(service.list({ id: 'a', role: 'athlete' })).rejects.toThrow('Você não tem acesso a este catálogo.');
    });
  });

  describe('create', () => {
    it('cria no catálogo do coach do token, com nome aparado e ativo por padrão', async () => {
      const { service, prisma } = build();
      await service.create(coach, newPlan);
      expect(prisma.subscriptionPlan.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ coachId: 'coach-1', name: 'Core', isFree: false, active: true, description: null }),
      });
    });

    it('admin cria no catálogo do coach informado', async () => {
      const { service, prisma } = build();
      await service.create(admin, newPlan, 'coach-9');
      expect(prisma.subscriptionPlan.create).toHaveBeenCalledWith({ data: expect.objectContaining({ coachId: 'coach-9' }) });
    });

    it('coach não cria no catálogo de outro', async () => {
      const { service, prisma } = build();
      await expect(service.create(coach, newPlan, 'coach-9')).rejects.toThrow('Você não tem acesso a este catálogo.');
      expect(prisma.subscriptionPlan.create).not.toHaveBeenCalled();
    });

    it('gratuito com preço → 400; pago sem categoria → 400', async () => {
      const { service, prisma } = build();
      await expect(service.create(coach, { ...newPlan, isFree: true, priceCents: 100 })).rejects.toThrow('Plano gratuito não pode ter preço.');
      await expect(service.create(coach, { ...newPlan, categories: [] })).rejects.toThrow('ao menos uma categoria');
      expect(prisma.subscriptionPlan.create).not.toHaveBeenCalled();
    });

    it('Free guarda freeConfig; plano pago descarta freeConfig enviado', async () => {
      const { service, prisma } = build();
      await service.create(coach, { name: 'Free', priceCents: 0, categories: [], isFree: true, freeConfig: { chat: true, sampleSessionsPerCategory: 2 } });
      expect(prisma.subscriptionPlan.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ freeConfig: { chat: true, sampleSessionsPerCategory: 2 } }),
      });

      await service.create(coach, { ...newPlan, freeConfig: { chat: true } });
      expect(prisma.subscriptionPlan.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ freeConfig: undefined }),
      });
    });

    it('descrição vazia vira null e a com texto é aparada', async () => {
      const { service, prisma } = build();
      await service.create(coach, { ...newPlan, description: '  Plano base  ' });
      expect(prisma.subscriptionPlan.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ description: 'Plano base' }) });
    });
  });

  describe('update', () => {
    it('coach dono edita; consistência usa os valores mesclados (preço novo + categorias atuais)', async () => {
      const { service, prisma } = build(existing);
      await service.update('p1', coach, { priceCents: 19900, name: ' Core Plus ', active: true, description: '  ', freeConfig: { fullHistory: true } });
      expect(prisma.subscriptionPlan.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: expect.objectContaining({
          priceCents: 19900, categories: ['CORE'], name: 'Core Plus', active: true, description: null, freeConfig: { fullHistory: true },
        }),
      });
    });

    it('sem campos: mantém preço/categorias/isFree atuais', async () => {
      const { service, prisma } = build(existing);
      await service.update('p1', coach, {});
      expect(prisma.subscriptionPlan.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { priceCents: 14900, categories: ['CORE'], isFree: false },
      });
    });

    it('IDOR: coach de outro catálogo é barrado; admin edita qualquer um', async () => {
      const { service, prisma } = build(existing);
      await expect(service.update('p1', { id: 'coach-9', role: 'coach' }, { active: false })).rejects.toThrow('Você não tem acesso a este plano.');
      expect(prisma.subscriptionPlan.update).not.toHaveBeenCalled();
      await service.update('p1', admin, { active: false });
      expect(prisma.subscriptionPlan.update).toHaveBeenCalled();
    });

    it('aluno é barrado; plano inexistente → 404', async () => {
      const { service } = build(existing);
      await expect(service.update('p1', { id: 'a', role: 'athlete' }, {})).rejects.toThrow('Você não tem acesso a este plano.');
      const { service: s2 } = build(null);
      await expect(s2.update('x', coach, {})).rejects.toThrow('Plano não encontrado');
    });

    it('não deixa virar inconsistente: tornar gratuito mantendo preço, ou zerar as categorias de um pago', async () => {
      const { service, prisma } = build(existing);
      await expect(service.update('p1', coach, { isFree: true })).rejects.toThrow('Plano gratuito não pode ter preço.');
      await expect(service.update('p1', coach, { categories: [] })).rejects.toThrow('ao menos uma categoria');
      expect(prisma.subscriptionPlan.update).not.toHaveBeenCalled();
    });
  });
});
