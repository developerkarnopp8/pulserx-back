import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ExerciseLibraryController } from './exercise-library.controller';
import { ExerciseLibraryService } from './exercise-library.service';

function build() {
  const service = { findAll: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() };
  const controller = new ExerciseLibraryController(service as unknown as ExerciseLibraryService);
  return { controller, service };
}

describe('ExerciseLibraryController', () => {
  it('exige JwtAuthGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ExerciseLibraryController)).toEqual(expect.arrayContaining([JwtAuthGuard]));
  });

  it('findAll usa o id do coach do token', () => {
    const { controller, service } = build();
    controller.findAll({ user: { id: 'coach-1' } });
    expect(service.findAll).toHaveBeenCalledWith('coach-1');
  });

  it('create usa o id do coach do token, nunca do body', () => {
    const { controller, service } = build();
    const dto = { name: 'Snatch' };
    controller.create({ user: { id: 'coach-1' } }, dto as never);
    expect(service.create).toHaveBeenCalledWith('coach-1', dto);
  });

  it('update repassa req.user, id e dto', () => {
    const { controller, service } = build();
    controller.update({ user: { id: 'coach-1' } }, 'item-1', { name: 'novo' } as never);
    expect(service.update).toHaveBeenCalledWith('item-1', 'coach-1', { name: 'novo' });
  });

  it('remove repassa req.user + id', () => {
    const { controller, service } = build();
    controller.remove({ user: { id: 'coach-1' } }, 'item-1');
    expect(service.remove).toHaveBeenCalledWith('item-1', 'coach-1');
  });
});
