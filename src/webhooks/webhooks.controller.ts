import { BadRequestException, Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';

/** Endpoint público (chamado pelo Asaas, não por um usuário logado) — autenticado pelo próprio header do gateway. */
@ApiExcludeController()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  @Post('asaas')
  @HttpCode(200)
  async asaas(@Headers('asaas-access-token') token: string | undefined, @Body() body: any) {
    this.service.assertValidToken(token);

    const paymentId = body?.payment?.id;
    if (!paymentId || typeof paymentId !== 'string') {
      throw new BadRequestException('Payload sem payment.id');
    }

    await this.service.processPaymentEvent(typeof body.event === 'string' ? body.event : 'UNKNOWN', paymentId);
    return { received: true };
  }
}
