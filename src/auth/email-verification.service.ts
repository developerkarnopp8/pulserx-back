import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AuthTokenPurpose } from '@prisma/client';
import { appUrl } from '../common/app-url';
import { EmailService } from '../common/email.service';
import { escapeHtml } from '../common/escape-html';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { hashEmailToken, issueEmailToken, VERIFY_EMAIL_TTL_MS } from './email-tokens';

const LINK_INVALIDO = 'Link inválido ou expirado. Na tela de entrada, peça um novo e-mail de confirmação.';

/** Para onde o aluno segue depois de confirmar: o plano que ele escolheu na página do coach. */
export interface ContinuarAssinatura {
  slug: string;
  planId: string;
}

/**
 * Confirmação de e-mail da inscrição pela landing (decisão do dono, 2026-09-30): a conta nova só entra depois de confirmar.
 * Contas anteriores foram marcadas como confirmadas na migration. O link vale 48 horas, uso único; confirmar abre a sessão
 * (o link prova que a pessoa recebe e-mail nesse endereço — mesma prova do "Esqueci minha senha").
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private auth: AuthService,
  ) {}

  async sendVerification(user: { id: string; name: string; email: string }, continuar?: ContinuarAssinatura): Promise<void> {
    const token = await issueEmailToken(this.prisma, user.id, AuthTokenPurpose.VERIFY_EMAIL, VERIFY_EMAIL_TTL_MS);
    // Token (e o plano escolhido) no fragmento (#): não vai para log de servidor nem no cabeçalho Referer.
    const extra = continuar ? `&c=${encodeURIComponent(continuar.slug)}&plano=${encodeURIComponent(continuar.planId)}` : '';
    const link = `${appUrl()}/confirmar-email#token=${token}${extra}`;
    await this.email.send(
      user.email,
      'Confirme seu e-mail — PulseRx',
      `<p>Olá, ${escapeHtml(user.name)}.</p><p>Falta só confirmar o seu e-mail para entrar no PulseRx.</p>` +
        `<p><a href="${link}">Confirmar meu e-mail</a></p>` +
        '<p>O link vale 48 horas e só pode ser usado uma vez. Se você não se inscreveu, ignore este e-mail.</p>',
    );
    if (process.env.NODE_ENV !== 'production') this.logger.log(`[dev] link de confirmação de ${user.email}: ${link}`);
  }

  /**
   * Reenviar a confirmação (tela de entrada). Nunca diz se o e-mail tem conta nem se já foi confirmado: a resposta é
   * sempre a mesma e o envio roda em segundo plano (o tempo de resposta não muda).
   */
  async resend(emailInformado: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: emailInformado.trim(), mode: 'insensitive' }, deletedAt: null, emailVerifiedAt: null },
      select: { id: true, name: true, email: true },
    });
    if (!user) return;
    void this.sendVerification(user).catch(err =>
      this.logger.error(`Falha ao reenviar a confirmação (usuário ${user.id})`, err instanceof Error ? err.stack : String(err)),
    );
  }

  /** Confirma pelo link (uso único, dentro da validade) e abre a sessão. */
  async verify(token: string) {
    const now = new Date();
    const found = await this.prisma.authToken.findUnique({
      where: { tokenHash: hashEmailToken(token) },
      select: { id: true, userId: true, purpose: true, expiresAt: true, usedAt: true, user: { select: { deletedAt: true } } },
    });
    const valido =
      found && found.purpose === AuthTokenPurpose.VERIFY_EMAIL && !found.usedAt && found.expiresAt > now && !found.user.deletedAt;
    if (!valido) throw new BadRequestException(LINK_INVALIDO);

    const user = await this.prisma.$transaction(async tx => {
      // Trava otimista: dois cliques no mesmo link ao mesmo tempo → só um abre sessão.
      const { count } = await tx.authToken.updateMany({ where: { id: found.id, usedAt: null }, data: { usedAt: now } });
      if (count === 0) throw new BadRequestException(LINK_INVALIDO);
      await tx.user.updateMany({ where: { id: found.userId, emailVerifiedAt: null }, data: { emailVerifiedAt: now } });
      return tx.user.findUniqueOrThrow({
        where: { id: found.userId },
        select: { id: true, name: true, email: true, role: true, termsVersion: true, healthConsent: true },
      });
    });
    return this.auth.login(user);
  }
}
