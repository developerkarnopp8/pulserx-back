import { paymentBreakdown, sumBreakdowns } from './payment-breakdown';

describe('paymentBreakdown', () => {
  it('divide o líquido do Asaas entre plataforma e coach', () => {
    // R$ 99,00 cobrado, Asaas ficou com R$ 1,99 → líquido 97,01; plataforma 10%
    expect(paymentBreakdown(99, 97.01, 10)).toEqual({
      gross: 99, gatewayFee: 1.99, netValue: 97.01, platformFeePercent: 10, platformFee: 9.7, coachNet: 87.31,
    });
  });

  it('plataforma 0%: coach recebe todo o líquido', () => {
    expect(paymentBreakdown(100, 98, 0)).toMatchObject({ platformFee: 0, coachNet: 98 });
  });

  it('sem líquido do Asaas ainda: taxa e repasses null (não inventa)', () => {
    expect(paymentBreakdown(99, null, 10)).toEqual({
      gross: 99, gatewayFee: null, netValue: null, platformFeePercent: 10, platformFee: null, coachNet: null,
    });
  });

  it('sem % gravado na assinatura: taxa do gateway real, repasses null', () => {
    expect(paymentBreakdown(99, 97.01, null)).toEqual({
      gross: 99, gatewayFee: 1.99, netValue: 97.01, platformFeePercent: null, platformFee: null, coachNet: null,
    });
  });

  it('arredonda em centavos sem ruído de ponto flutuante', () => {
    const b = paymentBreakdown(0.3, 0.1, 33.33);
    expect(b.gatewayFee).toBe(0.2);
    expect(b.platformFee).toBe(0.03);
    expect(b.coachNet).toBe(0.07);
  });
});

describe('sumBreakdowns', () => {
  it('vazio: tudo zero', () => {
    expect(sumBreakdowns([])).toEqual({ count: 0, gross: 0, gatewayFee: 0, platformFee: 0, coachNet: 0, pendingBreakdown: 0 });
  });

  it('soma completas; incompletas entram só no bruto e contam como pendentes', () => {
    const totals = sumBreakdowns([
      paymentBreakdown(99, 97.01, 10),
      paymentBreakdown(99, 97.01, 10),
      paymentBreakdown(149.9, null, 10),
    ]);
    expect(totals).toEqual({ count: 3, gross: 347.9, gatewayFee: 3.98, platformFee: 19.4, coachNet: 174.62, pendingBreakdown: 1 });
  });
});
