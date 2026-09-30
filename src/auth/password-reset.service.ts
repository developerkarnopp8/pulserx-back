import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuthTokenPurpose } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { appUrl } from '../common/app-url';
import { EmailService } from '../common/email.service';
import { escapeHtml } from '../common/escape-html';
import { ACTIVE_STUDENT } from '../common/student-scope';
import { PrismaService } from '../prisma/prisma.service';
import { hashEmailToken, newEmailToken, RESET_PASSWORD_TTL_MS } from './email-tokens';

const LINK_INVALIDO = 'Link inválido ou expirado. Peça um novo em "Esqueci minha senha".';

/**
 * Senha por link no e-mail (decisões do dono, 2026-09-30): "Esqueci minha senha" e o coach mandando o link ao aluno.
 * Link de uso único, vale 1 hora; pedir outro invalida o anterior; trocar a senha derruba as sessões abertas
 * (`passwordChangedAt`, conferido pelo JwtStrategy). O banco guarda só o hash do token.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
  ) {}

  /**
   * Esqueci minha senha. Nunca diz se o e-mail tem conta: quem chama sempre recebe a mesma resposta, e o e-mail é
   * enviado em segundo plano (o tempo de resposta não muda com a existência da conta).
   */
  async requestReset(emailInformado: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: emailInformado.trim(), mode: 'insensitive' }, deletedAt: null },
      select: { id: true, name: true, email: true },
    });
    if (!user) return;
    void this.issueAndSend(user, 'self').catch(err =>
      this.logger.error(`Falha ao enviar o link de nova senha (usuário ${user.id})`, err instanceof Error ? err.stack : String(err)),
    );
  }

  /** Coach manda o link de nova senha a um aluno DELE (vínculo ativo). */
  async sendStudentReset(studentId: string, coachId: string): Promise<{ sent: true }> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId, ...ACTIVE_STUDENT },
      select: { coachId: true, user: { select: { id: true, name: true, email: true, deletedAt: true } } },
    });
    if (!student || student.coachId !== coachId || student.user.deletedAt) {
      throw new NotFoundException('Aluno não encontrado');
    }
    await this.issueAndSend(student.user, 'coach');
    return { sent: true };
  }

  /** Troca a senha pelo link: uso único, dentro da validade; derruba as sessões abertas. */
  async resetPassword(token: string, password: string): Promise<{ reset: true }> {
    const now = new Date();
    const found = await this.prisma.authToken.findUnique({
      where: { tokenHash: hashEmailToken(token) },
      select: { id: true, userId: true, purpose: true, expiresAt: true, usedAt: true, user: { select: { deletedAt: true } } },
    });
    const valido =
      found &&
      (found.purpose === AuthTokenPurpose.RESET_PASSWORD || found.purpose === AuthTokenPurpose.SET_PASSWORD) &&
      !found.usedAt &&
      found.expiresAt > now &&
      !found.user.deletedAt;
    if (!valido) throw new BadRequestException(LINK_INVALIDO);

    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.$transaction(async tx => {
      // Trava otimista: dois envios do mesmo link ao mesmo tempo → só um troca a senha.
      const { count } = await tx.authToken.updateMany({ where: { id: found.id, usedAt: null }, data: { usedAt: now } });
      if (count === 0) throw new BadRequestException(LINK_INVALIDO);
      await tx.user.update({ where: { id: found.userId }, data: { passwordHash, passwordChangedAt: now }, select: { id: true } });
      // Qualquer outro link de senha ainda aberto deixa de valer.
      await tx.authToken.updateMany({
        where: {
          userId: found.userId,
          usedAt: null,
          purpose: { in: [AuthTokenPurpose.RESET_PASSWORD, AuthTokenPurpose.SET_PASSWORD] },
        },
        data: { usedAt: now },
      });
    });
    return { reset: true };
  }

  /** Invalida os links de senha abertos, cria um novo e envia. */
  private async issueAndSend(user: { id: string; name: string; email: string }, quemPediu: 'self' | 'coach'): Promise<void> {
    const { token, tokenHash } = newEmailToken();
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.authToken.updateMany({
        where: { userId: user.id, usedAt: null, purpose: AuthTokenPurpose.RESET_PASSWORD },
        data: { usedAt: now },
      }),
      this.prisma.authToken.create({
        data: {
          userId: user.id,
          purpose: AuthTokenPurpose.RESET_PASSWORD,
          tokenHash,
          expiresAt: new Date(now.getTime() + RESET_PASSWORD_TTL_MS),
        },
        select: { id: true },
      }),
    ]);

    // Token no fragmento (#): não vai para log de servidor nem no cabeçalho Referer.
    const link = `${appUrl()}/redefinir-senha#token=${token}`;
    const nome = escapeHtml(user.name);
    const motivo =
      quemPediu === 'coach'
        ? 'Seu treinador pediu uma nova senha para a sua conta no PulseRx.'
        : 'Recebemos um pedido para trocar a senha da sua conta no PulseRx.';
    await this.email.send(
      user.email,
      'Crie uma nova senha — PulseRx',
      `<p>Olá, ${nome}.</p><p>${motivo}</p>` +
        `<p><a href="${link}">Criar nova senha</a></p>` +
        '<p>O link vale 1 hora e só pode ser usado uma vez. Se você não pediu, ignore este e-mail — sua senha continua a mesma.</p>',
    );
    // Sem domínio verificado no Resend o e-mail só chega ao dono da conta: fora de produção, o link vai para o log.
    if (process.env.NODE_ENV !== 'production') this.logger.log(`[dev] link de nova senha de ${user.email}: ${link}`);
  }
}
