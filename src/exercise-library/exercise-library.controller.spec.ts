import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { ExerciseLibraryController } from './exercise-library.controller';
import { ExerciseLibraryService } from './exercise-library.service';

function build() {
  const service = { findAll: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn(), uploadImage: jest.fn(), removeImage: jest.fn() };
  const controller = new ExerciseLibraryController(service as unknown as ExerciseLibraryService);
  return { controller, service };
}

describe('ExerciseLibraryController', () => {
  it('exige JwtAuthGuard + RolesGuard e só coach (atleta não alcança a biblioteca)', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ExerciseLibraryController)).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    expect(Reflect.getMetadata(ROLES_KEY, ExerciseLibraryController)).toEqual(['coach']);
  });

  it('uploadImage/removeImage usam o id do coach do token', () => {
    const { controller, service } = build();
    const file = { buffer: Buffer.from('img') } as Express.Multer.File;
    controller.uploadImage('item-1', { user: { id: 'coach-1' } }, file);
    expect(service.uploadImage).toHaveBeenCalledWith('item-1', 'coach-1', file.buffer);
    controller.removeImage('item-1', { user: { id: 'coach-1' } });
    expect(service.removeImage).toHaveBeenCalledWith('item-1', 'coach-1');
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
