import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('UsersController', () => {
  function build() {
    const service = { findById: jest.fn() };
    const controller = new UsersController(service as unknown as UsersService);
    return { controller, service };
  }

  it('não existe cadastro público de usuário (qualquer um virava coach)', () => {
    expect((UsersController.prototype as any).create).toBeUndefined();
  });

  it('GET /me exige JwtAuthGuard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, UsersController.prototype.getMe);
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard]));
  });

  it('getMe busca pelo id do usuário autenticado (req.user.id)', async () => {
    const { controller, service } = build();
    service.findById.mockResolvedValue({ id: 'u1', name: 'Ana' });

    await expect(controller.getMe({ user: { id: 'u1' } })).resolves.toEqual({ id: 'u1', name: 'Ana' });
    expect(service.findById).toHaveBeenCalledWith('u1');
  });
});
