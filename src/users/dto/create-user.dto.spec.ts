import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto, UserRole } from './create-user.dto';

const base = { name: 'Ana', email: 'ana@example.com', password: '123456', role: UserRole.ATHLETE };
const check = (body: object) => validate(plainToInstance(CreateUserDto, body));

describe('CreateUserDto', () => {
  it('aceita um payload válido para coach e para athlete', async () => {
    expect(await check(base)).toHaveLength(0);
    expect(await check({ ...base, role: UserRole.COACH })).toHaveLength(0);
  });

  it('rejeita e-mail inválido, senha curta, nome ausente e role fora do enum', async () => {
    expect((await check({ ...base, email: 'não é email' })).some(e => e.property === 'email')).toBe(true);
    expect((await check({ ...base, password: '123' })).some(e => e.property === 'password')).toBe(true);
    expect((await check({ ...base, name: undefined })).some(e => e.property === 'name')).toBe(true);
    expect((await check({ ...base, role: 'admin' })).some(e => e.property === 'role')).toBe(true);
  });
});
