import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasService } from '../common/asaas.service';
import { safeEqual } from '../common/safe-equal';

type LocalPaymentStatus = 'pending' | 'paid' | 'overdue' | 'refunded' | 'chargeback';

/** Estorno pedido, em andamento ou feito: o dinheiro volta (ou vai voltar) ao aluno. */
const ESTORNO = ['REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS'];
/** Contestação no cartão (chargeback), em disputa ou aguardando reversão. */
const CONTESTACAO = ['CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL'];

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
    if (ESTORNO.includes(asaasStatus)) return 'refunded';
    if (CONTESTACAO.includes(asaasStatus)) return 'chargeback';
    return 'pending';
  }

  async processPaymentEvent(event: string, paymentId: string): Promise<void> {
    const payment = await this.asaas.getPayment(paymentId);
    const status = this.mapStatus(payment.status);

    const existing = await this.prisma.gatewayPayment.findUnique({
      where: { asaasPaymentId: paymentId },
      select: { subscriptionId: true, paidAt: true },
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
          // A data do pagamento é a da 1ª confirmação: no cartão o Asaas avisa ao aprovar e de novo quando o dinheiro cai
          // (~30 dias depois) — regravar aqui mudaria a cobrança de mês no Financeiro.
          ...(status === 'paid' && !existing?.paidAt ? { paidAt: new Date() } : {}),
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
