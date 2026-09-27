import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { WorkoutSessionsController } from './workout-sessions.controller';
import { WorkoutSessionsService } from './workout-sessions.service';

function build() {
  const service = {
    checkout: jest.fn(), listMine: jest.fn(), coachAvgDuration: jest.fn(),
    studentSummary: jest.fn(), sessionDetail: jest.fn(),
  };
  const controller = new WorkoutSessionsController(service as unknown as WorkoutSessionsService);
  return { controller, service };
}

describe('WorkoutSessionsController — guards e roles', () => {
  it('todo o controller exige JwtAuthGuard + RolesGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, WorkoutSessionsController)).toEqual(
      expect.arrayContaining([JwtAuthGuard, RolesGuard]),
    );
  });

  it('checkout/listMine exigem athlete; coachAvgDuration/studentSummary/sessionDetail exigem coach', () => {
    for (const m of ['checkout', 'listMine'] as const) {
      expect(Reflect.getMetadata(ROLES_KEY, WorkoutSessionsController.prototype[m])).toEqual(['athlete']);
    }
    for (const m of ['coachAvgDuration', 'studentSummary', 'sessionDetail'] as const) {
      expect(Reflect.getMetadata(ROLES_KEY, WorkoutSessionsController.prototype[m])).toEqual(['coach']);
    }
  });
});

describe('WorkoutSessionsController — delegação', () => {
  it('checkout repassa req.user + dto', () => {
    const { controller, service } = build();
    const req = { user: { id: 'athlete-1' } };
    const dto = { sessionId: 's1', startedAt: '2026-01-01T10:00:00Z', finishedAt: '2026-01-01T10:30:00Z' };
    controller.checkout(req, dto as never);
    expect(service.checkout).toHaveBeenCalledWith(req.user, dto);
  });

  it('listMine usa o id do atleta do token', () => {
    const { controller, service } = build();
    controller.listMine({ user: { id: 'athlete-1' } });
    expect(service.listMine).toHaveBeenCalledWith('athlete-1');
  });

  it('coachAvgDuration usa o id do coach do token', () => {
    const { controller, service } = build();
    controller.coachAvgDuration({ user: { id: 'coach-1' } });
    expect(service.coachAvgDuration).toHaveBeenCalledWith('coach-1');
  });

  it('studentSummary repassa studentId + req.user', () => {
    const { controller, service } = build();
    const req = { user: { id: 'coach-1' } };
    controller.studentSummary('student-1', req);
    expect(service.studentSummary).toHaveBeenCalledWith('student-1', req.user);
  });

  it('sessionDetail repassa studentId + sessionId + req.user', () => {
    const { controller, service } = build();
    const req = { user: { id: 'coach-1' } };
    controller.sessionDetail('student-1', 'session-1', req);
    expect(service.sessionDetail).toHaveBeenCalledWith('student-1', 'session-1', req.user);
  });
});
