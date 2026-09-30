import { emptyMonths, groupByCoachAndMonth, lastMonths } from './financial-months';

describe('lastMonths', () => {
  it('6 meses do mais antigo ao atual, virando o ano', () => {
    const m = lastMonths(new Date(2026, 1, 15), 6); // fevereiro/2026
    expect(m.map(x => x.key)).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
    expect(m[0].start).toEqual(new Date(2025, 8, 1));
    expect(m[5].end).toEqual(new Date(2026, 2, 1));
  });

  it('cada mês termina onde o próximo começa (sem buraco nem sobreposição)', () => {
    const m = lastMonths(new Date(2026, 8, 30), 3);
    expect(m[0].end).toEqual(m[1].start);
    expect(m[1].end).toEqual(m[2].start);
  });
});

describe('groupByCoachAndMonth', () => {
  const meses = lastMonths(new Date(2026, 8, 20), 2); // agosto e setembro/2026

  it('divide por coach e mês com a conta real: bruto → taxa do Asaas → AEVON (% da assinatura) → coach', () => {
    const { byCoach, totals } = groupByCoachAndMonth(
      [
        // Setembro, coach A: R$ 100 bruto, R$ 97 líquido, 10% → AEVON 9,70 / coach 87,30
        { amount: 100, netValue: 97, paidAt: new Date(2026, 8, 5), platformFeePercent: 10, coachId: 'A' },
        // Setembro, coach A: assinatura antiga com 20% (o % gravado nela vale, não o do contrato de hoje)
        { amount: 50, netValue: 48, paidAt: new Date(2026, 8, 6), platformFeePercent: 20, coachId: 'A' },
        // Agosto, coach B
        { amount: 200, netValue: 195, paidAt: new Date(2026, 7, 31, 23, 59), platformFeePercent: 0, coachId: 'B' },
      ],
      meses,
    );
    expect(byCoach.get('A')![1]).toEqual({
      count: 2, gross: 150, gatewayFee: 5, platformFee: 19.3, coachNet: 125.7, pendingBreakdown: 0,
    });
    expect(byCoach.get('A')![0]).toMatchObject({ count: 0, gross: 0 });
    expect(byCoach.get('B')![0]).toMatchObject({ count: 1, gross: 200, gatewayFee: 5, platformFee: 0, coachNet: 195 });
    expect(totals[1]).toMatchObject({ count: 2, gross: 150, platformFee: 19.3 });
    expect(totals[0]).toMatchObject({ count: 1, gross: 200 });
  });

  it('cobrança sem líquido ainda: entra no bruto e em pendingBreakdown, sem taxa inventada', () => {
    const { byCoach } = groupByCoachAndMonth(
      [{ amount: 80, netValue: null, paidAt: new Date(2026, 8, 1), platformFeePercent: 10, coachId: 'A' }],
      meses,
    );
    expect(byCoach.get('A')![1]).toEqual({ count: 1, gross: 80, gatewayFee: 0, platformFee: 0, coachNet: 0, pendingBreakdown: 1 });
  });

  it('pagamento fora dos meses pedidos é ignorado', () => {
    const { byCoach, totals } = groupByCoachAndMonth(
      [
        { amount: 10, netValue: 9, paidAt: new Date(2026, 6, 31), platformFeePercent: 0, coachId: 'A' },
        { amount: 10, netValue: 9, paidAt: new Date(2026, 9, 1), platformFeePercent: 0, coachId: 'A' },
      ],
      meses,
    );
    expect(byCoach.size).toBe(0);
    expect(totals.every(t => t.count === 0)).toBe(true);
  });

  it('emptyMonths: um total zerado por mês', () => {
    expect(emptyMonths(meses)).toEqual([
      { count: 0, gross: 0, gatewayFee: 0, platformFee: 0, coachNet: 0, pendingBreakdown: 0 },
      { count: 0, gross: 0, gatewayFee: 0, platformFee: 0, coachNet: 0, pendingBreakdown: 0 },
    ]);
  });
});
