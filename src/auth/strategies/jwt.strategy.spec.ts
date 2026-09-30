describe('JwtStrategy', () => {
  const OLD_ENV = process.env.JWT_SECRET;
  afterEach(() => { process.env.JWT_SECRET = OLD_ENV; jest.resetModules(); });

  it('sem JWT_SECRET no ambiente, falha ao construir (nunca sobe sem segredo)', async () => {
    delete process.env.JWT_SECRET;
    jest.resetModules();
    const { JwtStrategy } = await import('./jwt.strategy');
    expect(() => new JwtStrategy({} as never)).toThrow('JWT_SECRET não configurado');
  });

  it('validate() mapeia sub→id e repassa email/role/name do payload', async () => {
    process.env.JWT_SECRET = 'segredo-de-teste';
    jest.resetModules();
    const { JwtStrategy } = await import('./jwt.strategy');
    const strategy = new JwtStrategy({} as never);

    await expect(strategy.validate({ sub: 'u1', email: 'ana@example.com', role: 'coach', name: 'Ana' })).resolves.toEqual({
      id: 'u1', email: 'ana@example.com', role: 'coach', name: 'Ana', tv: null,
    });
    await expect(
      strategy.validate({ sub: 'u2', email: 'b@example.com', role: 'athlete', name: 'B', tv: '2026-09-30' }),
    ).resolves.toMatchObject({ tv: '2026-09-30' });
  });
});
