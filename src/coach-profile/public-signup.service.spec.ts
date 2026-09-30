import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { TERMS_VERSION } from '../common/terms';
import { PublicSignupService } from './public-signup.service';

const dto = { name: 'Ana Souza', email: 'ana@example.com', password: 'senha-forte', planId: 'plan-1', acceptTerms: true as const };

function build() {
  const prisma: any = {
    coachProfile: { findUnique: jest.fn().mockResolvedValue({ coachId: 'coach-1', published: true }) },
    subscriptionPlan: { findFirst: jest.fn().mockResolvedValue({ id: 'plan-1', name: 'Core' }) },
    user: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'u-new', name: data.name, email: data.email })),
    },
    student: { create: jest.fn().mockResolvedValue({ id: 's-new' }) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
  const verification = { sendVerification: jest.fn().mockResolvedValue(undefined) };
  const notifications = { create: jest.fn().mockResolvedValue({}) };
  return { service: new PublicSignupService(prisma, verification as any, notifications as any), prisma, verification, notifications };
}

describe('PublicSignupService.signup', () => {
  it('cria aluno vinculado ao coach DA PÁGINA, grava aceite dos termos, avisa o coach e manda a confirmação (sem sessão)', async () => {
    const { service, prisma, verification, notifications } = build();

    const result = await service.signup('luan', dto);

    expect(prisma.coachProfile.findUnique).toHaveBeenCalledWith({ where: { slug: 'luan' }, select: { coachId: true, published: true } });
    expect(prisma.subscriptionPlan.findFirst).toHaveBeenCalledWith({
      where: { id: 'plan-1', coachId: 'coach-1', active: true }, select: { id: true, name: true },
    });
    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ name: 'Ana Souza', email: 'ana@example.com', role: 'athlete', termsVersion: TERMS_VERSION, healthConsent: false });
    expect(data.termsAcceptedAt).toBeInstanceOf(Date);
    expect(data.healthConsentAt).toBeInstanceOf(Date);
    expect(await bcrypt.compare('senha-forte', data.passwordHash)).toBe(true);
    expect(prisma.student.create).toHaveBeenCalledWith({ data: { userId: 'u-new', coachId: 'coach-1' } });
    expect(notifications.create).toHaveBeenCalledWith('coach-1', 'new_student', 'Novo aluno pela sua página', 'Ana Souza se inscreveu no plano Core.', '/coach/students');
    // E-mail nasce sem confirmação: a conta só entra depois do link.
    expect(data.emailVerifiedAt).toBeUndefined();
    expect(prisma.user.create.mock.calls[0][0].select).toEqual({ id: true, name: true, email: true });
    expect(verification.sendVerification).toHaveBeenCalledWith(
      { id: 'u-new', name: 'Ana Souza', email: 'ana@example.com' },
      { slug: 'luan', planId: 'plan-1' },
    );
    expect(result).toEqual({ pendingVerification: true, email: 'ana@example.com' });
    expect(result).not.toHaveProperty('access_token');
  });

  it('marcou a caixa de saúde: consentimento gravado com a data', async () => {
    const { service, prisma } = build();
    await service.signup('luan', { ...dto, healthConsent: true });
    expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({ healthConsent: true });
  });

  it('página inexistente ou não publicada: 404, nada é criado', async () => {
    for (const profile of [null, { coachId: 'coach-1', published: false }]) {
      const { service, prisma } = build();
      prisma.coachProfile.findUnique.mockResolvedValue(profile);
      await expect(service.signup('x', dto)).rejects.toThrow(NotFoundException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    }
  });

  it('plano de OUTRO coach ou inativo: 404, nada é criado', async () => {
    const { service, prisma } = build();
    prisma.subscriptionPlan.findFirst.mockResolvedValue(null);
    await expect(service.signup('luan', dto)).rejects.toThrow('Plano não encontrado');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('e-mail já usado (sem diferenciar maiúsculas): 409 EMAIL_EXISTS, não mexe na conta existente', async () => {
    const { service, prisma } = build();
    prisma.user.findFirst.mockResolvedValue({ id: 'u-old' });
    const err = await service.signup('luan', { ...dto, email: 'ANA@example.com' }).catch(e => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'EMAIL_EXISTS' });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: { equals: 'ANA@example.com', mode: 'insensitive' } }, select: { id: true },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('corrida: duas inscrições com o mesmo e-mail → a segunda vira 409, não 500', async () => {
    const { service, prisma } = build();
    prisma.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    const err = await service.signup('luan', dto).catch(e => e);
    expect(err).toBeInstanceOf(ConflictException);
  });

  it('outro erro do banco é propagado', async () => {
    const { service, prisma } = build();
    prisma.$transaction.mockRejectedValue(new Error('db fora'));
    await expect(service.signup('luan', dto)).rejects.toThrow('db fora');
  });

  it('falha no aviso ao coach não derruba a inscrição', async () => {
    const { service, notifications } = build();
    notifications.create.mockRejectedValue(new Error('x'));
    await expect(service.signup('luan', dto)).resolves.toMatchObject({ pendingVerification: true });
  });

  it('falha ao gerar/enviar a confirmação: registra no log e a inscrição continua (pede outro link na entrada)', async () => {
    const { service, verification } = build();
    const erro = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    verification.sendVerification.mockRejectedValue(new Error('banco fora'));
    await expect(service.signup('luan', dto)).resolves.toMatchObject({ pendingVerification: true });
    expect(erro).toHaveBeenCalledWith(expect.stringContaining('u-new'), expect.any(String));
    verification.sendVerification.mockRejectedValue('falha crua');
    await service.signup('luan', dto);
    expect(erro).toHaveBeenLastCalledWith(expect.any(String), 'falha crua');
  });
});
