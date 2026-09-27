import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TrainingPlansController } from './training-plans.controller';
import { TrainingPlansService } from './training-plans.service';

function build() {
  const service = {
    findByStudent: jest.fn(), getWeeklyCompletionByDayIndex: jest.fn(), findSharedByCoach: jest.fn(),
    createShared: jest.fn(), findById: jest.fn(), create: jest.fn(), update: jest.fn(), publish: jest.fn(),
    initializeWeeks: jest.fn(), remove: jest.fn(), addWeek: jest.fn(), removeWeek: jest.fn(),
    addDay: jest.fn(), removeDay: jest.fn(), addSession: jest.fn(), removeSession: jest.fn(),
    addExercise: jest.fn(), updateExercise: jest.fn(), removeExercise: jest.fn(),
  };
  const controller = new TrainingPlansController(service as unknown as TrainingPlansService);
  return { controller, service };
}

const req = { user: { id: 'coach-1', role: 'coach' } };

describe('TrainingPlansController — guards', () => {
  it('todo o controller exige JwtAuthGuard + RolesGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, TrainingPlansController)).toEqual(
      expect.arrayContaining([JwtAuthGuard, RolesGuard]),
    );
  });

  it('escrita/gestão exige @Roles(coach); leitura (findByStudent/findById) não tem @Roles próprio', () => {
    const coachOnly = [
      'getWeeklyCompletion', 'findShared', 'createShared', 'create', 'update', 'publish',
      'initializeWeeks', 'remove', 'addWeek', 'removeWeek', 'addDay', 'removeDay',
      'addSession', 'removeSession', 'addExercise', 'updateExercise', 'removeExercise',
    ] as const;
    for (const m of coachOnly) {
      expect(Reflect.getMetadata(ROLES_KEY, TrainingPlansController.prototype[m])).toEqual(['coach']);
    }
    for (const m of ['findByStudent', 'findById'] as const) {
      expect(Reflect.getMetadata(ROLES_KEY, TrainingPlansController.prototype[m])).toBeUndefined();
    }
  });
});

describe('TrainingPlansController — delegação', () => {
  it('findByStudent repassa studentId + req.user', () => {
    const { controller, service } = build();
    controller.findByStudent('student-1', req);
    expect(service.findByStudent).toHaveBeenCalledWith('student-1', req.user);
  });

  it('getWeeklyCompletion usa o id do coach do token', () => {
    const { controller, service } = build();
    controller.getWeeklyCompletion(req);
    expect(service.getWeeklyCompletionByDayIndex).toHaveBeenCalledWith('coach-1');
  });

  it('findShared repassa coachId e a categoria opcional', () => {
    const { controller, service } = build();
    controller.findShared(req);
    expect(service.findSharedByCoach).toHaveBeenCalledWith('coach-1', undefined);
    controller.findShared(req, 'CORE' as never);
    expect(service.findSharedByCoach).toHaveBeenCalledWith('coach-1', 'CORE');
  });

  it('createShared usa o coachId do token, nunca do body', () => {
    const { controller, service } = build();
    const dto = { category: 'CORE', month: 1, title: 'x', startDate: '2026-01-05' };
    controller.createShared(req, dto as never);
    expect(service.createShared).toHaveBeenCalledWith('coach-1', dto);
  });

  it('findById repassa id + req.user', () => {
    const { controller, service } = build();
    controller.findById('plan-1', req);
    expect(service.findById).toHaveBeenCalledWith('plan-1', req.user);
  });

  it('create usa o coachId do token', () => {
    const { controller, service } = build();
    const dto = { studentId: 's1', month: 1, title: 'x', startDate: '2026-01-05' };
    controller.create(req, dto as never);
    expect(service.create).toHaveBeenCalledWith('coach-1', dto);
  });

  it('update repassa id, coachId e dto', () => {
    const { controller, service } = build();
    controller.update('plan-1', { title: 'novo' } as never, req);
    expect(service.update).toHaveBeenCalledWith('plan-1', 'coach-1', { title: 'novo' });
  });

  it('publish repassa id + coachId', () => {
    const { controller, service } = build();
    controller.publish('plan-1', req);
    expect(service.publish).toHaveBeenCalledWith('plan-1', 'coach-1');
  });

  it('initializeWeeks repassa id + coachId', () => {
    const { controller, service } = build();
    controller.initializeWeeks('plan-1', req);
    expect(service.initializeWeeks).toHaveBeenCalledWith('plan-1', 'coach-1');
  });

  it('remove repassa id + coachId', () => {
    const { controller, service } = build();
    controller.remove('plan-1', req);
    expect(service.remove).toHaveBeenCalledWith('plan-1', 'coach-1');
  });

  it('addWeek/removeWeek', () => {
    const { controller, service } = build();
    controller.addWeek('plan-1', { weekNumber: 2 } as never, req);
    expect(service.addWeek).toHaveBeenCalledWith('plan-1', 'coach-1', { weekNumber: 2 });
    controller.removeWeek('week-1', req);
    expect(service.removeWeek).toHaveBeenCalledWith('week-1', 'coach-1');
  });

  it('addDay/removeDay', () => {
    const { controller, service } = build();
    controller.addDay('week-1', { dayOfWeek: 'Terça', dayIndex: 2 } as never, req);
    expect(service.addDay).toHaveBeenCalledWith('week-1', 'coach-1', { dayOfWeek: 'Terça', dayIndex: 2 });
    controller.removeDay('day-1', req);
    expect(service.removeDay).toHaveBeenCalledWith('day-1', 'coach-1');
  });

  it('addSession/removeSession', () => {
    const { controller, service } = build();
    controller.addSession('day-1', { name: 'x', type: 'Strength' } as never, req);
    expect(service.addSession).toHaveBeenCalledWith('day-1', 'coach-1', { name: 'x', type: 'Strength' });
    controller.removeSession('session-1', req);
    expect(service.removeSession).toHaveBeenCalledWith('session-1', 'coach-1');
  });

  it('addExercise/updateExercise/removeExercise', () => {
    const { controller, service } = build();
    controller.addExercise('session-1', { name: 'Squat' } as never, req);
    expect(service.addExercise).toHaveBeenCalledWith('session-1', 'coach-1', { name: 'Squat' });
    controller.updateExercise('ex-1', { name: 'Squat' } as never, req);
    expect(service.updateExercise).toHaveBeenCalledWith('ex-1', 'coach-1', { name: 'Squat' });
    controller.removeExercise('ex-1', req);
    expect(service.removeExercise).toHaveBeenCalledWith('ex-1', 'coach-1');
  });
});
