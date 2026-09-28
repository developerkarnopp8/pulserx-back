/**
 * Divisão real de uma cobrança do Asaas entre gateway, plataforma (AEVON) e coach.
 *
 * - `gross`: valor cobrado do aluno.
 * - `netValue`: o que sobra depois da taxa do Asaas — vem do PRÓPRIO pagamento no Asaas
 *   (`payment.netValue`), nunca estimado. Enquanto não existe (cobrança antiga/ainda não
 *   reconsultada), taxa/repasses ficam `null` em vez de um número inventado.
 * - `platformFeePercent`: o % da plataforma gravado NA ASSINATURA no checkout (o split do Asaas é
 *   criado junto da assinatura; se o admin muda o contrato depois, as antigas seguem o % antigo).
 *
 * O split percentual do Asaas incide sobre o valor LÍQUIDO (documentação do Asaas: "percentual
 * sobre o valor líquido da cobrança") — por isso plataforma/coach dividem `netValue`, não `gross`.
 */
export interface PaymentBreakdown {
  gross: number;
  gatewayFee: number | null;
  netValue: number | null;
  platformFeePercent: number | null;
  platformFee: number | null;
  coachNet: number | null;
}

const money = (n: number) => Math.round(n * 100) / 100;

export function paymentBreakdown(gross: number, netValue: number | null, platformFeePercent: number | null): PaymentBreakdown {
  if (netValue == null) {
    return { gross, gatewayFee: null, netValue: null, platformFeePercent, platformFee: null, coachNet: null };
  }
  const gatewayFee = money(gross - netValue);
  if (platformFeePercent == null) {
    return { gross, gatewayFee, netValue, platformFeePercent: null, platformFee: null, coachNet: null };
  }
  const platformFee = money((netValue * platformFeePercent) / 100);
  return { gross, gatewayFee, netValue, platformFeePercent, platformFee, coachNet: money(netValue - platformFee) };
}

export interface BreakdownTotals {
  count: number;
  gross: number;
  gatewayFee: number;
  platformFee: number;
  coachNet: number;
  /** Cobranças sem líquido/percentual ainda — ficam fora das somas de taxa/repasse. */
  pendingBreakdown: number;
}

/** Soma as divisões (só entram nas taxas/repasses as que têm o dado real completo). */
export function sumBreakdowns(list: PaymentBreakdown[]): BreakdownTotals {
  const totals: BreakdownTotals = { count: list.length, gross: 0, gatewayFee: 0, platformFee: 0, coachNet: 0, pendingBreakdown: 0 };
  for (const b of list) {
    totals.gross += b.gross;
    if (b.gatewayFee == null || b.platformFee == null || b.coachNet == null) {
      totals.pendingBreakdown++;
      continue;
    }
    totals.gatewayFee += b.gatewayFee;
    totals.platformFee += b.platformFee;
    totals.coachNet += b.coachNet;
  }
  return {
    ...totals,
    gross: money(totals.gross),
    gatewayFee: money(totals.gatewayFee),
    platformFee: money(totals.platformFee),
    coachNet: money(totals.coachNet),
  };
}
