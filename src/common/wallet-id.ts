/**
 * Wallet ID do Asaas (identificador da carteira onde o coach recebe a parte dele de cada cobrança): um UUID —
 * `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`, letras a–f e números. Não é segredo: só serve para receber.
 */
export const WALLET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Código de exemplo/teste (só zeros) nunca é uma carteira de verdade. */
const NIL_WALLET = '00000000-0000-0000-0000-000000000000';

export const WALLET_ID_FORMAT_MESSAGE =
  'Wallet ID inválido. Ele tem o formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (letras de a a f e números). Copie do painel do Asaas.';

/** Tira espaços das pontas (cópia do painel costuma trazer) e padroniza em minúsculas. */
export function normalizeWalletId(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export function isValidWalletId(value: string | null | undefined): value is string {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return WALLET_ID_PATTERN.test(v) && v !== NIL_WALLET;
}
