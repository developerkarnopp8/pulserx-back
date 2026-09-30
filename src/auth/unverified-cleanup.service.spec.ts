import {
  CLEANUP_INTERVAL_MS, UNVERIFIED_RETENTION_MS, UnverifiedCleanupService,
} from './unverified-cleanup.service';

const AGORA = new Date('2026-10-10T12:00:00Z');
const criadoEm = new Date('2026-10-01T09:00:00Z');

function build(candidatos: unknown[] = [{ id: 'u1', name: 'Ana <b>', createdAt: criadoEm, student: { coachId: 'coach-1' } }]) {
  const prisma: any = {
    user: {
      findMany: jest.fn().mockResolvedValue(candidatos),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    notification: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
  return { service: new UnverifiedCleanupService(prisma), prisma };
}

describe('UnverifiedCleanupService.cleanup — inscrições que não confirmaram o e-mail em 7 dias', () => {
  it('7 dias é a regra do dono; roda a cada 6 horas', () => {
    expect(UNVERIFIED_RETENTION_MS).toBe(604_800_000);
    expect(CLEANUP_INTERVAL_MS).toBe(21_600_000);
  });

  it('só busca inscrição abandonada: aluno, não confirmado, +7 dias, não cadastrado pelo coach, sem nada em uso', async () => {
    const { service, prisma } = build([]);
    await expect(service.cleanup(AGORA)).resolves.toBe(0);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        role: 'athlete',
        emailVerifiedAt: null,
        deletedAt: null,
        createdAt: { lt: new Date('2026-10-03T12:00:00Z') },
        authTokens: { none: { purpose: 'SET_PASSWORD' } },
        sentMessages: { none: {} },
        receivedMessages: { none: {} },
        student: { is: { subscription: { is: null }, payments: { none: {} }, trainingPlans: { none: {} } } },
      },
      select: { id: true, name: true, createdAt: true, student: { select: { coachId: true } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    expect(prisma.user.deleteMany).not.toHaveBeenCalled();
  });

  it('apaga a conta (só se continua não confirmada) e o aviso "se inscreveu" do coach; log só com a contagem', async () => {
    const { service, prisma } = build();
    const log = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    await expect(service.cleanup(AGORA)).resolves.toBe(1);
    expect(prisma.user.deleteMany).toHaveBeenCalledWith({ where: { id: 'u1', emailVerifiedAt: null } });
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'coach-1',
        type: 'new_student',
        body: { startsWith: 'Ana <b> se inscreveu' },
        createdAt: { gte: criadoEm, lte: new Date('2026-10-01T09:10:00Z') },
      },
    });
    expect(log).toHaveBeenCalledWith('Inscrições não confirmadas em 7 dias apagadas: 1');
    expect(log.mock.calls[0][0]).not.toContain('Ana');
  });

  it('confirmou o e-mail no meio do caminho: a conta fica e o aviso do coach também', async () => {
    const { service, prisma } = build();
    prisma.user.deleteMany.mockResolvedValue({ count: 0 });
    const log = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    await expect(service.cleanup(AGORA)).resolves.toBe(0);
    expect(prisma.notification.deleteMany).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('usa a data de agora quando não recebe uma', async () => {
    const { service, prisma } = build([]);
    await service.cleanup();
    const limite = prisma.user.findMany.mock.calls[0][0].where.createdAt.lt.getTime();
    expect(Math.abs(limite - (Date.now() - UNVERIFIED_RETENTION_MS))).toBeLessThan(5000);
  });
});

describe('UnverifiedCleanupService — agendamento dentro da API', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('roda 1 minuto depois de subir e depois a cada 6 horas; para ao desligar', async () => {
    const { service } = build([]);
    const cleanup = jest.spyOn(service, 'cleanup').mockResolvedValue(0);
    service.onApplicationBootstrap();
    // Os temporizadores nunca seguram o processo aberto (desligar a API, fim dos testes).
    expect((service as any).timers.map((t: NodeJS.Timeout) => t.hasRef())).toEqual([false, false]);
    jest.advanceTimersByTime(59_999);
    expect(cleanup).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(CLEANUP_INTERVAL_MS);
    expect(cleanup).toHaveBeenCalledTimes(2);

    service.onApplicationShutdown();
    jest.advanceTimersByTime(CLEANUP_INTERVAL_MS * 3);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('falha numa rodada vai para o log e não derruba a API', async () => {
    const { service } = build([]);
    const erro = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    jest.spyOn(service, 'cleanup').mockRejectedValueOnce(new Error('banco fora')).mockRejectedValueOnce('falha crua');
    service.onApplicationBootstrap();
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(erro).toHaveBeenCalledWith('Falha na limpeza de inscrições não confirmadas', expect.any(String));
    jest.advanceTimersByTime(CLEANUP_INTERVAL_MS - 60_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(erro).toHaveBeenLastCalledWith('Falha na limpeza de inscrições não confirmadas', 'falha crua');
    service.onApplicationShutdown();
  });
});
