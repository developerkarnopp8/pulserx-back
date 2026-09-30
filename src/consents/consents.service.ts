import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { TERMS_VERSION } from '../common/terms';
import { PrismaService } from '../prisma/prisma.service';
import { scrubSkipText } from '../workout-skips/skip-message';

const CAMPOS_LOGIN = {
  id: true,
  name: true,
  email: true,
  role: true,
  termsVersion: true,
  healthConsent: true,
} as const;

@Injectable()
export class ConsentsService {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
  ) {}

  async get(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        termsVersion: true,
        healthConsent: true,
        healthConsentAt: true,
      },
    });
    return {
      termsVersion: TERMS_VERSION,
      termsAccepted: u.termsVersion === TERMS_VERSION,
      healthConsent: u.healthConsent,
      healthConsentAt: u.healthConsentAt?.toISOString() ?? null,
    };
  }

  /**
   * Próximo login (e toda troca de versão dos termos): grava o aceite e a resposta sobre saúde e devolve um token
   * NOVO — o antigo não traz a versão atual dos termos e seguiria barrado pelo JwtAuthGuard.
   */
  async accept(userId: string, healthConsent: boolean) {
    const user = await this.prisma.$transaction(async (tx) => {
      await this.gravarSaude(tx, userId, healthConsent);
      return tx.user.update({
        where: { id: userId },
        data: { termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION },
        select: CAMPOS_LOGIN,
      });
    });
    return this.auth.login(user);
  }

  /** Perfil: dar ou retirar o consentimento a qualquer momento. */
  async setHealth(userId: string, healthConsent: boolean) {
    const u = await this.prisma.$transaction((tx) => this.gravarSaude(tx, userId, healthConsent));
    return {
      healthConsent: u.healthConsent,
      healthConsentAt: u.healthConsentAt!.toISOString(),
    };
  }

  /**
   * Sem consentimento (recusou ou retirou — decisão do dono): os pulos continuam registrados, mas o motivo "Lesão"
   * vira "removido a pedido do aluno" (`Withheld`, nunca outro motivo inventado) e toda observação some — inclusive
   * nas cópias automáticas que o pulo gerou (mensagem ao coach e notificação). Idempotente.
   */
  private async gravarSaude(tx: Prisma.TransactionClient, userId: string, healthConsent: boolean) {
    const u = await tx.user.update({
      where: { id: userId },
      data: { healthConsent, healthConsentAt: new Date() },
      select: { healthConsent: true, healthConsentAt: true },
    });
    if (healthConsent) return u;

    await tx.workoutSkip.updateMany({
      where: { athleteId: userId, reason: 'Injury' },
      data: { reason: 'Withheld' },
    });
    await tx.workoutSkip.updateMany({
      where: { athleteId: userId, note: { not: null } },
      data: { note: null },
    });

    const mensagens = await tx.message.findMany({
      where: {
        fromId: userId,
        isSystem: true,
        content: { startsWith: 'Pulei "' },
      },
      select: { id: true, content: true },
    });
    for (const m of mensagens) {
      const limpo = scrubSkipText(m.content);
      if (limpo)
        await tx.message.update({
          where: { id: m.id },
          data: { content: limpo },
        });
    }

    // A notificação do pulo vai para o coach, com o link do plano DESTE aluno.
    // inclui desvinculados: a limpeza vale para todos os vínculos que o aluno já teve.
    const alunos = await tx.student.findMany({
      where: { userId },
      select: { id: true },
    });
    const notificacoes = await tx.notification.findMany({
      where: {
        type: 'workout_skipped',
        link: { in: alunos.map((a) => `/coach/plan-builder/${a.id}`) },
      },
      select: { id: true, body: true },
    });
    for (const n of notificacoes) {
      const limpo = n.body && scrubSkipText(n.body);
      if (limpo)
        await tx.notification.update({
          where: { id: n.id },
          data: { body: limpo },
        });
    }
    return u;
  }
}
