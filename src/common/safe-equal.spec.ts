import { safeEqual } from './safe-equal';

describe('safeEqual', () => {
  it('true para strings idênticas', () => {
    expect(safeEqual('token-123', 'token-123')).toBe(true);
  });

  it('false para strings diferentes de mesmo tamanho', () => {
    expect(safeEqual('token-123', 'token-456')).toBe(false);
  });

  it('false para strings de tamanhos diferentes (nunca chega a comparar byte a byte)', () => {
    expect(safeEqual('curto', 'muito-mais-comprido')).toBe(false);
  });

  it('false para string vazia contra não vazia', () => {
    expect(safeEqual('', 'token')).toBe(false);
  });
});
