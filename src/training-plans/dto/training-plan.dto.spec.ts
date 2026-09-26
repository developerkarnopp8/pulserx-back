import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateExerciseDto, CreateSharedPlanDto } from './training-plan.dto';

// youtubeUrl não tinha nenhum validador (achado ao restaurar a config do ESLint —
// o import de IsUrl estava lá, mas nunca foi aplicado ao campo).
describe('CreateExerciseDto — youtubeUrl', () => {
  const base = { name: 'Snatch Complex' };

  it('aceita quando ausente (campo opcional)', async () => {
    const instance = plainToInstance(CreateExerciseDto, base);
    const errors = await validate(instance);
    expect(errors).toHaveLength(0);
  });

  it('aceita uma URL http(s) válida', async () => {
    const instance = plainToInstance(CreateExerciseDto, {
      ...base,
      youtubeUrl: 'https://youtube.com/watch?v=abc123',
    });
    const errors = await validate(instance);
    expect(errors).toHaveLength(0);
  });

  it('rejeita valor que não é uma URL válida', async () => {
    const instance = plainToInstance(CreateExerciseDto, {
      ...base,
      youtubeUrl: 'não é um link',
    });
    const errors = await validate(instance);
    expect(errors.some((e) => e.property === 'youtubeUrl')).toBe(true);
  });

  it('rejeita esquema não-http (ex.: javascript:)', async () => {
    const instance = plainToInstance(CreateExerciseDto, {
      ...base,
      youtubeUrl: 'javascript:alert(1)',
    });
    const errors = await validate(instance);
    expect(errors.some((e) => e.property === 'youtubeUrl')).toBe(true);
  });
});

const base = { month: 1, startDate: '2026-03-09', title: 'Core — Março' };
const errorsFor = (body: object) => validate(plainToInstance(CreateSharedPlanDto, body));

describe('CreateSharedPlanDto', () => {
  it.each(['CORE', 'LPO'])('aceita a categoria %s', async category => {
    expect(await errorsFor({ ...base, category })).toHaveLength(0);
  });

  it.each(['PERFORMANCE', 'core', 'OUTRA', '', undefined])('rejeita a categoria %p (Performance é sempre individual)', async category => {
    const errors = await errorsFor({ ...base, category });
    expect(errors.some(e => e.property === 'category')).toBe(true);
  });

  it('rejeita startDate inválida e title ausente', async () => {
    const errors = await errorsFor({ category: 'CORE', month: 1, startDate: 'ontem' });
    expect(errors.map(e => e.property).sort()).toEqual(['startDate', 'title']);
  });
});
