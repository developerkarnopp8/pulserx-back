import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';

const check = (body: object) => validate(plainToInstance(LoginDto, body));

describe('LoginDto', () => {
  it('aceita e-mail válido e senha com 6+ caracteres', async () => {
    expect(await check({ email: 'ana@example.com', password: '123456' })).toHaveLength(0);
  });

  it('rejeita e-mail inválido', async () => {
    const errors = await check({ email: 'não é email', password: '123456' });
    expect(errors.some(e => e.property === 'email')).toBe(true);
  });

  it('rejeita senha curta', async () => {
    const errors = await check({ email: 'ana@example.com', password: '123' });
    expect(errors.some(e => e.property === 'password')).toBe(true);
  });

  it('rejeita campos ausentes', async () => {
    const errors = await check({});
    expect(errors.map(e => e.property).sort()).toEqual(['email', 'password']);
  });
});
