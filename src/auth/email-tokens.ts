import type { AuthTokenPurpose } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import type { PrismaService } from '../prisma/prisma.service';

/** Token de link por e-mail: 32 bytes aleatórios (base64url). O banco guarda só o SHA-256. */
export function newEmailToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashEmailToken(token) };
}

export function hashEmailToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Validade dos links. Redefinir senha vale 1 hora (decisão do dono); os outros dois são convenção, ajustáveis. */
export const RESET_PASSWORD_TTL_MS = 60 * 60 * 1000;
/** Confirmar o e-mail da inscrição pela landing: 48 horas (dá tempo de achar o e-mail no spam). */
export const VERIFY_EMAIL_TTL_MS = 48 * 60 * 60 * 1000;
/** "Crie sua senha" da conta criada pelo coach/admin: 7 dias (a pessoa pode demorar a abrir). */
export const SET_PASSWORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Senha que ninguém conhece: conta criada por outra pessoa só entra depois de criar a própria senha pelo link. */
export function unusablePassword(): string {
  return randomBytes(32).toString('base64url');
}

/** Invalida os links abertos da mesma finalidade e cria um novo. Devolve o token (só vai no e-mail; o banco fica com o hash). */
export async function issueEmailToken(
  prisma: PrismaService,
  userId: string,
  purpose: AuthTokenPurpose,
  ttlMs: number,
): Promise<string> {
  const { token, tokenHash } = newEmailToken();
  const now = new Date();
  await prisma.$transaction([
    prisma.authToken.updateMany({ where: { userId, usedAt: null, purpose }, data: { usedAt: now } }),
    prisma.authToken.create({
      data: { userId, purpose, tokenHash, expiresAt: new Date(now.getTime() + ttlMs) },
      select: { id: true },
    }),
  ]);
  return token;
}
