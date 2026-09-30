import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuthTokenPurpose } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { appUrl } from '../common/app-url';
import { EmailService } from '../common/email.service';
import { escapeHtml } from '../common/escape-html';
import { ACTIVE_STUDENT } from '../common/student-scope';
import { PrismaService } from '../prisma/prisma.service';
import { hashEmailToken, issueEmailToken, RESET_PASSWORD_TTL_MS, SET_PASSWORD_TTL_MS } from './email-tokens';

type Destinatario = { id: string; name: string; email: string };

const LINK_INVALIDO = 'Link inválido ou expirado. Peça um novo em "Esqueci minha senha".';

/**
 * Senha por link no e-mail (decisões do dono, 2026-09-30): "Esqueci minha senha", o coach mandando o link ao aluno, o admin
 * mandando ao coach e o "crie sua senha" de quem teve a conta criada por outra pessoa. Link de uso único; pedir outro invalida o
 * anterior; trocar a senha derruba as sessões abertas (`passwordChangedAt`, conferido pelo JwtStrategy) e confirma o e-mail (quem
 * abriu o link recebeu o e-mail). O banco guarda só o hash do token.
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
    void this.sendResetLink(user, 'self').catch(err =>
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
    await this.sendResetLink(student.user, 'coach');
    return { sent: true };
  }

  /** Troca a senha pelo link: uso único, dentro da validade; derruba as sessões abertas. */
  async resetPassword(token: string, password: string): Promise<{ reset: true }> {
    const now = new Date();
    const found = await this.prisma.authToken.findUnique({
      where: { tokenHash: hashEmailToken(token) },
      select: { id: true, userId: true, purpose: true, expiresAt: true, usedAt: true, user: { select: { deletedAt: true, emailVerifiedAt: true } } },
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
      await tx.user.update({
        where: { id: found.userId },
        // Criar a senha pelo link prova que a pessoa recebe e-mail nesse endereço: vale como confirmação.
        data: { passwordHash, passwordChangedAt: now, ...(found.user.emailVerifiedAt ? {} : { emailVerifiedAt: now }) },
        select: { id: true },
      });
      // Qualquer outro link de senha ainda aberto deixa de valer.
      await tx.authToken.updateMany({
        where: {
          userId: found.userId,
          usedAt: null,
          // Inclui a confirmação: a conta ficou confirmada aqui e o link de confirmação não pode trocar a senha de novo.
          purpose: { in: [AuthTokenPurpose.RESET_PASSWORD, AuthTokenPurpose.SET_PASSWORD, AuthTokenPurpose.VERIFY_EMAIL] },
        },
        data: { usedAt: now },
      });
    });
    return { reset: true };
  }

  /** Link de nova senha (1 hora). Invalida os links de nova senha abertos. */
  async sendResetLink(user: Destinatario, quemPediu: 'self' | 'coach' | 'admin'): Promise<void> {
    const token = await issueEmailToken(this.prisma, user.id, AuthTokenPurpose.RESET_PASSWORD, RESET_PASSWORD_TTL_MS);
    // Token no fragmento (#): não vai para log de servidor nem no cabeçalho Referer.
    const link = `${appUrl()}/redefinir-senha#token=${token}`;
    const motivo = {
      self: 'Recebemos um pedido para trocar a senha da sua conta no PulseRx.',
      coach: 'Seu treinador pediu uma nova senha para a sua conta no PulseRx.',
      admin: 'A equipe do PulseRx enviou um link para você criar uma nova senha.',
    }[quemPediu];
    await this.email.send(
      user.email,
      'Crie uma nova senha — PulseRx',
      `<p>Olá, ${escapeHtml(user.name)}.</p><p>${motivo}</p>` +
        `<p><a href="${link}">Criar nova senha</a></p>` +
        '<p>O link vale 1 hora e só pode ser usado uma vez. Se você não pediu, ignore este e-mail — sua senha continua a mesma.</p>',
    );
    this.devLog(`link de nova senha de ${user.email}: ${link}`);
  }

  /**
   * Boas-vindas de quem teve a conta criada por outra pessoa (aluno pelo coach, coach pelo admin): link "crie sua senha", 7 dias.
   * Ninguém mais combina senha por WhatsApp. Se o link vencer, "Esqueci minha senha" (ou o coach) manda outro.
   */
  async sendWelcome(user: Destinatario, criadoPor: { tipo: 'coach'; nome: string } | { tipo: 'admin' }): Promise<void> {
    const token = await issueEmailToken(this.prisma, user.id, AuthTokenPurpose.SET_PASSWORD, SET_PASSWORD_TTL_MS);
    const link = `${appUrl()}/redefinir-senha#token=${token}`;
    const quem =
      criadoPor.tipo === 'coach'
        ? `Seu treinador ${escapeHtml(criadoPor.nome)} criou a sua conta no PulseRx.`
        : 'A equipe do PulseRx criou a sua conta de treinador.';
    await this.email.send(
      user.email,
      'Crie sua senha — PulseRx',
      `<p>Olá, ${escapeHtml(user.name)}.</p><p>${quem}</p>` +
        `<p><a href="${link}">Criar minha senha</a></p>` +
        '<p>O link vale 7 dias e só pode ser usado uma vez. Se venceu, use "Esqueci minha senha" na tela de entrada.</p>',
    );
    this.devLog(`link de criar senha de ${user.email}: ${link}`);
  }

  /** Sem domínio verificado no Resend o e-mail só chega ao dono da conta: fora de produção, o link vai para o log. */
  private devLog(msg: string): void {
    if (process.env.NODE_ENV !== 'production') this.logger.log(`[dev] ${msg}`);
  }
}
