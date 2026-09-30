import {
  hashEmailToken, newEmailToken, RESET_PASSWORD_TTL_MS, SET_PASSWORD_TTL_MS, unusablePassword, VERIFY_EMAIL_TTL_MS,
} from './email-tokens';

describe('tokens de link por e-mail', () => {
  it('token longo e aleatório; o banco recebe só o hash (64 hex), que confere com o token', () => {
    const a = newEmailToken();
    const b = newEmailToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).not.toContain(a.token);
    expect(hashEmailToken(a.token)).toBe(a.tokenHash);
  });

  it('redefinir senha vale 1 hora (decisão do dono)', () => {
    expect(RESET_PASSWORD_TTL_MS).toBe(3_600_000);
  });

  it('confirmar e-mail vale 48 horas e "crie sua senha" vale 7 dias', () => {
    expect(VERIFY_EMAIL_TTL_MS).toBe(172_800_000);
    expect(SET_PASSWORD_TTL_MS).toBe(604_800_000);
  });

  it('senha inutilizável: longa e diferente a cada conta', () => {
    const a = unusablePassword();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(unusablePassword());
  });
});
