import { ConflictException } from '@nestjs/common';
import { PlatformSettingsService } from './platform-settings.service';

function build(over: { settings?: any; total?: number; withoutAccess?: number } = {}) {
  const prisma = {
    platformSettings: {
      findUnique: jest.fn().mockResolvedValue('settings' in over ? over.settings : null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    student: {
      count: jest.fn().mockImplementation(async (args: any) => (args.where.OR ? (over.withoutAccess ?? 0) : (over.total ?? 0))),
    },
  };
  return { service: new PlatformSettingsService(prisma as any), prisma };
}

describe('PlatformSettingsService.get', () => {
  it('sem linha de configuração → bloqueio desligado (comportamento pré-v2)', async () => {
    await expect(build({ total: 3, withoutAccess: 2 }).service.get()).resolves.toEqual({
      enforceSubscriptionAccess: false, totalStudents: 3, studentsWithoutAccess: 2,
    });
  });

  it('conta como "sem acesso" pela mesma regra do app: sem assinatura, cancelada, teste vencido, inadimplente fora da tolerância, contestada', async () => {
    const { service, prisma } = build({ settings: { enforceSubscriptionAccess: true } });
    const agora = new Date('2026-10-10T12:00:00Z');
    await service.get(agora);
    // Aluno desvinculado não conta (nem no total, nem nos sem acesso).
    expect(prisma.student.count).toHaveBeenCalledWith({ where: { unlinkedAt: null } });
    const where = prisma.student.count.mock.calls.find(c => c[0].where.OR)![0].where;
    expect(where.unlinkedAt).toBeNull();
    expect(where.OR).toEqual([
      { subscription: null },
      { subscription: { status: { notIn: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } } },
      { subscription: { status: 'TRIALING', trialEndsAt: { lte: agora } } },
      { subscription: { status: 'PAST_DUE', gatewayPayments: { none: { status: 'overdue' } } } },
      { subscription: { status: 'PAST_DUE', gatewayPayments: { some: { status: 'overdue', dueDate: { lte: new Date('2026-10-05T12:00:00Z') } } } } },
      { subscription: { gatewayPayments: { some: { status: 'chargeback' } } } },
    ]);
  });

  it('sem informar "agora": usa a data atual', async () => {
    const { service, prisma } = build();
    await service.get();
    const where = prisma.student.count.mock.calls.find(c => c[0].where.OR)![0].where;
    expect(Math.abs(where.OR[2].subscription.trialEndsAt.lte.getTime() - Date.now())).toBeLessThan(5000);
  });
});

describe('PlatformSettingsService.setEnforcement', () => {
  it('ligar com alunos sem acesso exige confirmação explícita (409 com a contagem) e não grava', async () => {
    const { service, prisma } = build({ total: 5, withoutAccess: 2 });
    await expect(service.setEnforcement(true)).rejects.toThrow(ConflictException);
    await expect(service.setEnforcement(true, false)).rejects.toThrow('2 aluno(s) ficariam sem acesso');
    expect(prisma.platformSettings.upsert).not.toHaveBeenCalled();
  });

  it('ligar confirmando (mesmo com alunos sem acesso) grava', async () => {
    const { service, prisma } = build({ total: 5, withoutAccess: 2 });
    await service.setEnforcement(true, true);
    expect(prisma.platformSettings.upsert).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      create: { id: 'singleton', enforceSubscriptionAccess: true },
      update: { enforceSubscriptionAccess: true },
    });
  });

  it('ligar sem ninguém a perder dispensa a confirmação', async () => {
    const { service, prisma } = build({ total: 3, withoutAccess: 0 });
    await service.setEnforcement(true);
    expect(prisma.platformSettings.upsert).toHaveBeenCalled();
  });

  it('desligar é sempre livre, sem checar alunos', async () => {
    const { service, prisma } = build({ total: 5, withoutAccess: 5 });
    await service.setEnforcement(false);
    expect(prisma.platformSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { enforceSubscriptionAccess: false },
    }));
  });
});
