import { NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

function build() {
  const prisma: any = {
    payment: {
      findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(),
      update: jest.fn(), updateMany: jest.fn(), delete: jest.fn(),
    },
  };
  return { service: new PaymentsService(prisma), prisma };
}

describe('PaymentsService — leitura', () => {
  it('findAll: escopado por coachId, com o aluno incluído, mais recentes primeiro', async () => {
    const { service, prisma } = build();
    prisma.payment.findMany.mockResolvedValue([{ id: 'p1' }]);
    await expect(service.findAll('coach-1')).resolves.toEqual([{ id: 'p1' }]);
    expect(prisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { coachId: 'coach-1' } }));
  });

  it('findByStudent: escopado por studentId + coachId (IDOR)', async () => {
    const { service, prisma } = build();
    prisma.payment.findMany.mockResolvedValue([]);
    await service.findByStudent('student-1', 'coach-1');
    expect(prisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { studentId: 'student-1', coachId: 'coach-1' } }));
  });

  it('findOne: pagamento de outro coach → 404 (IDOR)', async () => {
    const { service, prisma } = build();
    prisma.payment.findFirst.mockResolvedValue(null);
    await expect(service.findOne('pay-1', 'coach-1')).rejects.toThrow(NotFoundException);
    expect(prisma.payment.findFirst).toHaveBeenCalledWith({ where: { id: 'pay-1', coachId: 'coach-1' } });
  });
});

describe('PaymentsService.create', () => {
  it('converte dueDate pra Date e inclui o aluno', async () => {
    const { service, prisma } = build();
    prisma.payment.create.mockResolvedValue({ id: 'p1' });
    await service.create('coach-1', { studentId: 's1', amount: 100, dueDate: '2026-10-05', description: 'x' });
    expect(prisma.payment.create).toHaveBeenCalledWith({
      data: { coachId: 'coach-1', studentId: 's1', amount: 100, dueDate: new Date('2026-10-05'), description: 'x' },
      include: { student: { include: { user: { select: { name: true } } } } },
    });
  });
});

describe('PaymentsService.markPaid', () => {
  it('checa dono, marca pago com paidAt agora', async () => {
    const { service, prisma } = build();
    prisma.payment.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.payment.update.mockResolvedValue({ id: 'p1', status: 'paid' });
    await expect(service.markPaid('p1', 'coach-1')).resolves.toEqual({ id: 'p1', status: 'paid' });
    expect(prisma.payment.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: expect.objectContaining({ status: 'paid', paidAt: expect.any(Date) }) });
  });

  it('pagamento de outro coach → 404, sem atualizar', async () => {
    const { service, prisma } = build();
    prisma.payment.findFirst.mockResolvedValue(null);
    await expect(service.markPaid('p1', 'coach-1')).rejects.toThrow(NotFoundException);
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.update', () => {
  it('sem dueDate/paidAt no dto: não converte nada extra', async () => {
    const { service, prisma } = build();
    prisma.payment.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.payment.update.mockResolvedValue({ id: 'p1', amount: 200 });
    await service.update('p1', 'coach-1', { amount: 200 });
    expect(prisma.payment.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { amount: 200 } });
  });

  it('com dueDate e paidAt: converte os dois pra Date', async () => {
    const { service, prisma } = build();
    prisma.payment.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.payment.update.mockResolvedValue({ id: 'p1' });
    await service.update('p1', 'coach-1', { dueDate: '2026-11-01', paidAt: '2026-10-20' } as never);
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { dueDate: new Date('2026-11-01'), paidAt: new Date('2026-10-20') },
    });
  });

  it('pagamento de outro coach → 404, sem atualizar', async () => {
    const { service, prisma } = build();
    prisma.payment.findFirst.mockResolvedValue(null);
    await expect(service.update('p1', 'coach-1', {})).rejects.toThrow(NotFoundException);
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.remove', () => {
  it('checa dono antes de apagar', async () => {
    const { service, prisma } = build();
    prisma.payment.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.payment.delete.mockResolvedValue({ id: 'p1' });
    await expect(service.remove('p1', 'coach-1')).resolves.toEqual({ id: 'p1' });
  });

  it('pagamento de outro coach → 404, sem apagar', async () => {
    const { service, prisma } = build();
    prisma.payment.findFirst.mockResolvedValue(null);
    await expect(service.remove('p1', 'coach-1')).rejects.toThrow(NotFoundException);
    expect(prisma.payment.delete).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.getSummary', () => {
  const NOW = new Date('2026-10-10T12:00:00.000Z');
  beforeEach(() => { jest.useFakeTimers().setSystemTime(NOW); });
  afterEach(() => { jest.useRealTimers(); });

  it('marca como overdue quem está pending e vencido, e soma pelos status ATUALIZADOS', async () => {
    const { service, prisma } = build();
    const pending = { id: 'p1', status: 'pending', dueDate: new Date('2026-10-01'), amount: 100 };
    const paid = { id: 'p2', status: 'paid', dueDate: new Date('2026-09-01'), amount: 200 };
    prisma.payment.findMany
      .mockResolvedValueOnce([pending, paid])
      .mockResolvedValueOnce([{ ...pending, status: 'overdue' }, paid]);

    const result = await service.getSummary('coach-1');

    expect(prisma.payment.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['p1'] } }, data: { status: 'overdue' } });
    expect(result).toEqual({ totalReceived: 200, totalPending: 0, totalOverdue: 100, countOverdue: 1 });
  });

  it('pending ainda não vencido não vira overdue, e updateMany não é chamado', async () => {
    const { service, prisma } = build();
    const pending = { id: 'p1', status: 'pending', dueDate: new Date('2026-11-01'), amount: 100 };
    prisma.payment.findMany.mockResolvedValue([pending]);

    const result = await service.getSummary('coach-1');

    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ totalReceived: 0, totalPending: 100, totalOverdue: 0, countOverdue: 0 });
  });

  it('sem pagamento nenhum: tudo zerado', async () => {
    const { service, prisma } = build();
    prisma.payment.findMany.mockResolvedValue([]);
    await expect(service.getSummary('coach-1')).resolves.toEqual({ totalReceived: 0, totalPending: 0, totalOverdue: 0, countOverdue: 0 });
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
  });
});
