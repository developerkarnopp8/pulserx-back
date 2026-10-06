import { ADMIN_ACCESS_LOG_CLEANUP_INTERVAL_MS, AdminAccessLogCleanupService } from './admin-access-log-cleanup.service';

describe('AdminAccessLogCleanupService', () => {
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  function build(deleteMany = jest.fn().mockResolvedValue({ count: 3 })) {
    const prisma = { adminAccessLog: { deleteMany } };
    return { service: new AdminAccessLogCleanupService(prisma as any), deleteMany };
  }

  it('apaga só os registros com mais de 12 meses', async () => {
    const { service, deleteMany } = build();
    const now = new Date('2027-10-06T12:00:00Z');
    await expect(service.cleanup(now)).resolves.toBe(3);
    expect(deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: new Date('2026-10-06T12:00:00Z') } } });
  });

  it('agenda ao subir (2 min e depois 1x por dia), para ao desligar; falha só vai pro log', async () => {
    jest.useFakeTimers();
    const { service, deleteMany } = build(jest.fn().mockRejectedValue(new Error('banco fora')));
    const log = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('Falha na limpeza do registro de acessos do admin', expect.any(String));
    deleteMany.mockRejectedValueOnce('texto');
    await jest.advanceTimersByTimeAsync(ADMIN_ACCESS_LOG_CLEANUP_INTERVAL_MS);
    expect(deleteMany).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenLastCalledWith('Falha na limpeza do registro de acessos do admin', 'texto');
    service.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(ADMIN_ACCESS_LOG_CLEANUP_INTERVAL_MS * 2);
    expect(deleteMany).toHaveBeenCalledTimes(2);
  });
});
