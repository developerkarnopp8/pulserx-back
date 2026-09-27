import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCoachProfileDto, PublishCoachProfileDto, CreateLeadDto } from './coach-profile.dto';

const check = <T extends object>(cls: new () => T, body: object) => validate(plainToInstance(cls, body));

describe('UpdateCoachProfileDto', () => {
  it('aceita slug válido, com e sem bio', async () => {
    expect(await check(UpdateCoachProfileDto, { slug: 'luan-treinador' })).toHaveLength(0);
    expect(await check(UpdateCoachProfileDto, { slug: 'luan-treinador', bio: 'Treinador de CrossFit' })).toHaveLength(0);
  });

  it('rejeita slug fora do kebab-case (maiúscula, espaço, underscore, hífen duplo)', async () => {
    expect((await check(UpdateCoachProfileDto, { slug: 'Luan' })).some(e => e.property === 'slug')).toBe(true);
    expect((await check(UpdateCoachProfileDto, { slug: 'luan treinador' })).some(e => e.property === 'slug')).toBe(true);
    expect((await check(UpdateCoachProfileDto, { slug: 'luan_treinador' })).some(e => e.property === 'slug')).toBe(true);
    expect((await check(UpdateCoachProfileDto, { slug: 'luan--treinador' })).some(e => e.property === 'slug')).toBe(true);
  });

  it('rejeita slug curto demais, longo demais, ou ausente', async () => {
    expect((await check(UpdateCoachProfileDto, { slug: 'ab' })).some(e => e.property === 'slug')).toBe(true);
    expect((await check(UpdateCoachProfileDto, { slug: 'a'.repeat(61) })).some(e => e.property === 'slug')).toBe(true);
    expect((await check(UpdateCoachProfileDto, {})).some(e => e.property === 'slug')).toBe(true);
  });

  it('rejeita bio maior que 1000 caracteres', async () => {
    expect((await check(UpdateCoachProfileDto, { slug: 'luan', bio: 'x'.repeat(1001) })).some(e => e.property === 'bio')).toBe(true);
  });
});

describe('PublishCoachProfileDto', () => {
  it('aceita published true/false; rejeita não-booleano ou ausente', async () => {
    expect(await check(PublishCoachProfileDto, { published: true })).toHaveLength(0);
    expect(await check(PublishCoachProfileDto, { published: false })).toHaveLength(0);
    expect((await check(PublishCoachProfileDto, { published: 'sim' })).some(e => e.property === 'published')).toBe(true);
    expect((await check(PublishCoachProfileDto, {})).some(e => e.property === 'published')).toBe(true);
  });
});

describe('CreateLeadDto', () => {
  const base = { name: 'Ana Paula', email: 'ana@x.com' };

  it('aceita o mínimo obrigatório e com phone/message', async () => {
    expect(await check(CreateLeadDto, base)).toHaveLength(0);
    expect(await check(CreateLeadDto, { ...base, phone: '11999999999', message: 'Quero treinar' })).toHaveLength(0);
  });

  it('rejeita nome curto demais, e-mail inválido', async () => {
    expect((await check(CreateLeadDto, { ...base, name: 'A' })).some(e => e.property === 'name')).toBe(true);
    expect((await check(CreateLeadDto, { ...base, email: 'nao-e-email' })).some(e => e.property === 'email')).toBe(true);
  });

  it('rejeita name/email ausentes', async () => {
    expect((await check(CreateLeadDto, { email: base.email })).some(e => e.property === 'name')).toBe(true);
    expect((await check(CreateLeadDto, { name: base.name })).some(e => e.property === 'email')).toBe(true);
  });

  it('rejeita phone e message longos demais', async () => {
    expect((await check(CreateLeadDto, { ...base, phone: '1'.repeat(31) })).some(e => e.property === 'phone')).toBe(true);
    expect((await check(CreateLeadDto, { ...base, message: 'x'.repeat(1001) })).some(e => e.property === 'message')).toBe(true);
  });
});
