import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ForgotPasswordDto, ResetPasswordDto, VerifyEmailDto } from './password-reset.dto';

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

  it('VerifyEmailDto: token de 20 a 200 e a senha criada agora (8 a 100)', async () => {
    const senha = 'senha-forte';
    expect(await erros(VerifyEmailDto, { token: 't'.repeat(43), password: senha })).toBe(0);
    expect(await erros(VerifyEmailDto, { token: 'curto', password: senha })).toBe(1);
    expect(await erros(VerifyEmailDto, { token: 'x'.repeat(201), password: senha })).toBe(1);
    expect(await erros(VerifyEmailDto, { token: 't'.repeat(43) })).toBe(1);
    expect(await erros(VerifyEmailDto, { token: 't'.repeat(43), password: 'curta' })).toBe(1);
    expect(await erros(VerifyEmailDto, { token: 't'.repeat(43), password: 'x'.repeat(101) })).toBe(1);
    expect(await erros(VerifyEmailDto, {})).toBe(2);
  });
});
