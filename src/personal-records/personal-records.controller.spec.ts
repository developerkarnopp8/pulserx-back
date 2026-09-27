import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PersonalRecordsController } from './personal-records.controller';
import { PersonalRecordsService } from './personal-records.service';

function build() {
  const service = { create: jest.fn(), getMyHistory: jest.fn(), getHistoryForStudent: jest.fn() };
  const controller = new PersonalRecordsController(service as unknown as PersonalRecordsService);
  return { controller, service };
}

describe('PersonalRecordsController — guards', () => {
  it('todo o controller exige JwtAuthGuard + RolesGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PersonalRecordsController)).toEqual(
      expect.arrayContaining([JwtAuthGuard, RolesGuard]),
    );
  });

  it('create/getMine exigem @Roles(athlete); getStudentHistory exige @Roles(coach)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, PersonalRecordsController.prototype.create)).toEqual(['athlete']);
    expect(Reflect.getMetadata(ROLES_KEY, PersonalRecordsController.prototype.getMine)).toEqual(['athlete']);
    expect(Reflect.getMetadata(ROLES_KEY, PersonalRecordsController.prototype.getStudentHistory)).toEqual(['coach']);
  });
});

describe('PersonalRecordsController — delegação', () => {
  it('create usa o id do atleta do token', () => {
    const { controller, service } = build();
    const req = { user: { id: 'athlete-1' } };
    const dto = { movementId: 'mov-1', loadKg: 100 };
    controller.create(dto as never, req);
    expect(service.create).toHaveBeenCalledWith('athlete-1', dto);
  });

  it('getMine usa o id do atleta do token', () => {
    const { controller, service } = build();
    controller.getMine({ user: { id: 'athlete-1' } });
    expect(service.getMyHistory).toHaveBeenCalledWith('athlete-1');
  });

  it('getStudentHistory repassa studentId + req.user (coach)', () => {
    const { controller, service } = build();
    const req = { user: { id: 'coach-1', role: 'coach' } };
    controller.getStudentHistory('student-1', req);
    expect(service.getHistoryForStudent).toHaveBeenCalledWith('student-1', req.user);
  });
});
