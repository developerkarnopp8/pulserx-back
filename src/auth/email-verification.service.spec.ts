import * as bcrypt from 'bcrypt';
import { hashEmailToken } from './email-tokens';
import { EmailVerificationService } from './email-verification.service';

const TOKEN = 'a'.repeat(43);
const ana = { id: 'u1', name: 'Ana <b>', email: 'ana@example.com' };

function build() {
  const prisma: any = {
    user: {
      findFirst: jest.fn().mockResolvedValue(ana),
      update: jest.fn().mockResolvedValue({ id: 'u1' }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'athlete' }),
    },
    authToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: 't1' }),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)));
  const email = { send: jest.fn().mockResolvedValue(undefined) };
  const auth = { login: jest.fn().mockResolvedValue({ access_token: 'sessao' }) };
  return { service: new EmailVerificationService(prisma, email as any, auth as any), prisma, email, auth };
}

const esperarEnvio = () => new Promise(r => setImmediate(r));

describe('EmailVerificationService.sendVerification', () => {
  it('link de 48 horas no fragmento, com o plano escolhido; invalida o link anterior; nome escapado', async () => {
    const { service, prisma, email } = build();
    const log = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    const antes = Date.now();
    await service.sendVerification(ana, { slug: 'luan-teste', planId: 'plan-1' });

    expect(prisma.authToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', usedAt: null, purpose: 'VERIFY_EMAIL' },
      data: { usedAt: expect.any(Date) },
    });
    const data = prisma.authToken.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: 'u1', purpose: 'VERIFY_EMAIL' });
    const validade = data.expiresAt.getTime() - antes;
    expect(validade).toBeGreaterThanOrEqual(172_800_000 - 50);
    expect(validade).toBeLessThanOrEqual(172_800_000 + 1000);

    const [para, assunto, html] = email.send.mock.calls[0];
    expect(para).toBe('ana@example.com');
    expect(assunto).toBe('Confirme seu e-mail e crie sua senha — PulseRx');
    expect(html).toContain('Olá, Ana &lt;b&gt;.');
    const m = /href="http:\/\/localhost:4200\/confirmar-email#token=([A-Za-z0-9_-]{43})&c=luan-teste&plano=plan-1"/.exec(html);
    expect(m).not.toBeNull();
    expect(hashEmailToken(m![1])).toBe(data.tokenHash);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[dev\] link de confirmação de ana@example\.com: http/));
  });

  it('sem plano: link só com o token; valores do plano vão codificados', async () => {
    const { service, email } = build();
    await service.sendVerification(ana);
    expect(email.send.mock.calls[0][2]).toMatch(/confirmar-email#token=[A-Za-z0-9_-]{43}"/);
    await service.sendVerification(ana, { slug: 'a&b', planId: 'x"y' });
    expect(email.send.mock.calls[1][2]).toContain('&c=a%26b&plano=x%22y"');
  });

  it('em produção não escreve o link no log', async () => {
    const env = process.env.NODE_ENV;
    const url = process.env.APP_URL;
    process.env.NODE_ENV = 'production';
    process.env.APP_URL = 'https://aevonfit.aevon.online';
    const { service } = build();
    const log = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    await service.sendVerification(ana);
    expect(log).not.toHaveBeenCalled();
    process.env.NODE_ENV = env;
    // Restaurar sem transformar "não definido" na string 'undefined'.
    if (url === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = url;
  });
});

describe('EmailVerificationService.resend', () => {
  it('conta esperando confirmação: manda um link novo (sem plano)', async () => {
    const { service, prisma, email } = build();
    await service.resend('  Ana@Example.com ');
    await esperarEnvio();
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: { equals: 'Ana@Example.com', mode: 'insensitive' }, deletedAt: null, emailVerifiedAt: null },
      select: { id: true, name: true, email: true },
    });
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it('sem conta, conta excluída ou já confirmada: nada é enviado, mesma resposta', async () => {
    const { service, prisma, email } = build();
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.resend('x@example.com')).resolves.toBeUndefined();
    await esperarEnvio();
    expect(prisma.authToken.create).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('responde sem esperar o envio (o tempo não revela a conta)', async () => {
    const { service, email } = build();
    email.send.mockReturnValue(new Promise(() => undefined));
    const resposta = await Promise.race([
      service.resend('ana@example.com').then(() => 'respondeu'),
      new Promise(r => setTimeout(() => r('ficou esperando o e-mail'), 200)),
    ]);
    expect(resposta).toBe('respondeu');
  });

  it('falha ao gerar/enviar: vai para o log, a resposta continua a mesma', async () => {
    const { service, prisma } = build();
    const erro = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    prisma.authToken.create.mockRejectedValue(new Error('banco fora'));
    await expect(service.resend('ana@example.com')).resolves.toBeUndefined();
    await esperarEnvio();
    expect(erro).toHaveBeenCalledWith(expect.stringContaining('usuário u1'), expect.any(String));
    prisma.authToken.create.mockRejectedValue('falha crua');
    await service.resend('ana@example.com');
    await esperarEnvio();
    expect(erro).toHaveBeenLastCalledWith(expect.any(String), 'falha crua');
  });
});

describe('EmailVerificationService.verify', () => {
  const futuro = () => new Date(Date.now() + 60_000);
  const valido = (over: Record<string, unknown> = {}) => ({
    id: 't1', userId: 'u1', purpose: 'VERIFY_EMAIL', expiresAt: futuro(), usedAt: null, user: { deletedAt: null }, ...over,
  });

  it('link válido: gasta o link, grava a senha criada agora, confirma o e-mail, invalida os outros links e abre a sessão', async () => {
    const { service, prisma, auth } = build();
    prisma.authToken.findUnique.mockResolvedValue(valido());
    await expect(service.verify(TOKEN, 'senha-nova-123')).resolves.toEqual({ access_token: 'sessao' });

    expect(prisma.authToken.findUnique.mock.calls[0][0].where).toEqual({ tokenHash: hashEmailToken(TOKEN) });
    expect(prisma.authToken.updateMany).toHaveBeenNthCalledWith(1, { where: { id: 't1', usedAt: null }, data: { usedAt: expect.any(Date) } });
    const upd = prisma.user.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'u1' });
    expect(await bcrypt.compare('senha-nova-123', upd.data.passwordHash)).toBe(true);
    expect(upd.data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(upd.data.passwordChangedAt).toBe(upd.data.emailVerifiedAt);
    expect(prisma.authToken.updateMany).toHaveBeenNthCalledWith(2, { where: { userId: 'u1', usedAt: null }, data: { usedAt: expect.any(Date) } });
    expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { id: true, name: true, email: true, role: true, termsVersion: true, healthConsent: true },
    });
    expect(auth.login).toHaveBeenCalledWith({ id: 'u1', role: 'athlete' });
  });

  it.each([
    ['inexistente', null],
    ['já usado', valido({ usedAt: new Date() })],
    ['vencido', valido({ expiresAt: new Date(Date.now() - 1) })],
    ['de senha (não confirma e-mail por aqui)', valido({ purpose: 'RESET_PASSWORD' })],
    ['de "crie sua senha"', valido({ purpose: 'SET_PASSWORD' })],
    ['de conta excluída', valido({ user: { deletedAt: new Date() } })],
  ])('link %s: 400, nada muda, sem sessão', async (_caso, token) => {
    const { service, prisma, auth } = build();
    prisma.authToken.findUnique.mockResolvedValue(token);
    await expect(service.verify(TOKEN, 'senha-nova-123')).rejects.toThrow('Link inválido ou expirado');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('dois cliques ao mesmo tempo: o segundo perde a corrida (400) e não abre sessão', async () => {
    const { service, prisma, auth } = build();
    prisma.authToken.findUnique.mockResolvedValue(valido());
    prisma.authToken.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.verify(TOKEN, 'senha-nova-123')).rejects.toThrow('Link inválido ou expirado');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(auth.login).not.toHaveBeenCalled();
  });
});
