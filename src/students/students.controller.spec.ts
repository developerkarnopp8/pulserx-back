import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

function build() {
  const service = {
    findByUserId: jest.fn(), findAll: jest.fn(), findOne: jest.fn(),
    getCurrentPlan: jest.fn(), create: jest.fn(), update: jest.fn(), unlink: jest.fn(),
  };
  const controller = new StudentsController(service as unknown as StudentsService);
  return { controller, service };
}

describe('StudentsController — guards', () => {
  it('todo o controller exige JwtAuthGuard + RolesGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, StudentsController)).toEqual(
      expect.arrayContaining([JwtAuthGuard, RolesGuard]),
    );
  });

  it('create/findAll/update/unlink exigem @Roles(coach); findOne/getCurrentPlan/getMyProfile não têm @Roles próprio (liberado por auth, checagem de dono no service)', () => {
    for (const m of ['create', 'findAll', 'update', 'unlink'] as const) {
      expect(Reflect.getMetadata(ROLES_KEY, StudentsController.prototype[m])).toEqual(['coach']);
    }
    for (const m of ['findOne', 'getCurrentPlan', 'getMyProfile'] as const) {
      expect(Reflect.getMetadata(ROLES_KEY, StudentsController.prototype[m])).toBeUndefined();
    }
  });
});

describe('StudentsController — delegação', () => {
  it('getMyProfile usa req.user.id', async () => {
    const { controller, service } = build();
    service.findByUserId.mockResolvedValue({ id: 's1' });
    await expect(controller.getMyProfile({ user: { id: 'u1' } })).resolves.toEqual({ id: 's1' });
    expect(service.findByUserId).toHaveBeenCalledWith('u1');
  });

  it('findAll lista os alunos do coach autenticado', async () => {
    const { controller, service } = build();
    service.findAll.mockResolvedValue([]);
    await controller.findAll({ user: { id: 'coach-1' } });
    expect(service.findAll).toHaveBeenCalledWith('coach-1');
  });

  it('findOne repassa id + req.user (checagem de dono é no service)', async () => {
    const { controller, service } = build();
    const req = { user: { id: 'coach-1', role: 'coach' } };
    await controller.findOne('s1', req);
    expect(service.findOne).toHaveBeenCalledWith('s1', req.user);
  });

  it('getCurrentPlan repassa id + req.user', async () => {
    const { controller, service } = build();
    const req = { user: { id: 'athlete-1', role: 'athlete' } };
    await controller.getCurrentPlan('s1', req);
    expect(service.getCurrentPlan).toHaveBeenCalledWith('s1', req.user);
  });

  it('create usa o coachId do token, nunca do body', async () => {
    const { controller, service } = build();
    const dto = { name: 'Gustavo', email: 'g@example.com', password: 'senha123' };
    await controller.create({ user: { id: 'coach-1' } }, dto as never);
    expect(service.create).toHaveBeenCalledWith('coach-1', dto);
  });

  it('update repassa id, coachId do token e dto', async () => {
    const { controller, service } = build();
    await controller.update('s1', { goal: 'novo' } as never, { user: { id: 'coach-1' } });
    expect(service.update).toHaveBeenCalledWith('s1', 'coach-1', { goal: 'novo' });
  });

  it('desvincular repassa id + coachId do token', async () => {
    const { controller, service } = build();
    await controller.unlink('s1', { user: { id: 'coach-1' } });
    expect(service.unlink).toHaveBeenCalledWith('s1', 'coach-1');
  });
});
