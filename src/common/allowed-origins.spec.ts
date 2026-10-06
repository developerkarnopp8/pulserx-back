import { ALLOWED_ORIGINS } from './allowed-origins';

describe('ALLOWED_ORIGINS', () => {
  it('inclui o domínio definitivo (com e sem www) e mantém o antigo durante a migração', () => {
    expect(ALLOWED_ORIGINS).toEqual(expect.arrayContaining([
      'https://pulserx.com.br', 'https://www.pulserx.com.br', 'https://aevonfit.aevon.online',
    ]));
  });

  it('nunca libera qualquer site nem http fora do localhost', () => {
    expect(ALLOWED_ORIGINS).not.toContain('*');
    for (const o of ALLOWED_ORIGINS) {
      expect(o.startsWith('https://') || o.startsWith('http://localhost:')).toBe(true);
    }
  });
});
