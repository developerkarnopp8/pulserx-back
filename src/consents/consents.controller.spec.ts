import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ALLOW_PENDING_TERMS_KEY } from '../auth/decorators/allow-pending-terms.decorator';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ConsentsController } from './consents.controller';
import { ConsentsService } from './consents.service';

describe('ConsentsController', () => {
  it('login + papel no controller inteiro; tudo só para o aluno', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ConsentsController)).toEqual(
      expect.arrayContaining([JwtAuthGuard, RolesGuard]),
    );
    for (const rota of ['get', 'accept', 'setHealth'] as const) {
      expect(Reflect.getMetadata(ROLES_KEY, ConsentsController.prototype[rota])).toEqual(['athlete']);
    }
  });

  it('ver e aceitar funcionam com termos pendentes; mudar a saúde no Perfil exige termos em dia', () => {
    expect(Reflect.getMetadata(ALLOW_PENDING_TERMS_KEY, ConsentsController.prototype.get)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_PENDING_TERMS_KEY, ConsentsController.prototype.accept)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_PENDING_TERMS_KEY, ConsentsController.prototype.setHealth)).toBeUndefined();
  });

  it('delega sempre com o id do próprio usuário (nunca de fora)', async () => {
    const service = {
      get: jest.fn().mockResolvedValue('g'),
      accept: jest.fn().mockResolvedValue('a'),
      setHealth: jest.fn().mockResolvedValue('s'),
    };
    const c = new ConsentsController(service as unknown as ConsentsService);
    const req = { user: { id: 'u1' } };

    expect(await c.get(req)).toBe('g');
    expect(await c.accept({ acceptTerms: true, healthConsent: false }, req)).toBe('a');
    expect(await c.setHealth({ healthConsent: true }, req)).toBe('s');
    expect(service.get).toHaveBeenCalledWith('u1');
    expect(service.accept).toHaveBeenCalledWith('u1', false);
    expect(service.setHealth).toHaveBeenCalledWith('u1', true);
  });
});
