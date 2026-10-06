import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Registro de acessos do admin guardado por 12 meses (retenção LGPD; prazo mudável aqui). */
export const ADMIN_ACCESS_LOG_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
/** Roda uma vez por dia (e 2 minutos depois de a API subir). */
export const ADMIN_ACCESS_LOG_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PRIMEIRA_RODADA_MS = 2 * 60 * 1000;

/** Apaga os registros de acesso do admin com mais de 12 meses. Roda dentro da própria API, como a limpeza de inscrições. */
@Injectable()
export class AdminAccessLogCleanupService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AdminAccessLogCleanupService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(private prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    const rodar = () => void this.cleanup().catch(err =>
      this.logger.error('Falha na limpeza do registro de acessos do admin', err instanceof Error ? err.stack : String(err)),
    );
    // unref: o temporizador nunca segura o processo aberto (desligar a API ou terminar os testes).
    this.timers = [setTimeout(rodar, PRIMEIRA_RODADA_MS).unref(), setInterval(rodar, ADMIN_ACCESS_LOG_CLEANUP_INTERVAL_MS).unref()];
  }

  onApplicationShutdown(): void {
    this.timers.forEach(t => clearTimeout(t));
    this.timers = [];
  }

  /** Devolve quantos registros foram apagados. */
  async cleanup(now = new Date()): Promise<number> {
    const { count } = await this.prisma.adminAccessLog.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - ADMIN_ACCESS_LOG_RETENTION_MS) } },
    });
    return count;
  }
}
