import { COACH_TERMS_VERSION, TERMS_VERSION } from '../common/terms';
import { ConsentsService } from './consents.service';

const QUANDO = new Date('2026-09-30T12:00:00.000Z');

function build() {
  const prisma: any = {
    user: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockImplementation(async ({ data, select }) =>
        select.name
          ? {
              id: 'u1',
              name: 'Bia',
              email: 'bia@example.com',
              role: 'athlete',
              termsVersion: data.termsVersion,
              healthConsent: false,
            }
          : { healthConsent: data.healthConsent, healthConsentAt: QUANDO },
      ),
    },
    workoutSkip: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    message: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'm1',
          content: 'Pulei "Supino" — motivo: lesão/dor. vai fazer depois. Nota: ombro',
        },
        {
          id: 'm2',
          content: 'Pulei "Remo" — motivo: sem tempo. não vai fazer.',
        },
      ]),
      update: jest.fn(),
    },
    student: {
      findMany: jest.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]),
    },
    notification: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'n1',
          body: 'Pulei "Remo" — motivo: sem tempo. não vai fazer. Nota: joelho',
        },
        { id: 'n2', body: null },
        { id: 'n3', body: 'Pulei "Remo" — motivo: sem tempo. não vai fazer.' },
      ]),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
  const auth = {
    login: jest.fn().mockResolvedValue({ access_token: 'novo', user: { id: 'u1' } }),
  };
  return { service: new ConsentsService(prisma, auth as any), prisma, auth };
}

describe('ConsentsService.get', () => {
  it('diz se os termos estão em dia e a situação da saúde', async () => {
    const { service, prisma } = build();
    prisma.user.findUniqueOrThrow.mockResolvedValueOnce({
      termsVersion: TERMS_VERSION,
      healthConsent: true,
      healthConsentAt: QUANDO,
    });
    expect(await service.get('u1')).toEqual({
      termsVersion: TERMS_VERSION,
      termsAccepted: true,
      healthConsent: true,
      healthConsentAt: '2026-09-30T12:00:00.000Z',
    });
    prisma.user.findUniqueOrThrow.mockResolvedValueOnce({
      termsVersion: '2026-09-28',
      healthConsent: null,
      healthConsentAt: null,
    });
    expect(await service.get('u1')).toMatchObject({
      termsAccepted: false,
      healthConsent: null,
      healthConsentAt: null,
    });
  });
});

describe('ConsentsService.accept (tela do próximo login)', () => {
  it('grava termos atuais + saúde e devolve um token NOVO (com a versão atual)', async () => {
    const { service, prisma, auth } = build();

    expect(await service.accept('u1', true)).toEqual({
      access_token: 'novo',
      user: { id: 'u1' },
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { healthConsent: true, healthConsentAt: expect.any(Date) },
      select: { healthConsent: true, healthConsentAt: true },
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          termsAcceptedAt: expect.any(Date),
          termsVersion: TERMS_VERSION,
        },
      }),
    );
    expect(auth.login).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1', termsVersion: TERMS_VERSION }));
    // Consentiu: nada é apagado.
    expect(prisma.workoutSkip.updateMany).not.toHaveBeenCalled();
  });
});

describe('ConsentsService.setHealth — retirar apaga o que é saúde (inclusive as cópias)', () => {
  it('lesão vira "removido a pedido do aluno", observações somem; mensagem/notificação reescritas só quando mudam', async () => {
    const { service, prisma } = build();

    expect(await service.setHealth('u1', false)).toEqual({
      healthConsent: false,
      healthConsentAt: '2026-09-30T12:00:00.000Z',
    });

    expect(prisma.workoutSkip.updateMany).toHaveBeenCalledWith({
      where: { athleteId: 'u1', reason: 'Injury' },
      data: { reason: 'Withheld' },
    });
    expect(prisma.workoutSkip.updateMany).toHaveBeenCalledWith({
      where: { athleteId: 'u1', note: { not: null } },
      data: { note: null },
    });
    expect(prisma.message.findMany).toHaveBeenCalledWith({
      where: {
        fromId: 'u1',
        isSystem: true,
        content: { startsWith: 'Pulei "' },
      },
      select: { id: true, content: true },
    });
    expect(prisma.message.update).toHaveBeenCalledTimes(1);
    expect(prisma.message.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: {
        content: 'Pulei "Supino" — motivo: removido a pedido do aluno. vai fazer depois.',
      },
    });
    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: {
        type: 'workout_skipped',
        link: { in: ['/coach/plan-builder/s1', '/coach/plan-builder/s2'] },
      },
      select: { id: true, body: true },
    });
    expect(prisma.notification.update).toHaveBeenCalledTimes(1);
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { body: 'Pulei "Remo" — motivo: sem tempo. não vai fazer.' },
    });
  });

  it('dar o consentimento só grava (não apaga nada)', async () => {
    const { service, prisma } = build();
    expect(await service.setHealth('u1', true)).toEqual({
      healthConsent: true,
      healthConsentAt: '2026-09-30T12:00:00.000Z',
    });
    expect(prisma.workoutSkip.updateMany).not.toHaveBeenCalled();
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });
});

describe('ConsentsService — Termo do Coach', () => {
  it('getCoachTerms: diz a versão atual e se ESTE coach já aceitou (data só quando aceito)', async () => {
    const { service, prisma } = build();
    prisma.user.findUniqueOrThrow.mockResolvedValueOnce({ termsVersion: COACH_TERMS_VERSION, termsAcceptedAt: QUANDO });
    await expect(service.getCoachTerms('c1')).resolves.toEqual({
      termsVersion: COACH_TERMS_VERSION, accepted: true, acceptedAt: QUANDO.toISOString(),
    });
    expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'c1' }, select: { termsVersion: true, termsAcceptedAt: true },
    });

    prisma.user.findUniqueOrThrow.mockResolvedValueOnce({ termsVersion: null, termsAcceptedAt: null });
    await expect(service.getCoachTerms('c1')).resolves.toEqual({ termsVersion: COACH_TERMS_VERSION, accepted: false, acceptedAt: null });

    // Aceite antigo (outra versão) não conta, nem mostra a data antiga.
    prisma.user.findUniqueOrThrow.mockResolvedValueOnce({ termsVersion: 'coach-2026-01-01', termsAcceptedAt: QUANDO });
    await expect(service.getCoachTerms('c1')).resolves.toMatchObject({ accepted: false, acceptedAt: null });

    prisma.user.findUniqueOrThrow.mockResolvedValueOnce({ termsVersion: COACH_TERMS_VERSION, termsAcceptedAt: null });
    await expect(service.getCoachTerms('c1')).resolves.toMatchObject({ accepted: true, acceptedAt: null });
  });

  it('acceptCoachTerms: grava quando e qual versão e devolve sessão NOVA', async () => {
    const { service, prisma, auth } = build();
    await expect(service.acceptCoachTerms('c1')).resolves.toEqual({ access_token: 'novo', user: { id: 'u1' } });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'c1' },
      data: { termsAcceptedAt: expect.any(Date), termsVersion: COACH_TERMS_VERSION },
    }));
    expect(auth.login).toHaveBeenCalledWith(expect.objectContaining({ termsVersion: COACH_TERMS_VERSION }));
  });
});
