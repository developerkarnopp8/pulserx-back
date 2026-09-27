import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DailyIntakeController } from './daily-intake.controller';
import { DailyIntakeService } from './daily-intake.service';

function build() {
  const service = { logHydration: jest.fn(), logCalories: jest.fn(), getTodayTotals: jest.fn(), getHistoryForStudent: jest.fn() };
  const controller = new DailyIntakeController(service as unknown as DailyIntakeService);
  return { controller, service };
}

describe('DailyIntakeController — guards', () => {
  it('todo o controller exige JwtAuthGuard + RolesGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, DailyIntakeController)).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('hydration/calories/today exigem athlete; student/history exige coach', () => {
    for (const m of ['logHydration', 'logCalories', 'getToday'] as const) {
      expect(Reflect.getMetadata(ROLES_KEY, DailyIntakeController.prototype[m])).toEqual(['athlete']);
    }
    expect(Reflect.getMetadata(ROLES_KEY, DailyIntakeController.prototype.getStudentHistory)).toEqual(['coach']);
  });
});

describe('DailyIntakeController — delegação', () => {
  it('logHydration usa o id do atleta do token', () => {
    const { controller, service } = build();
    controller.logHydration({ amountMl: 250 } as never, { user: { id: 'athlete-1' } });
    expect(service.logHydration).toHaveBeenCalledWith('athlete-1', 250);
  });

  it('logCalories usa o id do atleta do token', () => {
    const { controller, service } = build();
    controller.logCalories({ kcal: 300 } as never, { user: { id: 'athlete-1' } });
    expect(service.logCalories).toHaveBeenCalledWith('athlete-1', 300);
  });

  it('getToday usa o id do atleta do token', () => {
    const { controller, service } = build();
    controller.getToday({ user: { id: 'athlete-1' } });
    expect(service.getTodayTotals).toHaveBeenCalledWith('athlete-1');
  });

  it('getStudentHistory repassa studentId + req.user', () => {
    const { controller, service } = build();
    const req = { user: { id: 'coach-1' } };
    controller.getStudentHistory('student-1', req);
    expect(service.getHistoryForStudent).toHaveBeenCalledWith('student-1', req.user);
  });
});
