import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';

describe('AuthService.validateUser', () => {
  let service: AuthService;
  let users: { findByEmail: jest.Mock };
  let jwt: { sign: jest.Mock };

  const userRow = {
    id: 'u1', name: 'Ana', email: 'ana@example.com', role: 'coach',
    passwordHash: '$hash', createdAt: new Date(),
  };

  beforeEach(() => {
    users = { findByEmail: jest.fn() };
    jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    service = new AuthService(users as unknown as UsersService, jwt as unknown as JwtService);
  });

  it('e-mail inexistente → null, sem checar senha', async () => {
    users.findByEmail.mockResolvedValue(null);
    const compareSpy = jest.spyOn(bcrypt, 'compare');

    await expect(service.validateUser('x@example.com', 'x')).resolves.toBeNull();
    expect(compareSpy).not.toHaveBeenCalled();
  });

  it('senha errada → null', async () => {
    users.findByEmail.mockResolvedValue(userRow);
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

    await expect(service.validateUser('ana@example.com', 'errada')).resolves.toBeNull();
  });

  it('credenciais certas → devolve o usuário sem passwordHash', async () => {
    users.findByEmail.mockResolvedValue(userRow);
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

    const result = await service.validateUser('ana@example.com', 'certa');

    expect(result).toEqual({ id: 'u1', name: 'Ana', email: 'ana@example.com', role: 'coach', createdAt: userRow.createdAt });
    expect(result).not.toHaveProperty('passwordHash');
  });
});

describe('AuthService.login', () => {
  it('assina o payload certo e nunca devolve o hash da senha', async () => {
    const jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    const service = new AuthService({} as UsersService, jwt as unknown as JwtService);

    const result = await service.login({ id: 'u1', name: 'Ana', email: 'ana@example.com', role: 'coach', passwordHash: 'x' });

    expect(jwt.sign).toHaveBeenCalledWith({ sub: 'u1', email: 'ana@example.com', role: 'coach', name: 'Ana' });
    expect(result).toEqual({
      access_token: 'signed.jwt.token',
      user: { id: 'u1', name: 'Ana', email: 'ana@example.com', role: 'coach' },
    });
  });
});
