import { COACH_TERMS_VERSION, TERMS_VERSION } from '../common/terms';
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

  it('conta excluída (anonimizada) → null, mesmo com a senha certa', async () => {
    users.findByEmail.mockResolvedValue({ ...userRow, deletedAt: new Date() });
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

    await expect(service.validateUser('ana@example.com', 'certa')).resolves.toBeNull();
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

    expect(jwt.sign).toHaveBeenCalledWith({ sub: 'u1', email: 'ana@example.com', role: 'coach', name: 'Ana', tv: null });
    expect(result).toEqual({
      access_token: 'signed.jwt.token',
      user: { id: 'u1', name: 'Ana', email: 'ana@example.com', role: 'coach', termsPending: true },
    });
  });

  it('coach: termo pendente até aceitar a versão atual do Termo do Coach; admin não tem termo', async () => {
    const jwt = { sign: jest.fn().mockReturnValue('t') };
    const service = new AuthService({} as UsersService, jwt as unknown as JwtService);
    const coach = { id: 'c1', name: 'Luan', email: 'luan@example.com', role: 'coach' };

    const aceito = await service.login({ ...coach, termsVersion: COACH_TERMS_VERSION });
    expect(jwt.sign).toHaveBeenLastCalledWith(expect.objectContaining({ tv: COACH_TERMS_VERSION }));
    expect(aceito.user).toEqual({ ...coach, termsPending: false });
    expect((await service.login({ ...coach, termsVersion: TERMS_VERSION })).user).toMatchObject({ termsPending: true });

    const admin = await service.login({ id: 'a1', name: 'Adm', email: 'adm@example.com', role: 'admin' });
    expect(admin.user).toEqual({ id: 'a1', name: 'Adm', email: 'adm@example.com', role: 'admin' });
  });

  it('atleta: a versão dos termos vai no token e a resposta diz se falta aceitar/responder a saúde', async () => {
    const jwt = { sign: jest.fn().mockReturnValue('t') };
    const service = new AuthService({} as UsersService, jwt as unknown as JwtService);
    const atleta = { id: 'a1', name: 'Bia', email: 'bia@example.com', role: 'athlete' };

    const antigo = await service.login({ ...atleta, termsVersion: '2026-09-28', healthConsent: null });
    expect(jwt.sign).toHaveBeenLastCalledWith(expect.objectContaining({ tv: '2026-09-28' }));
    expect(antigo.user).toEqual({ ...atleta, termsPending: true, healthConsent: null });

    const atual = await service.login({ ...atleta, termsVersion: TERMS_VERSION, healthConsent: false });
    expect(atual.user).toEqual({ ...atleta, termsPending: false, healthConsent: false });

    const semNada = await service.login(atleta);
    expect(semNada.user).toEqual({ ...atleta, termsPending: true, healthConsent: null });
  });
});
