import { BreakdownTotals, paymentBreakdown, sumBreakdowns } from '../subscriptions/payment-breakdown';

export interface MonthRange {
  /** AAAA-MM */
  key: string;
  start: Date;
  end: Date;
}

/**
 * Os últimos `count` meses, do mais antigo ao atual (o atual conta). Mesmo corte de mês do Financeiro do coach
 * (`getMonthlyBreakdown`: fuso do servidor), para os dois painéis mostrarem o mesmo número para o mesmo mês.
 */
export function lastMonths(now: Date, count: number): MonthRange[] {
  const months: MonthRange[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
    months.push({ key, start, end });
  }
  return months;
}

export interface PaidPayment {
  amount: number;
  netValue: number | null;
  paidAt: Date;
  /** % da plataforma gravado NA ASSINATURA no checkout (o split do Asaas não muda depois). */
  platformFeePercent: number | null;
  coachId: string;
}

/**
 * Soma as cobranças PAGAS por coach e por mês do pagamento, com a divisão real (bruto → taxa do Asaas → AEVON →
 * coach) de `paymentBreakdown`. Cobrança sem líquido/percentual ainda entra no bruto e em `pendingBreakdown`,
 * nunca com taxa inventada. Pagamento fora dos meses pedidos é ignorado.
 */
export function groupByCoachAndMonth(
  payments: PaidPayment[],
  months: MonthRange[],
): { byCoach: Map<string, BreakdownTotals[]>; totals: BreakdownTotals[] } {
  const monthIndex = (d: Date) => months.findIndex(m => d >= m.start && d < m.end);
  const perCoach = new Map<string, ReturnType<typeof paymentBreakdown>[][]>();
  const perMonth: ReturnType<typeof paymentBreakdown>[][] = months.map(() => []);

  for (const p of payments) {
    const i = monthIndex(p.paidAt);
    if (i < 0) continue;
    const b = paymentBreakdown(p.amount, p.netValue, p.platformFeePercent);
    const lists = perCoach.get(p.coachId) ?? months.map(() => []);
    lists[i].push(b);
    perCoach.set(p.coachId, lists);
    perMonth[i].push(b);
  }

  const byCoach = new Map<string, BreakdownTotals[]>();
  for (const [coachId, lists] of perCoach) byCoach.set(coachId, lists.map(sumBreakdowns));
  return { byCoach, totals: perMonth.map(sumBreakdowns) };
}

/** Meses sem nenhuma cobrança paga (coach sem movimento). */
export function emptyMonths(months: MonthRange[]): BreakdownTotals[] {
  return months.map(() => sumBreakdowns([]));
}
