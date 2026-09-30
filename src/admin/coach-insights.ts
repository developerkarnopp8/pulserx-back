import { SubscriptionStatus } from '@prisma/client';

export interface SubscriptionRow {
  status: SubscriptionStatus;
  plan: { priceCents: number };
}

export interface SubscriptionSummary {
  active: number;
  trialing: number;
  pastDue: number;
  canceled: number;
  /** Alunos ativos sem assinatura nenhuma, ou com a assinatura cancelada. */
  withoutPlan: number;
  /** Receita mensal recorrente: mesma definição do Financeiro do coach (ACTIVE + TRIALING, preço do plano). */
  mrrCents: number;
}

/** Resumo das assinaturas dos alunos ATIVOS de um coach. */
export function summarizeSubscriptions(subscriptions: SubscriptionRow[], activeStudents: number): SubscriptionSummary {
  const count = (status: SubscriptionStatus) => subscriptions.filter(s => s.status === status).length;
  const active = count(SubscriptionStatus.ACTIVE);
  const trialing = count(SubscriptionStatus.TRIALING);
  const pastDue = count(SubscriptionStatus.PAST_DUE);
  const canceled = count(SubscriptionStatus.CANCELED);
  const mrrCents = subscriptions
    .filter(s => s.status === SubscriptionStatus.ACTIVE || s.status === SubscriptionStatus.TRIALING)
    .reduce((sum, s) => sum + s.plan.priceCents, 0);
  return {
    active,
    trialing,
    pastDue,
    canceled,
    withoutPlan: Math.max(0, activeStudents - (active + trialing + pastDue)),
    mrrCents,
  };
}

/** O que o admin precisa resolver antes de o coach cobrar direito. */
export type CoachAlert = 'NO_CONTRACT' | 'NO_WALLET' | 'PAGE_UNPUBLISHED';

export function coachAlerts(input: {
  platformFeePercent: number;
  walletId: string | null;
  pagePublished: boolean;
}): CoachAlert[] {
  const alerts: CoachAlert[] = [];
  // Sem contrato (ou 0%): a AEVON recebe 0% das cobranças novas deste coach.
  if (input.platformFeePercent <= 0) alerts.push('NO_CONTRACT');
  // Sem carteira no Asaas: o aluno não consegue assinar plano pago.
  if (!input.walletId) alerts.push('NO_WALLET');
  // Sem página publicada: ninguém consegue se inscrever pela landing.
  if (!input.pagePublished) alerts.push('PAGE_UNPUBLISHED');
  return alerts;
}
