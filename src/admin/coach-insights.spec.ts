import { coachAlerts, summarizeSubscriptions } from './coach-insights';

const sub = (status: any, priceCents = 10000) => ({ status, plan: { priceCents } });

describe('summarizeSubscriptions', () => {
  it('conta por situação e soma o MRR só de ativas e em teste (mesma definição do Financeiro do coach)', () => {
    const r = summarizeSubscriptions(
      [sub('ACTIVE', 14900), sub('ACTIVE', 9900), sub('TRIALING', 5000), sub('PAST_DUE', 14900), sub('CANCELED', 14900)],
      8,
    );
    expect(r).toEqual({ active: 2, trialing: 1, pastDue: 1, canceled: 1, withoutPlan: 4, mrrCents: 29800 });
  });

  it('sem assinaturas: todos sem plano, MRR 0', () => {
    expect(summarizeSubscriptions([], 3)).toEqual({ active: 0, trialing: 0, pastDue: 0, canceled: 0, withoutPlan: 3, mrrCents: 0 });
  });

  it('"sem plano" nunca fica negativo', () => {
    expect(summarizeSubscriptions([sub('ACTIVE'), sub('ACTIVE')], 1).withoutPlan).toBe(0);
  });
});

describe('coachAlerts', () => {
  it('tudo configurado: sem alerta', () => {
    expect(coachAlerts({ platformFeePercent: 10, walletId: 'c0c1688f-636b-42c0-b6ee-7339182276b7', pagePublished: true })).toEqual([]);
  });

  it('0% de contrato, sem carteira e página despublicada: os três alertas, nessa ordem', () => {
    expect(coachAlerts({ platformFeePercent: 0, walletId: null, pagePublished: false })).toEqual([
      'NO_CONTRACT', 'NO_WALLET', 'PAGE_UNPUBLISHED',
    ]);
  });

  it('carteira vazia conta como sem carteira', () => {
    expect(coachAlerts({ platformFeePercent: 5, walletId: '', pagePublished: true })).toEqual(['NO_WALLET']);
    // Carteira salva fora do formato (ex.: o código de teste só com zeros): alerta próprio, não "sem carteira".
    expect(coachAlerts({ platformFeePercent: 5, walletId: '00000000-0000-0000-0000-000000000000', pagePublished: true })).toEqual(['INVALID_WALLET']);
    expect(coachAlerts({ platformFeePercent: 5, walletId: 'minha-carteira', pagePublished: true })).toEqual(['INVALID_WALLET']);
  });
});
