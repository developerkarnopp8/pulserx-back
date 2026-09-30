import * as bcrypt from 'bcrypt';
import { hashEmailToken } from './email-tokens';
import { PasswordResetService } from './password-reset.service';

const TOKEN = 'a'.repeat(43);

function build() {
  const prisma: any = {
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: 'u1', name: 'Ana <b>', email: 'ana@example.com' }),
      update: jest.fn().mockResolvedValue({ id: 'u1' }),
    },
    student: {
      findUnique: jest.fn().mockResolvedValue({
        coachId: 'coach-1', user: { id: 'u2', name: 'Bia', email: 'bia@example.com', deletedAt: null },
      }),
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
  return { service: new PasswordResetService(prisma, email as any), prisma, email };
}

const esperarEnvio = () => new Promise(r => setImmediate(r));

describe('PasswordResetService.requestReset — esqueci minha senha', () => {
  it('conta existe: cria link de 1 hora (invalidando o anterior) e manda por e-mail, com o nome escapado', async () => {
    const { service, prisma, email } = build();
    const antes = Date.now();
    await service.requestReset('  Ana@Example.com ');
    await esperarEnvio();

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: { equals: 'Ana@Example.com', mode: 'insensitive' }, deletedAt: null },
      select: { id: true, name: true, email: true },
    });
    expect(prisma.authToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', usedAt: null, purpose: 'RESET_PASSWORD' },
      data: { usedAt: expect.any(Date) },
    });
    const data = prisma.authToken.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: 'u1', purpose: 'RESET_PASSWORD' });
    expect(data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const validade = data.expiresAt.getTime() - antes;
    expect(validade).toBeGreaterThanOrEqual(3_600_000 - 50);
    expect(validade).toBeLessThanOrEqual(3_600_000 + 1000);

    const [para, assunto, html] = email.send.mock.calls[0];
    expect(para).toBe('ana@example.com');
    expect(assunto).toBe('Crie uma nova senha — PulseRx');
    expect(html).toContain('Ana &lt;b&gt;');
    expect(html).toContain('Recebemos um pedido');
    // O token vai no fragmento (#) e o banco guarda só o hash dele.
    const token = /#token=([A-Za-z0-9_-]{43})"/.exec(html)![1];
    expect(hashEmailToken(token)).toBe(data.tokenHash);
    expect(html).toContain('http://localhost:4200/redefinir-senha#token=');
  });

  it('responde sem esperar o envio do e-mail (o tempo de resposta não revela se a conta existe)', async () => {
    const { service, email } = build();
    email.send.mockReturnValue(new Promise(() => undefined)); // envio que nunca termina
    const resposta = await Promise.race([
      service.requestReset('ana@example.com').then(() => 'respondeu'),
      new Promise(r => setTimeout(() => r('ficou esperando o e-mail'), 200)),
    ]);
    expect(resposta).toBe('respondeu');
  });

  it('e-mail sem conta (ou conta excluída): não envia nada, mesma resposta', async () => {
    const { service, prisma, email } = build();
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.requestReset('ninguem@example.com')).resolves.toBeUndefined();
    await esperarEnvio();
    expect(prisma.authToken.create).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('falha ao gerar/enviar: registra no log e a resposta continua a mesma (não vira oráculo)', async () => {
    const { service, prisma } = build();
    prisma.authToken.create.mockRejectedValue(new Error('banco fora'));
    const erro = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    await expect(service.requestReset('ana@example.com')).resolves.toBeUndefined();
    await esperarEnvio();
    expect(erro).toHaveBeenCalledWith(expect.stringContaining('usuário u1'), expect.any(String));

    prisma.authToken.create.mockRejectedValue('falha crua');
    await service.requestReset('ana@example.com');
    await esperarEnvio();
    expect(erro).toHaveBeenLastCalledWith(expect.any(String), 'falha crua');
  });

  it('em produção não escreve o link no log', async () => {
    const env = process.env.NODE_ENV;
    const url = process.env.APP_URL;
    process.env.NODE_ENV = 'production';
    process.env.APP_URL = 'https://aevonfit.aevon.online';
    const { service, email } = build();
    const log = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    await service.requestReset('ana@example.com');
    await esperarEnvio();
    expect(email.send.mock.calls[0][2]).toContain('https://aevonfit.aevon.online/redefinir-senha#token=');
    expect(log).not.toHaveBeenCalled();
    process.env.NODE_ENV = env;
    process.env.APP_URL = url;
  });
});

describe('PasswordResetService.sendStudentReset — coach manda o link ao aluno', () => {
  it('aluno do coach (vínculo ativo): envia com o texto de que foi o treinador quem pediu', async () => {
    const { service, prisma, email } = build();
    await expect(service.sendStudentReset('s1', 'coach-1')).resolves.toEqual({ sent: true });
    expect(prisma.student.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's1', unlinkedAt: null } }));
    expect(prisma.authToken.create.mock.calls[0][0].data.userId).toBe('u2');
    expect(email.send.mock.calls[0][0]).toBe('bia@example.com');
    expect(email.send.mock.calls[0][2]).toContain('Seu treinador pediu');
  });

  it.each([
    ['aluno de outro coach (IDOR)', { coachId: 'coach-9', user: { id: 'u2', name: 'B', email: 'b@example.com', deletedAt: null } }],
    ['aluno inexistente ou desvinculado', null],
    ['conta do aluno excluída', { coachId: 'coach-1', user: { id: 'u2', name: 'B', email: 'b@example.com', deletedAt: new Date() } }],
  ])('%s: 404 e nenhum e-mail', async (_caso, student) => {
    const { service, prisma, email } = build();
    prisma.student.findUnique.mockResolvedValue(student);
    await expect(service.sendStudentReset('s1', 'coach-1')).rejects.toThrow('Aluno não encontrado');
    expect(prisma.authToken.create).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });
});

describe('PasswordResetService.resetPassword — criar a senha nova pelo link', () => {
  const futuro = () => new Date(Date.now() + 60_000);
  const valido = (over: Record<string, unknown> = {}) => ({
    id: 't1', userId: 'u1', purpose: 'RESET_PASSWORD', expiresAt: futuro(), usedAt: null, user: { deletedAt: null }, ...over,
  });

  it('link válido: troca a senha, marca a troca (derruba sessões), gasta o link e invalida os outros', async () => {
    const { service, prisma } = build();
    prisma.authToken.findUnique.mockResolvedValue(valido());
    await expect(service.resetPassword(TOKEN, 'senha-nova-123')).resolves.toEqual({ reset: true });

    expect(prisma.authToken.findUnique.mock.calls[0][0].where).toEqual({ tokenHash: hashEmailToken(TOKEN) });
    expect(prisma.authToken.updateMany).toHaveBeenNthCalledWith(1, { where: { id: 't1', usedAt: null }, data: { usedAt: expect.any(Date) } });
    const { data } = prisma.user.update.mock.calls[0][0];
    expect(await bcrypt.compare('senha-nova-123', data.passwordHash)).toBe(true);
    expect(data.passwordChangedAt).toBeInstanceOf(Date);
    expect(prisma.authToken.updateMany).toHaveBeenNthCalledWith(2, {
      where: { userId: 'u1', usedAt: null, purpose: { in: ['RESET_PASSWORD', 'SET_PASSWORD'] } },
      data: { usedAt: expect.any(Date) },
    });
  });

  it('link de "crie sua senha" (boas-vindas) também serve', async () => {
    const { service, prisma } = build();
    prisma.authToken.findUnique.mockResolvedValue(valido({ purpose: 'SET_PASSWORD' }));
    await expect(service.resetPassword(TOKEN, 'senha-nova-123')).resolves.toEqual({ reset: true });
  });

  it.each([
    ['inexistente', null],
    ['já usado', valido({ usedAt: new Date() })],
    ['vencido', valido({ expiresAt: new Date(Date.now() - 1) })],
    ['de confirmação de e-mail (não troca senha)', valido({ purpose: 'VERIFY_EMAIL' })],
    ['de conta excluída', valido({ user: { deletedAt: new Date() } })],
  ])('link %s: 400 e a senha não muda', async (_caso, token) => {
    const { service, prisma } = build();
    prisma.authToken.findUnique.mockResolvedValue(token);
    await expect(service.resetPassword(TOKEN, 'senha-nova-123')).rejects.toThrow('Link inválido ou expirado');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('dois envios do mesmo link ao mesmo tempo: o segundo perde a corrida (400) e não troca a senha', async () => {
    const { service, prisma } = build();
    prisma.authToken.findUnique.mockResolvedValue(valido());
    prisma.authToken.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.resetPassword(TOKEN, 'senha-nova-123')).rejects.toThrow('Link inválido ou expirado');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
