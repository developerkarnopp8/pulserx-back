import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ALLOW_PENDING_TERMS_KEY } from './decorators/allow-pending-terms.decorator';
import { ALLOW_UNLINKED_KEY } from './decorators/allow-unlinked.decorator';
import { ROLES_KEY } from './decorators/roles.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PasswordChangeController } from './password-change.controller';

describe('PasswordChangeController', () => {
  it('troca a senha de quem está logado, pelo id do token (nunca do corpo)', async () => {
    const service = { changePassword: jest.fn().mockResolvedValue({ access_token: 't' }) };
    const controller = new PasswordChangeController(service as never);
    await controller.change({ currentPassword: 'a', newPassword: 'b'.repeat(8), userId: 'outro' } as any, { user: { id: 'u1' } });
    expect(service.changePassword).toHaveBeenCalledWith('u1', 'a', 'bbbbbbbb');
  });

  it('exige login, vale para qualquer perfil, com termos pendentes e sem vínculo; limite igual ao do login', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PasswordChangeController)).toEqual([JwtAuthGuard]);
    const handler = PasswordChangeController.prototype.change;
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(ALLOW_PENDING_TERMS_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_UNLINKED_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(5);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(900_000);
  });
});
