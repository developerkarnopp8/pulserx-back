import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AssignSubscriptionDto, CreateSubscriptionPlanDto, MAX_PLAN_PRICE_CENTS,
  UpdateCoachContractDto, UpdatePlatformSettingsDto, UpdateSubscriptionPlanDto,
} from './subscription.dto';

// Mesmas opções do ValidationPipe global (main.ts).
const check = <T extends object>(cls: new () => T, body: object) =>
  validate(plainToInstance(cls, body), { whitelist: true, forbidNonWhitelisted: true });
const props = async <T extends object>(cls: new () => T, body: object) =>
  (await check(cls, body)).map(e => e.property).sort();

const okPlan = { name: 'Core', priceCents: 14900, categories: ['CORE'] };

describe('CreateSubscriptionPlanDto', () => {
  it('aceita um plano válido, com Free e freeConfig', async () => {
    expect(await check(CreateSubscriptionPlanDto, okPlan)).toHaveLength(0);
    expect(await check(CreateSubscriptionPlanDto, {
      name: 'Free', priceCents: 0, categories: [], isFree: true, freeConfig: { sampleSessionsPerCategory: 2, chat: true },
    })).toHaveLength(0);
  });

  it('rejeita preço negativo, decimal, acima do teto ou texto', async () => {
    for (const priceCents of [-1, 10.5, MAX_PLAN_PRICE_CENTS + 1, '100']) {
      expect(await props(CreateSubscriptionPlanDto, { ...okPlan, priceCents })).toEqual(['priceCents']);
    }
  });

  it('rejeita categoria fora do enum, repetida ou mais de 3', async () => {
    expect(await props(CreateSubscriptionPlanDto, { ...okPlan, categories: ['ADMIN'] })).toEqual(['categories']);
    expect(await props(CreateSubscriptionPlanDto, { ...okPlan, categories: ['CORE', 'CORE'] })).toEqual(['categories']);
    expect(await props(CreateSubscriptionPlanDto, { ...okPlan, categories: ['CORE', 'LPO', 'PERFORMANCE', 'CORE'] })).toEqual(['categories']);
  });

  it('rejeita nome curto/longo demais e campos desconhecidos (coachId/id não vêm do body)', async () => {
    expect(await props(CreateSubscriptionPlanDto, { ...okPlan, name: 'x' })).toEqual(['name']);
    expect(await props(CreateSubscriptionPlanDto, { ...okPlan, name: 'x'.repeat(81) })).toEqual(['name']);
    expect(await props(CreateSubscriptionPlanDto, { ...okPlan, coachId: 'outro', id: 'forjado' })).toEqual(['coachId', 'id']);
  });

  it('freeConfig: limites e propriedades desconhecidas (nada de payload livre)', async () => {
    const bad = (freeConfig: object) => check(CreateSubscriptionPlanDto, { ...okPlan, freeConfig });
    expect((await bad({ sampleSessionsPerCategory: 11 })).length).toBeGreaterThan(0);
    expect((await bad({ sampleSessionsPerCategory: -1 })).length).toBeGreaterThan(0);
    expect((await bad({ chat: 'sim' })).length).toBeGreaterThan(0);
    expect((await bad({ script: '<script>alert(1)</script>' })).length).toBeGreaterThan(0);
  });
});

describe('UpdateSubscriptionPlanDto', () => {
  it('tudo opcional, mas com as mesmas regras', async () => {
    expect(await check(UpdateSubscriptionPlanDto, {})).toHaveLength(0);
    expect(await check(UpdateSubscriptionPlanDto, { active: false })).toHaveLength(0);
    expect(await props(UpdateSubscriptionPlanDto, { priceCents: -5, coachId: 'x' })).toEqual(['coachId', 'priceCents']);
  });
});

describe('AssignSubscriptionDto', () => {
  it('exige planId; status só do enum; teste em ISO', async () => {
    expect(await check(AssignSubscriptionDto, { planId: 'p1' })).toHaveLength(0);
    expect(await props(AssignSubscriptionDto, {})).toEqual(['planId']);
    expect(await props(AssignSubscriptionDto, { planId: 'p1', status: 'FREE' })).toEqual(['status']);
    expect(await props(AssignSubscriptionDto, { planId: 'p1', trialEndsAt: 'amanhã' })).toEqual(['trialEndsAt']);
    expect(await props(AssignSubscriptionDto, { planId: 'p1', studentId: 'outro' })).toEqual(['studentId']);
  });
});

describe('UpdateCoachContractDto', () => {
  it('% entre 0 e 100 com até 2 casas', async () => {
    for (const platformFeePercent of [0, 20, 12.5, 100, 33.33]) {
      expect(await check(UpdateCoachContractDto, { platformFeePercent })).toHaveLength(0);
    }
    for (const platformFeePercent of [-1, 100.01, 10.123, '20', null]) {
      expect(await props(UpdateCoachContractDto, { platformFeePercent })).toEqual(['platformFeePercent']);
    }
  });
});

describe('UpdatePlatformSettingsDto', () => {
  it('exige o booleano; confirmLockout opcional; nada além disso', async () => {
    expect(await check(UpdatePlatformSettingsDto, { enforceSubscriptionAccess: true, confirmLockout: true })).toHaveLength(0);
    expect(await props(UpdatePlatformSettingsDto, {})).toEqual(['enforceSubscriptionAccess']);
    expect(await props(UpdatePlatformSettingsDto, { enforceSubscriptionAccess: 'true' })).toEqual(['enforceSubscriptionAccess']);
    expect(await props(UpdatePlatformSettingsDto, { enforceSubscriptionAccess: true, id: 'x' })).toEqual(['id']);
  });
});
