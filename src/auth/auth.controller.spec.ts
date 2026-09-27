import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';

describe('AuthController', () => {
  it('POST /auth/login exige LocalAuthGuard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype.login);
    expect(guards).toEqual(expect.arrayContaining([LocalAuthGuard]));
  });

  it('login delega pro AuthService.login com o usuário já validado pelo guard (req.user)', async () => {
    const authService = { login: jest.fn().mockResolvedValue({ access_token: 'tok', user: { id: 'u1' } }) };
    const controller = new AuthController(authService as unknown as AuthService);
    const req = { user: { id: 'u1', email: 'ana@example.com', role: 'coach', name: 'Ana' } };

    const result = await controller.login(req, { email: 'ana@example.com', password: 'segredo123' });

    expect(authService.login).toHaveBeenCalledWith(req.user);
    expect(result).toEqual({ access_token: 'tok', user: { id: 'u1' } });
  });
});
