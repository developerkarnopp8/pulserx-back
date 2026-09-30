import { createHash, randomBytes } from 'crypto';

/** Token de link por e-mail: 32 bytes aleatórios (base64url). O banco guarda só o SHA-256. */
export function newEmailToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashEmailToken(token) };
}

export function hashEmailToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Validade dos links (decisão do dono: redefinir senha vale 1 hora). */
export const RESET_PASSWORD_TTL_MS = 60 * 60 * 1000;
