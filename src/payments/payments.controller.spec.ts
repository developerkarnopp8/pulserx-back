import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

function build() {
  const service = {
    findAll: jest.fn(), getSummary: jest.fn(), findByStudent: jest.fn(),
    create: jest.fn(), markPaid: jest.fn(), update: jest.fn(), remove: jest.fn(),
  };
  const controller = new PaymentsController(service as unknown as PaymentsService);
  return { controller, service };
}

const req = { user: { id: 'coach-1' } };

describe('PaymentsController', () => {
  it('exige JwtAuthGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PaymentsController)).toEqual(expect.arrayContaining([JwtAuthGuard]));
  });

  it('findAll/getSummary usam o id do coach do token', () => {
    const { controller, service } = build();
    controller.findAll(req);
    expect(service.findAll).toHaveBeenCalledWith('coach-1');
    controller.getSummary(req);
    expect(service.getSummary).toHaveBeenCalledWith('coach-1');
  });

  it('findByStudent repassa studentId + coachId do token', () => {
    const { controller, service } = build();
    controller.findByStudent(req, 'student-1');
    expect(service.findByStudent).toHaveBeenCalledWith('student-1', 'coach-1');
  });

  it('create usa o coachId do token', () => {
    const { controller, service } = build();
    const dto = { studentId: 's1', amount: 100, dueDate: '2026-10-05' };
    controller.create(req, dto as never);
    expect(service.create).toHaveBeenCalledWith('coach-1', dto);
  });

  it('markPaid/update/remove repassam id + coachId do token', () => {
    const { controller, service } = build();
    controller.markPaid(req, 'pay-1');
    expect(service.markPaid).toHaveBeenCalledWith('pay-1', 'coach-1');
    controller.update(req, 'pay-1', { amount: 50 } as never);
    expect(service.update).toHaveBeenCalledWith('pay-1', 'coach-1', { amount: 50 });
    controller.remove(req, 'pay-1');
    expect(service.remove).toHaveBeenCalledWith('pay-1', 'coach-1');
  });
});
