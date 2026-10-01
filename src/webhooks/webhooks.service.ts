import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasService } from '../common/asaas.service';
import { NotificationsService } from '../notifications/notifications.service';
import { safeEqual } from '../common/safe-equal';

type LocalPaymentStatus = 'pending' | 'paid' | 'overdue' | 'refunded' | 'chargeback';

/** Estorno pedido, em andamento ou feito: o dinheiro volta (ou vai voltar) ao aluno. */
const ESTORNO = ['REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS'];
/** Contestação no cartão (chargeback), em disputa ou aguardando reversão. */
const CONTESTACAO = ['CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL'];
/**
 * Cartão do débito automático recusado. O Asaas não muda o status da cobrança por isso (ela segue em aberto), então o sinal é
 * o nome do evento — vem de um webhook já autenticado pelo token, e só liga um aviso ao aluno (não muda valor nem acesso).
 */
const CARTAO_RECUSADO = ['PAYMENT_CREDIT_CARD_CAPTURE_REFUSED', 'PAYMENT_REPROVED_BY_RISK_ANALYSIS'];

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
    private notifications: NotificationsService,
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
      select: { subscriptionId: true, paidAt: true, cardRefusedAt: true },
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
      const recusado = CARTAO_RECUSADO.includes(event) && status !== 'paid';
      // Paga: o aviso de recusa some. Recusada: marca agora. Outro evento qualquer: não mexe.
      const cardRefusedAt = status === 'paid' ? null : recusado ? new Date() : undefined;
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
          cardRefusedAt: cardRefusedAt ?? null,
        },
        update: {
          status,
          invoiceUrl: payment.invoiceUrl,
          netValue: payment.netValue ?? null,
          // A data do pagamento é a da 1ª confirmação: no cartão o Asaas avisa ao aprovar e de novo quando o dinheiro cai
          // (~30 dias depois) — regravar aqui mudaria a cobrança de mês no Financeiro.
          ...(status === 'paid' && !existing?.paidAt ? { paidAt: new Date() } : {}),
          ...(cardRefusedAt !== undefined ? { cardRefusedAt } : {}),
        },
      });

      // O Asaas tenta o cartão até 3 vezes no dia: o aluno recebe UM aviso por cobrança (só na 1ª recusa).
      if (recusado && !existing?.cardRefusedAt) await this.notifyCardRefused(subscriptionId);

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

  /** Aviso ao aluno de que o cartão foi recusado. Falha no aviso nunca derruba o processamento do pagamento. */
  private async notifyCardRefused(subscriptionId: string): Promise<void> {
    const sub = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: { student: { select: { userId: true } } },
    });
    if (!sub) return;
    await this.notifications
      .create(
        sub.student.userId,
        'card_refused',
        'Não conseguimos cobrar no seu cartão',
        'A mensalidade continua em aberto. Pague pela fatura (PIX, boleto ou outro cartão) para não perder o acesso.',
        '/athlete/subscription',
      )
      .catch(() => undefined);
  }
}
