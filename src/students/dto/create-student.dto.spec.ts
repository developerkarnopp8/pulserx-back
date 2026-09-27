import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateStudentDto, UpdateStudentDto } from './create-student.dto';

const check = <T extends object>(cls: new () => T, body: object) => validate(plainToInstance(cls, body));

describe('CreateStudentDto', () => {
  const base = { name: 'Gustavo', email: 'gustavo@example.com', password: '123456' };

  it('aceita sem goal (opcional) e com goal', async () => {
    expect(await check(CreateStudentDto, base)).toHaveLength(0);
    expect(await check(CreateStudentDto, { ...base, goal: 'Força' })).toHaveLength(0);
  });

  it('rejeita e-mail inválido e senha curta', async () => {
    expect((await check(CreateStudentDto, { ...base, email: 'x' })).some(e => e.property === 'email')).toBe(true);
    expect((await check(CreateStudentDto, { ...base, password: '123' })).some(e => e.property === 'password')).toBe(true);
  });
});

describe('UpdateStudentDto', () => {
  it('tudo opcional: objeto vazio passa', async () => {
    expect(await check(UpdateStudentDto, {})).toHaveLength(0);
  });

  it('aceita os campos numéricos e goal quando presentes', async () => {
    expect(await check(UpdateStudentDto, { goal: 'x', currentMonth: 2, currentWeek: 3, completionPercent: 50 })).toHaveLength(0);
  });

  it('rejeita tipo errado nos campos numéricos', async () => {
    expect((await check(UpdateStudentDto, { currentMonth: 'dois' })).some(e => e.property === 'currentMonth')).toBe(true);
  });
});
