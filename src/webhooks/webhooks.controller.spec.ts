import { BadRequestException } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

function build() {
  const service = { assertValidToken: jest.fn(), processPaymentEvent: jest.fn() };
  const controller = new WebhooksController(service as unknown as WebhooksService);
  return { controller, service };
}

describe('WebhooksController.asaas', () => {
  it('valida o token antes de tudo (o service decide se autentica ou lança 401)', async () => {
    const { controller, service } = build();
    await controller.asaas('token-1', { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1' } });
    expect(service.assertValidToken).toHaveBeenCalledWith('token-1');
  });

  it('processa o evento repassando event + payment.id', async () => {
    const { controller, service } = build();
    const result = await controller.asaas('token-1', { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1' } });
    expect(service.processPaymentEvent).toHaveBeenCalledWith('PAYMENT_CONFIRMED', 'pay_1');
    expect(result).toEqual({ received: true });
  });

  it('sem payment.id → 400, nunca chega a processar', async () => {
    const { controller, service } = build();
    await expect(controller.asaas('token-1', { event: 'PAYMENT_CONFIRMED' })).rejects.toThrow(BadRequestException);
    await expect(controller.asaas('token-1', {})).rejects.toThrow(BadRequestException);
    await expect(controller.asaas('token-1', { payment: { id: 123 } })).rejects.toThrow(BadRequestException);
    expect(service.processPaymentEvent).not.toHaveBeenCalled();
  });

  it('event ausente ou não-string: usa UNKNOWN como fallback, não quebra', async () => {
    const { controller, service } = build();
    await controller.asaas('token-1', { payment: { id: 'pay_1' } });
    expect(service.processPaymentEvent).toHaveBeenCalledWith('UNKNOWN', 'pay_1');

    await controller.asaas('token-1', { event: 42, payment: { id: 'pay_1' } });
    expect(service.processPaymentEvent).toHaveBeenCalledWith('UNKNOWN', 'pay_1');
  });
});
