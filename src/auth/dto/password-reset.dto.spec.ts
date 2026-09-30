import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ForgotPasswordDto, ResetPasswordDto } from './password-reset.dto';

const erros = async (cls: any, body: object) => (await validate(plainToInstance(cls, body))).length;

describe('DTOs de senha por e-mail', () => {
  it('ForgotPasswordDto exige e-mail válido', async () => {
    expect(await erros(ForgotPasswordDto, { email: 'ana@example.com' })).toBe(0);
    expect(await erros(ForgotPasswordDto, { email: 'ana' })).toBe(1);
    expect(await erros(ForgotPasswordDto, {})).toBe(1);
  });

  it('ResetPasswordDto: token de tamanho plausível e senha de 8 a 100', async () => {
    const token = 'x'.repeat(43);
    expect(await erros(ResetPasswordDto, { token, password: 'senha-forte' })).toBe(0);
    expect(await erros(ResetPasswordDto, { token, password: 'curta' })).toBe(1);
    expect(await erros(ResetPasswordDto, { token, password: 'x'.repeat(101) })).toBe(1);
    expect(await erros(ResetPasswordDto, { token: 'curto', password: 'senha-forte' })).toBe(1);
    expect(await erros(ResetPasswordDto, { token: 'x'.repeat(201), password: 'senha-forte' })).toBe(1);
  });
});
