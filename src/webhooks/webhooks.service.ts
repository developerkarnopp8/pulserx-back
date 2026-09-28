import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasService } from '../common/asaas.service';
import { safeEqual } from '../common/safe-equal';

type LocalPaymentStatus = 'pending' | 'paid' | 'overdue';

/**
 * Notificações do Asaas (pagamento confirmado/vencido). O corpo do webhook nunca é confiável
 * por si só — todo evento reconsulta o pagamento real na API do Asaas antes de gravar qualquer
 * coisa (evita um POST forjado mudar status de pagamento).
 */
@Injectable()
export class WebhooksService {
  constructor(
    private prisma: PrismaService,
    private asaas: AsaasService,
  ) {}

  /** Fail-closed: sem token configurado ou sem bater com o header, sempre 401 — nunca aceita sem validar. */
  assertValidToken(token: string | undefined): void {
    const expected = process.env.ASAAS_WEBHOOK_TOKEN;
    if (!expected || !token || !safeEqual(token, expected)) {
      throw new UnauthorizedException('Token de webhook inválido');
    }
  }

  private mapStatus(asaasStatus: string): LocalPaymentStatus {
    if (['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(asaasStatus)) return 'paid';
    if (asaasStatus === 'OVERDUE') return 'overdue';
    return 'pending';
  }

  async processPaymentEvent(event: string, paymentId: string): Promise<void> {
    const payment = await this.asaas.getPayment(paymentId);
    const status = this.mapStatus(payment.status);

    const existing = await this.prisma.gatewayPayment.findUnique({
      where: { asaasPaymentId: paymentId },
      select: { subscriptionId: true },
    });

    let subscriptionId = existing?.subscriptionId;
    if (!subscriptionId && payment.subscription) {
      const localSubscription = await this.prisma.subscription.findFirst({
        where: { gatewaySubscriptionId: payment.subscription },
        select: { id: true },
      });
      subscriptionId = localSubscription?.id;
    }

    if (subscriptionId) {
      await this.prisma.gatewayPayment.upsert({
        where: { asaasPaymentId: paymentId },
        create: {
          subscriptionId,
          asaasPaymentId: paymentId,
          status,
          amount: payment.value,
          netValue: payment.netValue ?? null,
          dueDate: new Date(payment.dueDate),
          invoiceUrl: payment.invoiceUrl,
          paidAt: status === 'paid' ? new Date() : null,
        },
        update: {
          status,
          invoiceUrl: payment.invoiceUrl,
          netValue: payment.netValue ?? null,
          ...(status === 'paid' ? { paidAt: new Date() } : {}),
        },
      });

      if (status === 'paid') {
        await this.prisma.subscription.updateMany({
          where: { id: subscriptionId, status: SubscriptionStatus.PAST_DUE },
          data: { status: SubscriptionStatus.ACTIVE },
        });
      } else if (status === 'overdue') {
        await this.prisma.subscription.updateMany({
          where: { id: subscriptionId, status: SubscriptionStatus.ACTIVE },
          data: { status: SubscriptionStatus.PAST_DUE },
        });
      }
    }

    // Nunca guarda o corpo cru do webhook (pode ter CPF/e-mail) — só o necessário pra auditoria.
    await this.prisma.webhookLog.create({
      data: { provider: 'ASAAS', event, asaasPaymentId: paymentId, processedAt: new Date() },
    });
  }
}
