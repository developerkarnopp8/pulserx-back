import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('UsersController', () => {
  function build() {
    const service = { create: jest.fn(), findById: jest.fn() };
    const controller = new UsersController(service as unknown as UsersService);
    return { controller, service };
  }

  it('POST / (create) não exige guard — cadastro público', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, UsersController.prototype.create);
    expect(guards).toBeUndefined();
  });

  it('create delega pro service com o dto', async () => {
    const { controller, service } = build();
    const dto = { name: 'Ana', email: 'ana@example.com', password: '123456', role: 'athlete' };
    service.create.mockResolvedValue({ id: 'u1', name: dto.name, email: dto.email, role: dto.role });

    await expect(controller.create(dto as never)).resolves.toEqual({ id: 'u1', name: 'Ana', email: 'ana@example.com', role: 'athlete' });
    expect(service.create).toHaveBeenCalledWith(dto);
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
