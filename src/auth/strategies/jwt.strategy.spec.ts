// O cliente do Prisma carrega o .env ao ser importado (e traria o JWT_SECRET de volta): o teste usa um dublê.
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));

describe('JwtStrategy', () => {
  const OLD_ENV = process.env.JWT_SECRET;
  afterEach(() => { process.env.JWT_SECRET = OLD_ENV; jest.resetModules(); });

  async function build(conta: unknown) {
    process.env.JWT_SECRET = 'segredo-de-teste';
    jest.resetModules();
    const { JwtStrategy } = await import('./jwt.strategy');
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(conta) } };
    return { strategy: new JwtStrategy({} as never, prisma as never), prisma };
  }

  it('sem JWT_SECRET no ambiente, falha ao construir (nunca sobe sem segredo)', async () => {
    delete process.env.JWT_SECRET;
    jest.resetModules();
    const { JwtStrategy } = await import('./jwt.strategy');
    expect(() => new JwtStrategy({} as never, {} as never)).toThrow('JWT_SECRET não configurado');
  });

  it('validate() mapeia sub→id, repassa email/role/name/tv e confere a conta no banco', async () => {
    const { strategy, prisma } = await build({ deletedAt: null, student: null });

    await expect(strategy.validate({ sub: 'u1', email: 'ana@example.com', role: 'coach', name: 'Ana' })).resolves.toEqual({
      id: 'u1', email: 'ana@example.com', role: 'coach', name: 'Ana', tv: null, unlinked: false,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { deletedAt: true, student: { select: { unlinkedAt: true } } },
    });
    await expect(
      strategy.validate({ sub: 'u2', email: 'b@example.com', role: 'athlete', name: 'B', tv: '2026-09-30' }),
    ).resolves.toMatchObject({ tv: '2026-09-30', unlinked: false });
  });

  it.each([
    ['conta que não existe mais', null],
    ['conta excluída (anonimizada)', { deletedAt: new Date(), student: null }],
  ])('%s: token recusado (401) mesmo dentro da validade', async (_caso, conta) => {
    const { strategy } = await build(conta);
    // resetModules carrega outra cópia do @nestjs/common: compara status e mensagem, não a classe.
    await expect(strategy.validate({ sub: 'u1', role: 'athlete' })).rejects.toMatchObject({
      status: 401,
      message: 'Sessão encerrada. Entre novamente.',
    });
  });

  it('aluno com vínculo encerrado: marcado como unlinked (o guard barra)', async () => {
    const { strategy } = await build({ deletedAt: null, student: { unlinkedAt: new Date() } });
    await expect(strategy.validate({ sub: 'u1', role: 'athlete' })).resolves.toMatchObject({ unlinked: true });
  });

  it('coach nunca é "unlinked" (o campo é só do vínculo do aluno)', async () => {
    const { strategy } = await build({ deletedAt: null, student: { unlinkedAt: new Date() } });
    await expect(strategy.validate({ sub: 'c1', role: 'coach' })).resolves.toMatchObject({ unlinked: false });
  });
});
