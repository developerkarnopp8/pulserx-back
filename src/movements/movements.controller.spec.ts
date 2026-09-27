import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MovementsController } from './movements.controller';
import { MovementsService } from './movements.service';

describe('MovementsController', () => {
  function build() {
    const service = { findAvailable: jest.fn(), create: jest.fn() };
    const controller = new MovementsController(service as unknown as MovementsService);
    return { controller, service };
  }

  it('exige JwtAuthGuard + RolesGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, MovementsController)).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('create exige @Roles(coach); findAvailable não tem @Roles próprio', () => {
    expect(Reflect.getMetadata(ROLES_KEY, MovementsController.prototype.create)).toEqual(['coach']);
    expect(Reflect.getMetadata(ROLES_KEY, MovementsController.prototype.findAvailable)).toBeUndefined();
  });

  it('findAvailable repassa req.user inteiro (coach ou atleta)', () => {
    const { controller, service } = build();
    const user = { id: 'athlete-1', role: 'athlete' };
    controller.findAvailable({ user });
    expect(service.findAvailable).toHaveBeenCalledWith(user);
  });

  it('create usa o coachId do token', () => {
    const { controller, service } = build();
    const dto = { name: 'Zercher Squat', category: 'Força' };
    controller.create(dto as never, { user: { id: 'coach-1' } });
    expect(service.create).toHaveBeenCalledWith('coach-1', dto);
  });
});
