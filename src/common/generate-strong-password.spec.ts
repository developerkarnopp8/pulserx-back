import { generateStrongPassword } from './generate-strong-password';

describe('generateStrongPassword (scripts de criação do 1º admin e seed de produção)', () => {
  it('24 caracteres base64url, diferente a cada chamada', () => {
    const a = generateStrongPassword();
    expect(a).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(a).not.toBe(generateStrongPassword());
  });
});
