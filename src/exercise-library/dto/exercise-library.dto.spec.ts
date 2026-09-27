import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateExerciseLibraryDto, UpdateExerciseLibraryDto } from './exercise-library.dto';

const check = <T extends object>(cls: new () => T, body: object) => validate(plainToInstance(cls, body));

describe('CreateExerciseLibraryDto', () => {
  it('só o nome é obrigatório', async () => {
    expect(await check(CreateExerciseLibraryDto, { name: 'Snatch' })).toHaveLength(0);
  });

  it('aceita todos os campos opcionais preenchidos', async () => {
    expect(await check(CreateExerciseLibraryDto, {
      name: 'Snatch', youtubeUrl: 'https://youtu.be/abc12345678', sets: 3, reps: '5', duration: '30s',
      restSeconds: 90, loadPercent: 80, category: 'LPO', notes: 'x',
    })).toHaveLength(0);
  });

  it('rejeita nome ausente, youtubeUrl inválida e números negativos', async () => {
    expect((await check(CreateExerciseLibraryDto, {})).some(e => e.property === 'name')).toBe(true);
    expect((await check(CreateExerciseLibraryDto, { name: 'x', youtubeUrl: 'não é url' })).some(e => e.property === 'youtubeUrl')).toBe(true);
    expect((await check(CreateExerciseLibraryDto, { name: 'x', sets: -1 })).some(e => e.property === 'sets')).toBe(true);
    expect((await check(CreateExerciseLibraryDto, { name: 'x', restSeconds: -1 })).some(e => e.property === 'restSeconds')).toBe(true);
    expect((await check(CreateExerciseLibraryDto, { name: 'x', loadPercent: -1 })).some(e => e.property === 'loadPercent')).toBe(true);
  });
});

describe('UpdateExerciseLibraryDto', () => {
  it('tudo opcional (PartialType) — objeto vazio passa', async () => {
    expect(await check(UpdateExerciseLibraryDto, {})).toHaveLength(0);
  });
});
