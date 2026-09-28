import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PublicSignupService, TERMS_VERSION } from './public-signup.service';

const dto = { name: 'Ana Souza', email: 'ana@example.com', password: 'senha-forte', planId: 'plan-1', acceptTerms: true as const };

function build() {
  const prisma: any = {
    coachProfile: { findUnique: jest.fn().mockResolvedValue({ coachId: 'coach-1', published: true }) },
    subscriptionPlan: { findFirst: jest.fn().mockResolvedValue({ id: 'plan-1', name: 'Core' }) },
    user: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'u-new', name: data.name, email: data.email, role: data.role })),
    },
    student: { create: jest.fn().mockResolvedValue({ id: 's-new' }) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
  const auth = { login: jest.fn().mockImplementation(async (u: any) => ({ access_token: 'tok', user: u })) };
  const notifications = { create: jest.fn().mockResolvedValue({}) };
  return { service: new PublicSignupService(prisma, auth as any, notifications as any), prisma, auth, notifications };
}

describe('PublicSignupService.signup', () => {
  it('cria aluno vinculado ao coach DA PÁGINA, grava aceite dos termos, avisa o coach e sai logado', async () => {
    const { service, prisma, auth, notifications } = build();

    const result = await service.signup('luan', dto);

    expect(prisma.coachProfile.findUnique).toHaveBeenCalledWith({ where: { slug: 'luan' }, select: { coachId: true, published: true } });
    expect(prisma.subscriptionPlan.findFirst).toHaveBeenCalledWith({
      where: { id: 'plan-1', coachId: 'coach-1', active: true }, select: { id: true, name: true },
    });
    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ name: 'Ana Souza', email: 'ana@example.com', role: 'athlete', termsVersion: TERMS_VERSION });
    expect(data.termsAcceptedAt).toBeInstanceOf(Date);
    expect(await bcrypt.compare('senha-forte', data.passwordHash)).toBe(true);
    expect(prisma.student.create).toHaveBeenCalledWith({ data: { userId: 'u-new', coachId: 'coach-1' } });
    expect(notifications.create).toHaveBeenCalledWith('coach-1', 'new_student', 'Novo aluno pela sua página', 'Ana Souza se inscreveu no plano Core.', '/coach/students');
    expect(auth.login).toHaveBeenCalledWith({ id: 'u-new', name: 'Ana Souza', email: 'ana@example.com', role: 'athlete' });
    expect(result).toMatchObject({ access_token: 'tok', planId: 'plan-1' });
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
    await expect(service.signup('luan', dto)).resolves.toMatchObject({ access_token: 'tok' });
  });
});
