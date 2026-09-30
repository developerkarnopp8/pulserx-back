import { UnauthorizedException } from '@nestjs/common';
import { LocalStrategy } from './local.strategy';
import { AuthService } from '../auth.service';

describe('LocalStrategy.validate', () => {
  it('credenciais válidas: devolve o usuário validado pelo AuthService', async () => {
    const authService = { validateUser: jest.fn().mockResolvedValue({ id: 'u1', email: 'ana@example.com' }) };
    const strategy = new LocalStrategy(authService as unknown as AuthService);

    await expect(strategy.validate('ana@example.com', 'segredo123')).resolves.toEqual({ id: 'u1', email: 'ana@example.com' });
    expect(authService.validateUser).toHaveBeenCalledWith('ana@example.com', 'segredo123');
  });

  it('credenciais inválidas (AuthService devolve null): 401 com a frase em português', async () => {
    const authService = { validateUser: jest.fn().mockResolvedValue(null) };
    const strategy = new LocalStrategy(authService as unknown as AuthService);

    await expect(strategy.validate('ana@example.com', 'errada')).rejects.toThrow(
      new UnauthorizedException('E-mail ou senha incorretos.'),
    );
  });
});
