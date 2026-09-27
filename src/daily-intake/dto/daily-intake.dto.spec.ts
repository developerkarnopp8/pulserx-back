import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LogHydrationDto, LogCaloriesDto } from './daily-intake.dto';

const check = <T extends object>(cls: new () => T, body: object) => validate(plainToInstance(cls, body));

describe('LogHydrationDto', () => {
  it('aceita entre 1 e 5000ml', async () => {
    expect(await check(LogHydrationDto, { amountMl: 250 })).toHaveLength(0);
  });

  it('rejeita 0, negativo, acima de 5000 e não-inteiro', async () => {
    for (const amountMl of [0, -10, 5001, 1.5]) {
      expect((await check(LogHydrationDto, { amountMl })).length).toBeGreaterThan(0);
    }
  });
});

describe('LogCaloriesDto', () => {
  it('aceita entre 1 e 5000kcal', async () => {
    expect(await check(LogCaloriesDto, { kcal: 500 })).toHaveLength(0);
  });

  it('rejeita 0, negativo, acima de 5000 e não-inteiro', async () => {
    for (const kcal of [0, -10, 5001, 1.5]) {
      expect((await check(LogCaloriesDto, { kcal })).length).toBeGreaterThan(0);
    }
  });
});
