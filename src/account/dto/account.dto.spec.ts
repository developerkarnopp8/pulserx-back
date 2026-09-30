import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DeleteAccountDto, FindAthleteDto } from './account.dto';

const erros = async (cls: any, body: object) => (await validate(plainToInstance(cls, body))).length;

describe('DTOs da exclusão de conta', () => {
  it('DeleteAccountDto exige a senha (texto de 1 a 128)', async () => {
    expect(await erros(DeleteAccountDto, { password: 'senha' })).toBe(0);
    expect(await erros(DeleteAccountDto, {})).toBe(1);
    expect(await erros(DeleteAccountDto, { password: '' })).toBe(1);
    expect(await erros(DeleteAccountDto, { password: 'x'.repeat(129) })).toBe(1);
    expect(await erros(DeleteAccountDto, { password: 123 })).toBe(1);
  });

  it('FindAthleteDto exige e-mail válido', async () => {
    expect(await erros(FindAthleteDto, { email: 'ana@example.com' })).toBe(0);
    expect(await erros(FindAthleteDto, { email: 'ana' })).toBe(1);
    expect(await erros(FindAthleteDto, { email: "' OR 1=1 --" })).toBe(1);
  });
});
