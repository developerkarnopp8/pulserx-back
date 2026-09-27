import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { WorkoutLogsController } from './workout-logs.controller';
import { WorkoutLogsService } from './workout-logs.service';

function build() {
  const service = {
    logExercise: jest.fn(), getHistory: jest.fn(), getStudentHistory: jest.fn(),
    getSessionLogs: jest.fn(), getExerciseHistory: jest.fn(),
  };
  const controller = new WorkoutLogsController(service as unknown as WorkoutLogsService);
  return { controller, service };
}

describe('WorkoutLogsController — guards', () => {
  it('todo o controller exige JwtAuthGuard + RolesGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, WorkoutLogsController)).toEqual(
      expect.arrayContaining([JwtAuthGuard, RolesGuard]),
    );
  });

  it('getStudentHistory exige @Roles(coach); as demais não têm @Roles próprio', () => {
    expect(Reflect.getMetadata(ROLES_KEY, WorkoutLogsController.prototype.getStudentHistory)).toEqual(['coach']);
    for (const m of ['logExercise', 'getHistory', 'getSessionLogs', 'getExerciseHistory'] as const) {
      expect(Reflect.getMetadata(ROLES_KEY, WorkoutLogsController.prototype[m])).toBeUndefined();
    }
  });
});

describe('WorkoutLogsController — delegação', () => {
  it('logExercise repassa req.user + dto', () => {
    const { controller, service } = build();
    const req = { user: { id: 'athlete-1' } };
    controller.logExercise(req, { exerciseId: 'ex-1', setsCompleted: 3 } as never);
    expect(service.logExercise).toHaveBeenCalledWith(req.user, { exerciseId: 'ex-1', setsCompleted: 3 });
  });

  it('getHistory: sem limit usa 50; com limit converte pra número', () => {
    const { controller, service } = build();
    const req = { user: { id: 'athlete-1' } };
    controller.getHistory(req);
    expect(service.getHistory).toHaveBeenCalledWith('athlete-1', 50);
    controller.getHistory(req, '10' as never);
    expect(service.getHistory).toHaveBeenCalledWith('athlete-1', 10);
  });

  it('getStudentHistory repassa studentId + req.user + limit', () => {
    const { controller, service } = build();
    const req = { user: { id: 'coach-1' } };
    controller.getStudentHistory('student-1', req);
    expect(service.getStudentHistory).toHaveBeenCalledWith('student-1', req.user, 50);
    controller.getStudentHistory('student-1', req, '5' as never);
    expect(service.getStudentHistory).toHaveBeenCalledWith('student-1', req.user, 5);
  });

  it('getSessionLogs usa o athleteId do token, não o de outro aluno', () => {
    const { controller, service } = build();
    controller.getSessionLogs('sess-1', { user: { id: 'athlete-1' } });
    expect(service.getSessionLogs).toHaveBeenCalledWith('sess-1', 'athlete-1');
  });

  it('getExerciseHistory usa o athleteId do token', () => {
    const { controller, service } = build();
    controller.getExerciseHistory('ex-1', { user: { id: 'athlete-1' } });
    expect(service.getExerciseHistory).toHaveBeenCalledWith('ex-1', 'athlete-1');
  });
});
