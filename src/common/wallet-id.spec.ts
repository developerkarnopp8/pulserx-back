import { isValidWalletId, normalizeWalletId } from './wallet-id';

describe('Wallet ID do Asaas', () => {
  it('UUID de verdade: válido (com espaços nas pontas ou maiúsculas também)', () => {
    expect(isValidWalletId('c0c1688f-636b-42c0-b6ee-7339182276b7')).toBe(true);
    expect(isValidWalletId('  C0C1688F-636B-42C0-B6EE-7339182276B7 ')).toBe(true);
  });

  it.each([
    null, undefined, '', 'minha-carteira', 'c0c1688f636b42c0b6ee7339182276b7',
    'c0c1688f-636b-42c0-b6ee-7339182276bz', '00000000-0000-0000-0000-000000000000', '<script>',
  ])('inválido: %s', v => {
    expect(isValidWalletId(v as any)).toBe(false);
  });

  it('normaliza texto (espaços/maiúsculas) e deixa o resto como veio', () => {
    expect(normalizeWalletId('  ABC ')).toBe('abc');
    expect(normalizeWalletId(5)).toBe(5);
  });
});
