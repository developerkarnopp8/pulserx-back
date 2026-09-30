import { UnauthorizedException } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

function build(over: { existingPayment?: any; localSubscription?: any } = {}) {
  const prisma = {
    gatewayPayment: {
      findUnique: jest.fn().mockResolvedValue('existingPayment' in over ? over.existingPayment : null),
      upsert: jest.fn().mockResolvedValue({ id: 'gp1' }),
    },
    subscription: {
      findFirst: jest.fn().mockResolvedValue('localSubscription' in over ? over.localSubscription : { id: 'sub1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    webhookLog: {
      create: jest.fn().mockResolvedValue({ id: 'log1' }),
    },
  };
  const asaas = {
    getPayment: jest.fn().mockResolvedValue({
      id: 'pay_1', status: 'CONFIRMED', value: 149, netValue: 147.01, dueDate: '2026-10-01',
      invoiceUrl: 'https://asaas.com/i/pay_1', subscription: 'sub_asaas_1',
    }),
  };
  return { service: new WebhooksService(prisma as any, asaas as any), prisma, asaas };
}

describe('WebhooksService.assertValidToken', () => {
  const OLD_ENV = { ...process.env };
  afterEach(() => { process.env = { ...OLD_ENV }; });

  it('sem ASAAS_WEBHOOK_TOKEN configurado: sempre 401 (fail-closed), mesmo com header presente', () => {
    delete process.env.ASAAS_WEBHOOK_TOKEN;
    const { service } = build();
    expect(() => service.assertValidToken('qualquer-coisa')).toThrow(UnauthorizedException);
  });

  it('sem header: 401', () => {
    process.env.ASAAS_WEBHOOK_TOKEN = 'segredo-123';
    const { service } = build();
    expect(() => service.assertValidToken(undefined)).toThrow(UnauthorizedException);
  });

  it('header errado: 401', () => {
    process.env.ASAAS_WEBHOOK_TOKEN = 'segredo-123';
    const { service } = build();
    expect(() => service.assertValidToken('errado')).toThrow(UnauthorizedException);
  });

  it('header correto: passa sem lançar', () => {
    process.env.ASAAS_WEBHOOK_TOKEN = 'segredo-123';
    const { service } = build();
    expect(() => service.assertValidToken('segredo-123')).not.toThrow();
  });
});

describe('WebhooksService.processPaymentEvent', () => {
  it('nunca confia no corpo do evento — sempre reconsulta o pagamento real na Asaas', async () => {
    const { service, asaas } = build();
    await service.processPaymentEvent('PAYMENT_CONFIRMED', 'pay_1');
    expect(asaas.getPayment).toHaveBeenCalledWith('pay_1');
  });

  it('pagamento já rastreado localmente (checkout): status CONFIRMED → paid, ativa a assinatura PAST_DUE', async () => {
    const { service, prisma } = build({ existingPayment: { subscriptionId: 'sub1' } });

    await service.processPaymentEvent('PAYMENT_CONFIRMED', 'pay_1');

    expect(prisma.gatewayPayment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { asaasPaymentId: 'pay_1' },
      update: expect.objectContaining({ status: 'paid', paidAt: expect.any(Date), netValue: 147.01 }),
    }));
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub1', status: 'PAST_DUE' },
      data: { status: 'ACTIVE' },
    });
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
  });

  it('pagamento de um novo ciclo (nunca visto): resolve a assinatura local pelo gatewaySubscriptionId e cria o registro', async () => {
    const { service, prisma } = build({ existingPayment: null, localSubscription: { id: 'sub9' } });

    await service.processPaymentEvent('PAYMENT_CONFIRMED', 'pay_1');

    expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
      where: { gatewaySubscriptionId: 'sub_asaas_1' },
      select: { id: true },
    });
    expect(prisma.gatewayPayment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ subscriptionId: 'sub9', asaasPaymentId: 'pay_1', status: 'paid', netValue: 147.01 }),
    }));
  });

  it('Asaas sem netValue: grava null (a taxa nunca é estimada)', async () => {
    const { service, prisma, asaas } = build({ existingPayment: { subscriptionId: 'sub1' } });
    asaas.getPayment.mockResolvedValue({ id: 'pay_1', status: 'PENDING', value: 149, dueDate: '2026-10-01', invoiceUrl: 'x', subscription: 'sub_asaas_1' });
    await service.processPaymentEvent('PAYMENT_CREATED', 'pay_1');
    const call = prisma.gatewayPayment.upsert.mock.calls[0][0];
    expect(call.create.netValue).toBeNull();
    expect(call.update.netValue).toBeNull();
  });

  it('pagamento sem assinatura local correspondente: só loga, não grava GatewayPayment nem mexe em Subscription', async () => {
    const { service, prisma } = build({ existingPayment: null, localSubscription: null });

    await service.processPaymentEvent('PAYMENT_CONFIRMED', 'pay_1');

    expect(prisma.gatewayPayment.upsert).not.toHaveBeenCalled();
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
    expect(prisma.webhookLog.create).toHaveBeenCalledWith({
      data: { provider: 'ASAAS', event: 'PAYMENT_CONFIRMED', asaasPaymentId: 'pay_1', processedAt: expect.any(Date) },
    });
  });

  it('status OVERDUE: marca vencido e derruba a assinatura ACTIVE pra PAST_DUE', async () => {
    const { service, prisma, asaas } = build({ existingPayment: { subscriptionId: 'sub1' } });
    asaas.getPayment.mockResolvedValue({ id: 'pay_1', status: 'OVERDUE', value: 149, dueDate: '2026-10-01', invoiceUrl: 'x', subscription: 'sub_asaas_1' });

    await service.processPaymentEvent('PAYMENT_OVERDUE', 'pay_1');

    expect(prisma.gatewayPayment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: 'overdue' }),
    }));
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub1', status: 'ACTIVE' },
      data: { status: 'PAST_DUE' },
    });
  });

  it('status desconhecido/pendente: grava como pending, não mexe na assinatura', async () => {
    const { service, prisma, asaas } = build({ existingPayment: { subscriptionId: 'sub1' } });
    asaas.getPayment.mockResolvedValue({ id: 'pay_1', status: 'PENDING', value: 149, dueDate: '2026-10-01', invoiceUrl: 'x', subscription: 'sub_asaas_1' });

    await service.processPaymentEvent('PAYMENT_CREATED', 'pay_1');

    expect(prisma.gatewayPayment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: 'pending' }),
    }));
    expect(prisma.gatewayPayment.upsert.mock.calls[0][0].update).not.toHaveProperty('paidAt');
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('já estava paga (cartão: aprovado e depois "dinheiro caiu"): mantém a data da 1ª confirmação', async () => {
    const { service, prisma, asaas } = build({ existingPayment: { subscriptionId: 'sub1', paidAt: new Date('2026-10-01T12:00:00Z') } });
    asaas.getPayment.mockResolvedValue({ id: 'pay_1', status: 'RECEIVED', value: 149, netValue: 140, dueDate: '2026-10-01', invoiceUrl: 'x', subscription: 'sub_asaas_1' });

    await service.processPaymentEvent('PAYMENT_RECEIVED', 'pay_1');

    const { update } = prisma.gatewayPayment.upsert.mock.calls[0][0];
    expect(update.status).toBe('paid');
    expect(update).not.toHaveProperty('paidAt');
  });

  it.each([
    ['REFUNDED', 'refunded'],
    ['REFUND_REQUESTED', 'refunded'],
    ['REFUND_IN_PROGRESS', 'refunded'],
    ['CHARGEBACK_REQUESTED', 'chargeback'],
    ['CHARGEBACK_DISPUTE', 'chargeback'],
    ['AWAITING_CHARGEBACK_REVERSAL', 'chargeback'],
  ])('%s → %s: sai dos totais recebidos, guarda a data antiga e não mexe na assinatura', async (asaasStatus, local) => {
    const { service, prisma, asaas } = build({ existingPayment: { subscriptionId: 'sub1', paidAt: new Date('2026-10-01T12:00:00Z') } });
    asaas.getPayment.mockResolvedValue({ id: 'pay_1', status: asaasStatus, value: 149, dueDate: '2026-10-01', invoiceUrl: 'x', subscription: 'sub_asaas_1' });

    await service.processPaymentEvent('PAYMENT_UPDATED', 'pay_1');

    const { update } = prisma.gatewayPayment.upsert.mock.calls[0][0];
    expect(update.status).toBe(local);
    expect(update).not.toHaveProperty('paidAt');
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('sempre grava o WebhookLog, sem nunca guardar o corpo cru do evento', async () => {
    const { service, prisma } = build({ existingPayment: { subscriptionId: 'sub1' } });

    await service.processPaymentEvent('PAYMENT_CONFIRMED', 'pay_1');

    const call = prisma.webhookLog.create.mock.calls[0][0];
    expect(call.data).toEqual({ provider: 'ASAAS', event: 'PAYMENT_CONFIRMED', asaasPaymentId: 'pay_1', processedAt: expect.any(Date) });
  });
});
