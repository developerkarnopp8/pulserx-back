import { SubscriptionsService } from './subscriptions.service';

const coach = { id: 'coach-1', role: 'coach' };
const admin = { id: 'admin-1', role: 'admin' };
const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

function build(over: { student?: any; plan?: any; current?: any; myStudent?: any; contract?: any } = {}) {
  const prisma = {
    student: {
      findUnique: jest.fn().mockResolvedValue('student' in over ? over.student : { id: 's1', coachId: 'coach-1' }),
      findFirst: jest.fn().mockResolvedValue(
        'myStudent' in over
          ? over.myStudent
          : { id: 's1', coachId: 'coach-1', cpf: null, asaasCustomerId: null, user: { name: 'Ana', email: 'ana@example.com' } },
      ),
      update: jest.fn().mockImplementation(async ({ data }) => ({ id: 's1', ...data })),
    },
    subscriptionPlan: {
      findUnique: jest.fn().mockResolvedValue(
        'plan' in over ? over.plan : { id: 'p1', coachId: 'coach-1', active: true, isFree: false, priceCents: 14900 },
      ),
    },
    subscription: {
      findUnique: jest.fn().mockResolvedValue('current' in over ? over.current : null),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'sub1' }),
      upsert: jest.fn().mockImplementation(async ({ create }) => ({ id: 'sub1', ...create })),
      update: jest.fn().mockImplementation(async ({ data }) => ({ id: 'sub1', studentId: 's1', ...data })),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    gatewayPayment: {
      upsert: jest.fn().mockResolvedValue({ id: 'pay1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $executeRaw: jest.fn().mockResolvedValue(undefined),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
  const access = { getViewableCategories: jest.fn().mockResolvedValue(['CORE']) };
  const notifications = { create: jest.fn() };
  const coachContracts = {
    getContractForCharge: jest.fn().mockResolvedValue(
      'contract' in over ? over.contract : { walletId: 'wallet-1', platformFeePercent: 20 },
    ),
  };
  const asaas = {
    createCustomer: jest.fn().mockResolvedValue({ id: 'cus_1' }),
    createSubscription: jest.fn().mockResolvedValue({ id: 'sub_asaas_1' }),
    cancelSubscription: jest.fn().mockResolvedValue(undefined),
    listPaymentsBySubscription: jest.fn().mockResolvedValue([
      { id: 'pay_1', value: 149, dueDate: '2026-10-01', invoiceUrl: 'https://asaas.com/i/pay_1' },
    ]),
  };
  return {
    service: new SubscriptionsService(prisma as any, access as any, notifications as any, coachContracts as any, asaas as any),
    prisma, access, notifications, coachContracts, asaas,
  };
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

describe('SubscriptionsService.cancelMine', () => {
  const athlete = { id: 'u1', role: 'athlete' };

  it('cancela a própria assinatura e notifica o coach dono do aluno', async () => {
    const { service, prisma, notifications } = build({ current: { id: 'sub1', status: 'ACTIVE' } });

    const result = await service.cancelMine(athlete);

    expect(prisma.subscription.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { studentId: 's1' },
      data: expect.objectContaining({ status: 'CANCELED', canceledAt: expect.any(Date) }),
    }));
    expect(result).toEqual(expect.objectContaining({ status: 'CANCELED' }));
    expect(notifications.create).toHaveBeenCalledWith(
      'coach-1', 'subscription_canceled', 'Assinatura cancelada',
      expect.stringContaining('Ana'), '/coach/students',
    );
  });

  it('sem perfil de aluno vinculado ao usuário → 404, sem tocar em nada', async () => {
    const { service, prisma, notifications } = build();
    prisma.student.findFirst.mockResolvedValue(null);

    await expect(service.cancelMine(athlete)).rejects.toThrow('Perfil de aluno não encontrado');
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('sem assinatura nenhuma → 404, sem notificar', async () => {
    const { service, prisma, notifications } = build({ current: null });

    await expect(service.cancelMine(athlete)).rejects.toThrow('Você não tem uma assinatura ativa.');
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('já cancelada: idempotente, devolve como está sem notificar de novo', async () => {
    const { service, prisma, notifications } = build({ current: { id: 'sub1', status: 'CANCELED' } });

    const result = await service.cancelMine(athlete);

    expect(result).toEqual({ id: 'sub1', status: 'CANCELED' });
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('com assinatura no gateway: cancela no Asaas ANTES de mudar o status local', async () => {
    const { service, prisma, asaas } = build({
      current: { id: 'sub1', status: 'ACTIVE', gatewaySubscriptionId: 'sub_asaas_1' },
    });

    await service.cancelMine(athlete);

    expect(asaas.cancelSubscription).toHaveBeenCalledWith('sub_asaas_1');
    expect(prisma.subscription.update).toHaveBeenCalled();
  });

  it('se o Asaas rejeitar o cancelamento, a assinatura local continua intacta', async () => {
    const { service, prisma, asaas } = build({
      current: { id: 'sub1', status: 'ACTIVE', gatewaySubscriptionId: 'sub_asaas_1' },
    });
    asaas.cancelSubscription.mockRejectedValue(new Error('Asaas fora do ar'));

    await expect(service.cancelMine(athlete)).rejects.toThrow('Asaas fora do ar');
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('já cancelada: nunca chama o gateway de novo, mesmo com gatewaySubscriptionId salvo', async () => {
    const { service, asaas } = build({
      current: { id: 'sub1', status: 'CANCELED', gatewaySubscriptionId: 'sub_asaas_1' },
    });

    const result = await service.cancelMine(athlete);

    expect(asaas.cancelSubscription).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('gatewaySubscriptionId');
  });
});

describe('SubscriptionsService.checkout', () => {
  const athlete = { id: 'u1', role: 'athlete' };

  it('plano gratuito: assina direto, sem gateway nem checkoutUrl', async () => {
    const { service, prisma, coachContracts, asaas } = build({
      plan: { id: 'p1', coachId: 'coach-1', active: true, isFree: true, priceCents: 0 },
    });

    const result = await service.checkout(athlete, { planId: 'p1' });

    expect(result).toEqual({ subscription: expect.objectContaining({ status: 'ACTIVE' }), checkoutUrl: null });
    expect(prisma.subscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { studentId: 's1' },
      create: { studentId: 's1', planId: 'p1', status: 'ACTIVE' },
    }));
    expect(coachContracts.getContractForCharge).not.toHaveBeenCalled();
    expect(asaas.createSubscription).not.toHaveBeenCalled();
  });

  it('plano de outro coach ou inativo → 404, nada é gravado', async () => {
    const other = build({ plan: { id: 'p1', coachId: 'coach-9', active: true, isFree: true, priceCents: 0 } });
    await expect(other.service.checkout(athlete, { planId: 'p1' })).rejects.toThrow('Plano não encontrado');

    const inactive = build({ plan: { id: 'p1', coachId: 'coach-1', active: false, isFree: false, priceCents: 14900 } });
    await expect(inactive.service.checkout(athlete, { planId: 'p1' })).rejects.toThrow('Plano não encontrado');
  });

  it('usuário sem perfil de aluno → 404', async () => {
    const { service, prisma } = build();
    prisma.student.findFirst.mockResolvedValue(null);
    await expect(service.checkout(athlete, { planId: 'p1' })).rejects.toThrow('Perfil de aluno não encontrado');
  });

  it('plano pago sem o coach ter cadastrado carteira → 400, nada é criado no Asaas', async () => {
    const { service, asaas } = build({ contract: { walletId: null, platformFeePercent: 20 } });
    await expect(service.checkout(athlete, { planId: 'p1', cpf: '529.982.247-25' })).rejects.toThrow('não configurou o recebimento');
    expect(asaas.createSubscription).not.toHaveBeenCalled();
  });

  it('plano pago, aluno sem CPF salvo e sem CPF no corpo → 400', async () => {
    const { service } = build();
    await expect(service.checkout(athlete, { planId: 'p1' })).rejects.toThrow('Informe um CPF válido');
  });

  it('plano pago, CPF inválido no corpo → 400, não chega a chamar o Asaas', async () => {
    const { service, asaas } = build();
    await expect(service.checkout(athlete, { planId: 'p1', cpf: '111.111.111-11' })).rejects.toThrow('Informe um CPF válido');
    expect(asaas.createSubscription).not.toHaveBeenCalled();
  });

  it('plano pago, primeiro checkout: salva CPF, cria customer no Asaas, cria assinatura e o pagamento gerado', async () => {
    const { service, prisma, asaas } = build();

    const result = await service.checkout(athlete, { planId: 'p1', cpf: '529.982.247-25' });

    expect(prisma.student.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { cpf: '52998224725' } });
    expect(asaas.createCustomer).toHaveBeenCalledWith('Ana', 'ana@example.com', '52998224725');
    expect(prisma.student.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { asaasCustomerId: 'cus_1' } });
    expect(asaas.createSubscription).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'cus_1', valueCents: 14900, walletId: 'wallet-1', coachPercent: 80, externalReference: 's1',
    }));
    expect(prisma.subscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { studentId: 's1' },
      create: expect.objectContaining({ status: 'PAST_DUE', gateway: 'ASAAS', gatewaySubscriptionId: 'sub_asaas_1' }),
    }));
    expect(prisma.gatewayPayment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { asaasPaymentId: 'pay_1' },
      create: expect.objectContaining({ subscriptionId: 'sub1', asaasPaymentId: 'pay_1', invoiceUrl: 'https://asaas.com/i/pay_1' }),
    }));
    expect(result).toEqual({ subscription: expect.anything(), checkoutUrl: 'https://asaas.com/i/pay_1' });
  });

  it('aluno que já tem CPF/customer salvos: reusa os dois, não grava de novo nem exige CPF no corpo', async () => {
    const { service, prisma, asaas } = build({
      myStudent: { id: 's1', coachId: 'coach-1', cpf: '52998224725', asaasCustomerId: 'cus_existente', user: { name: 'Ana', email: 'ana@example.com' } },
    });

    await service.checkout(athlete, { planId: 'p1' });

    expect(prisma.student.update).not.toHaveBeenCalled();
    expect(asaas.createCustomer).not.toHaveBeenCalled();
    expect(asaas.createSubscription).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_existente' }));
  });

  it('Asaas não gera pagamento na hora (lista vazia): checkoutUrl null, sem gravar GatewayPayment', async () => {
    const { service, prisma, asaas } = build();
    asaas.listPaymentsBySubscription.mockResolvedValue([]);

    const result = await service.checkout(athlete, { planId: 'p1', cpf: '529.982.247-25' });

    expect(result.checkoutUrl).toBeNull();
    expect(prisma.gatewayPayment.upsert).not.toHaveBeenCalled();
  });

  it('usa o lock de aconselhamento do Postgres por aluno (evita duas assinaturas concorrentes)', async () => {
    const { service, prisma } = build();
    await service.checkout(athlete, { planId: 'p1', cpf: '529.982.247-25' });
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 15_000 });
  });

  it('já tem assinatura paga anterior: cancela no Asaas ANTES de criar a nova (troca de plano/retry não duplica cobrança)', async () => {
    const { service, asaas } = build({ current: { gatewaySubscriptionId: 'sub_asaas_antiga' } });

    await service.checkout(athlete, { planId: 'p1', cpf: '529.982.247-25' });

    expect(asaas.cancelSubscription).toHaveBeenCalledWith('sub_asaas_antiga');
    expect(asaas.createSubscription).toHaveBeenCalled();
  });

  it('se o cancelamento da assinatura anterior falhar, o checkout inteiro falha (fail-closed) e NÃO cria uma nova', async () => {
    const { service, asaas } = build({ current: { gatewaySubscriptionId: 'sub_asaas_antiga' } });
    asaas.cancelSubscription.mockRejectedValue(new Error('Asaas fora do ar'));

    await expect(service.checkout(athlete, { planId: 'p1', cpf: '529.982.247-25' })).rejects.toThrow('Asaas fora do ar');
    expect(asaas.createSubscription).not.toHaveBeenCalled();
  });

  it('downgrade pro Free com assinatura paga anterior: cancela a antiga no Asaas e limpa gateway/gatewaySubscriptionId local', async () => {
    const { service, prisma, asaas } = build({
      plan: { id: 'p1', coachId: 'coach-1', active: true, isFree: true, priceCents: 0 },
      current: { gatewaySubscriptionId: 'sub_asaas_antiga' },
    });

    const result = await service.checkout(athlete, { planId: 'p1' });

    expect(asaas.cancelSubscription).toHaveBeenCalledWith('sub_asaas_antiga');
    expect(prisma.subscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: 'ACTIVE', gateway: null, gatewaySubscriptionId: null }),
    }));
    expect(result.checkoutUrl).toBeNull();
  });

  it('sem assinatura anterior (primeira vez): não chama cancelSubscription', async () => {
    const { service, asaas } = build({ current: null });
    await service.checkout(athlete, { planId: 'p1', cpf: '529.982.247-25' });
    expect(asaas.cancelSubscription).not.toHaveBeenCalled();
  });
});

describe('SubscriptionsService.listGatewayPayments', () => {
  it('busca as cobranças escopadas pelo coachId, mais recentes primeiro', async () => {
    const { service, prisma } = build();
    await service.listGatewayPayments('coach-1');
    expect(prisma.gatewayPayment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { subscription: { student: { coachId: 'coach-1' } } },
      orderBy: { createdAt: 'desc' },
    }));
  });

  it('a seleção nunca inclui gatewaySubscriptionId nem dado do CoachContract (walletId/%)', async () => {
    const { service, prisma } = build();
    await service.listGatewayPayments('coach-1');
    const call = prisma.gatewayPayment.findMany.mock.calls[0][0];
    expect(call.select).not.toHaveProperty('gatewaySubscriptionId');
    expect(JSON.stringify(call.select)).not.toContain('walletId');
    expect(JSON.stringify(call.select)).not.toContain('platformFeePercent');
  });

  it('devolve a lista tal como o prisma resolve', async () => {
    const rows = [{ id: 'pay1', status: 'paid' }];
    const { service, prisma } = build();
    prisma.gatewayPayment.findMany.mockResolvedValue(rows);
    await expect(service.listGatewayPayments('coach-1')).resolves.toBe(rows);
  });
});
