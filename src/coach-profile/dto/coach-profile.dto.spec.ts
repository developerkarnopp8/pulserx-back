import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCoachProfileDto, PublishCoachProfileDto, CreateLeadDto, UpsertTestimonialDto, UpsertFaqItemDto } from './coach-profile.dto';

const check = <T extends object>(cls: new () => T, body: object) => validate(plainToInstance(cls, body));

describe('UpdateCoachProfileDto', () => {
  it('aceita só o slug obrigatório', async () => {
    expect(await check(UpdateCoachProfileDto, { slug: 'luan-treinador' })).toHaveLength(0);
  });

  it('aceita todos os campos opcionais preenchidos', async () => {
    expect(await check(UpdateCoachProfileDto, {
      slug: 'luan-treinador', bio: 'Treinador de CrossFit', headline: 'Headline', subheadline: 'Sub',
      quote: 'Quote', achievementBadge: 'Semifinals', yearsExperience: 12, athletesCount: 1400,
      npsScore: 92, completionRate: 88.4, whatsappNumber: '11999999999', videoUrl: 'https://youtu.be/abc',
    })).toHaveLength(0);
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

  it('rejeita bio/headline/subheadline/quote/achievementBadge maiores que o limite', async () => {
    const base = { slug: 'luan' };
    expect((await check(UpdateCoachProfileDto, { ...base, bio: 'x'.repeat(1001) })).some(e => e.property === 'bio')).toBe(true);
    expect((await check(UpdateCoachProfileDto, { ...base, headline: 'x'.repeat(201) })).some(e => e.property === 'headline')).toBe(true);
    expect((await check(UpdateCoachProfileDto, { ...base, subheadline: 'x'.repeat(501) })).some(e => e.property === 'subheadline')).toBe(true);
    expect((await check(UpdateCoachProfileDto, { ...base, quote: 'x'.repeat(501) })).some(e => e.property === 'quote')).toBe(true);
    expect((await check(UpdateCoachProfileDto, { ...base, achievementBadge: 'x'.repeat(101) })).some(e => e.property === 'achievementBadge')).toBe(true);
  });

  it('rejeita yearsExperience/athletesCount/npsScore/completionRate fora da faixa', async () => {
    const base = { slug: 'luan' };
    expect((await check(UpdateCoachProfileDto, { ...base, yearsExperience: -1 })).some(e => e.property === 'yearsExperience')).toBe(true);
    expect((await check(UpdateCoachProfileDto, { ...base, yearsExperience: 81 })).some(e => e.property === 'yearsExperience')).toBe(true);
    expect((await check(UpdateCoachProfileDto, { ...base, athletesCount: -1 })).some(e => e.property === 'athletesCount')).toBe(true);
    expect((await check(UpdateCoachProfileDto, { ...base, npsScore: 101 })).some(e => e.property === 'npsScore')).toBe(true);
    expect((await check(UpdateCoachProfileDto, { ...base, completionRate: 100.1 })).some(e => e.property === 'completionRate')).toBe(true);
  });

  it('rejeita whatsappNumber longo demais e videoUrl fora do formato de URL', async () => {
    const base = { slug: 'luan' };
    expect((await check(UpdateCoachProfileDto, { ...base, whatsappNumber: '1'.repeat(21) })).some(e => e.property === 'whatsappNumber')).toBe(true);
    expect((await check(UpdateCoachProfileDto, { ...base, videoUrl: 'nao-e-url' })).some(e => e.property === 'videoUrl')).toBe(true);
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

describe('UpsertTestimonialDto', () => {
  const base = { authorName: 'Ana', content: 'Ótimo treino!' };

  it('aceita o mínimo obrigatório e com authorRole/rating/order', async () => {
    expect(await check(UpsertTestimonialDto, base)).toHaveLength(0);
    expect(await check(UpsertTestimonialDto, { ...base, authorRole: 'Atleta RX', rating: 5, order: 1 })).toHaveLength(0);
  });

  it('rejeita authorName/content ausentes ou curtos demais', async () => {
    expect((await check(UpsertTestimonialDto, { content: base.content })).some(e => e.property === 'authorName')).toBe(true);
    expect((await check(UpsertTestimonialDto, { authorName: base.authorName })).some(e => e.property === 'content')).toBe(true);
    expect((await check(UpsertTestimonialDto, { authorName: 'A', content: 'x' })).some(e => e.property === 'authorName')).toBe(true);
  });

  it('rejeita rating fora de 1-5', async () => {
    expect((await check(UpsertTestimonialDto, { ...base, rating: 0 })).some(e => e.property === 'rating')).toBe(true);
    expect((await check(UpsertTestimonialDto, { ...base, rating: 6 })).some(e => e.property === 'rating')).toBe(true);
  });

  it('rejeita order negativo', async () => {
    expect((await check(UpsertTestimonialDto, { ...base, order: -1 })).some(e => e.property === 'order')).toBe(true);
  });
});

describe('UpsertFaqItemDto', () => {
  const base = { question: 'Serve pra iniciante?', answer: 'Sim, tranquilamente.' };

  it('aceita o mínimo obrigatório e com order', async () => {
    expect(await check(UpsertFaqItemDto, base)).toHaveLength(0);
    expect(await check(UpsertFaqItemDto, { ...base, order: 2 })).toHaveLength(0);
  });

  it('rejeita question/answer ausentes ou curtos demais', async () => {
    expect((await check(UpsertFaqItemDto, { answer: base.answer })).some(e => e.property === 'question')).toBe(true);
    expect((await check(UpsertFaqItemDto, { question: base.question })).some(e => e.property === 'answer')).toBe(true);
    expect((await check(UpsertFaqItemDto, { question: 'Q', answer: 'A' })).some(e => e.property === 'question')).toBe(true);
  });

  it('rejeita order negativo', async () => {
    expect((await check(UpsertFaqItemDto, { ...base, order: -1 })).some(e => e.property === 'order')).toBe(true);
  });
});
