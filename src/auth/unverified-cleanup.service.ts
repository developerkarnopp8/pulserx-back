import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { AuthTokenPurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Inscrição que não confirmou o e-mail em 7 dias é apagada (decisão do dono, 2026-09-30 — retenção LGPD). */
export const UNVERIFIED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** De quanto em quanto tempo a limpeza roda (e 1 minuto depois de a API subir). */
export const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PRIMEIRA_RODADA_MS = 60 * 1000;
/** Janela para achar o aviso "Fulano se inscreveu" do coach, gravado logo depois da conta. */
const JANELA_AVISO_MS = 10 * 60 * 1000;
const LOTE = 100;

/**
 * Apaga as inscrições abandonadas: aluno que se inscreveu pela landing e nunca confirmou o e-mail. Regra conservadora — só
 * apaga quando é certo que ninguém usa a conta:
 * - e-mail não confirmado, conta criada há mais de 7 dias, não excluída;
 * - NÃO foi cadastrado pelo coach (esses recebem "crie sua senha" — nunca tiveram link `SET_PASSWORD`);
 * - sem assinatura, sem cobrança, sem plano de treino e sem mensagens (se o coach já começou a trabalhar com ele, fica).
 * Apaga a conta inteira (o vínculo e os links vão em cascata) e o aviso "se inscreveu" que o coach recebeu, que tem o nome.
 * Roda dentro da própria API (um só container em produção), sem dependência nova de agendador.
 */
@Injectable()
export class UnverifiedCleanupService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(UnverifiedCleanupService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(private prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    const rodar = () => void this.cleanup().catch(err =>
      this.logger.error('Falha na limpeza de inscrições não confirmadas', err instanceof Error ? err.stack : String(err)),
    );
    // unref: o temporizador nunca segura o processo aberto (desligar a API ou terminar os testes).
    this.timers = [setTimeout(rodar, PRIMEIRA_RODADA_MS).unref(), setInterval(rodar, CLEANUP_INTERVAL_MS).unref()];
  }

  onApplicationShutdown(): void {
    this.timers.forEach(t => clearTimeout(t));
    this.timers = [];
  }

  /** Apaga um lote de inscrições abandonadas. Devolve quantas contas foram apagadas. */
  async cleanup(now = new Date()): Promise<number> {
    const candidatos = await this.prisma.user.findMany({
      where: {
        role: 'athlete',
        emailVerifiedAt: null,
        deletedAt: null,
        createdAt: { lt: new Date(now.getTime() - UNVERIFIED_RETENTION_MS) },
        authTokens: { none: { purpose: AuthTokenPurpose.SET_PASSWORD } },
        sentMessages: { none: {} },
        receivedMessages: { none: {} },
        student: { is: { subscription: { is: null }, payments: { none: {} }, trainingPlans: { none: {} } } },
      },
      select: { id: true, name: true, createdAt: true, student: { select: { coachId: true } } },
      orderBy: { createdAt: 'asc' },
      take: LOTE,
    });

    let apagadas = 0;
    for (const u of candidatos) {
      const apagou = await this.prisma.$transaction(async tx => {
        // Confirmou o e-mail entre a busca e agora? Então fica (a condição vai no próprio delete).
        const { count } = await tx.user.deleteMany({ where: { id: u.id, emailVerifiedAt: null } });
        if (count === 0) return false;
        await tx.notification.deleteMany({
          where: {
            userId: u.student!.coachId,
            type: 'new_student',
            body: { startsWith: `${u.name} se inscreveu` },
            createdAt: { gte: u.createdAt, lte: new Date(u.createdAt.getTime() + JANELA_AVISO_MS) },
          },
        });
        return true;
      });
      if (apagou) apagadas++;
    }
    // Só a contagem — nunca nome/e-mail no log.
    if (apagadas) this.logger.log(`Inscrições não confirmadas em 7 dias apagadas: ${apagadas}`);
    return apagadas;
  }
}
