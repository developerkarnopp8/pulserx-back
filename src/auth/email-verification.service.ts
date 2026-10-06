import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AuthTokenPurpose } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { appUrl } from '../common/app-url';
import { EmailService } from '../common/email.service';
import { renderEmail } from '../common/email-layout';
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
 * Confirmação de e-mail da inscrição pela landing (decisões do dono, 2026-09-30): a conta nova só entra depois de confirmar,
 * e é no link de confirmação que a pessoa CRIA A SENHA (a inscrição não tem senha) — quem se inscreve com o e-mail de outra
 * pessoa nunca chega a ter uma senha que funcione. Contas anteriores foram marcadas como confirmadas na migration. O link vale
 * 48 horas, uso único; confirmar abre a sessão (o link prova que a pessoa recebe e-mail nesse endereço).
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
    const { html, text } = renderEmail({
      preheader: 'Falta só confirmar o seu e-mail e criar a sua senha.',
      title: 'Confirme seu e-mail',
      greetingName: user.name,
      paragraphs: ['Falta só confirmar o seu e-mail e criar a sua senha para entrar no PulseRx.'],
      cta: { label: 'Confirmar e criar minha senha', url: link },
      note: 'O link vale 48 horas e só pode ser usado uma vez. Se você não se inscreveu, ignore este e-mail.',
    });
    await this.email.send(user.email, 'Confirme seu e-mail e crie sua senha — PulseRx', html, text);
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

  /** Confirma pelo link (uso único, dentro da validade), grava a senha criada agora e abre a sessão. */
  async verify(token: string, password: string) {
    const now = new Date();
    const found = await this.prisma.authToken.findUnique({
      where: { tokenHash: hashEmailToken(token) },
      select: { id: true, userId: true, purpose: true, expiresAt: true, usedAt: true, user: { select: { deletedAt: true } } },
    });
    const valido =
      found && found.purpose === AuthTokenPurpose.VERIFY_EMAIL && !found.usedAt && found.expiresAt > now && !found.user.deletedAt;
    if (!valido) throw new BadRequestException(LINK_INVALIDO);

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.prisma.$transaction(async tx => {
      // Trava otimista: dois cliques no mesmo link ao mesmo tempo → só um abre sessão.
      const { count } = await tx.authToken.updateMany({ where: { id: found.id, usedAt: null }, data: { usedAt: now } });
      if (count === 0) throw new BadRequestException(LINK_INVALIDO);
      await tx.user.update({
        where: { id: found.userId },
        data: { passwordHash, passwordChangedAt: now, emailVerifiedAt: now },
        select: { id: true },
      });
      // Qualquer outro link aberto (confirmação reenviada, nova senha) deixa de valer.
      await tx.authToken.updateMany({ where: { userId: found.userId, usedAt: null }, data: { usedAt: now } });
      return tx.user.findUniqueOrThrow({
        where: { id: found.userId },
        select: { id: true, name: true, email: true, role: true, termsVersion: true, healthConsent: true },
      });
    });
    return this.auth.login(user);
  }
}
