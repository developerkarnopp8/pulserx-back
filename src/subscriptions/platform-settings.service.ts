import { ConflictException, Injectable } from '@nestjs/common';
import { PaymentStatus, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GRANTING_STATUSES, PAST_DUE_GRACE_DAYS } from './subscription-access.service';
import { ACTIVE_STUDENT } from '../common/student-scope';

export type PlatformSettingsView = {
  enforceSubscriptionAccess: boolean;
  totalStudents: number;
  /** Alunos sem assinatura ACTIVE/TRIALING (ou com teste já vencido) — perderiam o acesso se o bloqueio estiver/for ligado. */
  studentsWithoutAccess: number;
};

@Injectable()
export class PlatformSettingsService {
  constructor(private prisma: PrismaService) {}

  async get(now = new Date()): Promise<PlatformSettingsView> {
    const fimDaTolerancia = new Date(now.getTime() - PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000);
    const [settings, totalStudents, studentsWithoutAccess] = await Promise.all([
      this.prisma.platformSettings.findUnique({ where: { id: 'singleton' } }),
      this.prisma.student.count({ where: ACTIVE_STUDENT }),
      this.prisma.student.count({
        where: {
          ...ACTIVE_STUDENT,
          OR: [
            { subscription: null },
            // Mesma regra de `accessState` (subscription-access.service.ts):
            { subscription: { status: { notIn: [...GRANTING_STATUSES, SubscriptionStatus.PAST_DUE] as SubscriptionStatus[] } } },
            // teste vencido não dá acesso;
            { subscription: { status: SubscriptionStatus.TRIALING, trialEndsAt: { lte: now } } },
            // inadimplente sem fatura vencida no Asaas (posto à mão) ou com a mais antiga fora da tolerância;
            { subscription: { status: SubscriptionStatus.PAST_DUE, gatewayPayments: { none: { status: PaymentStatus.overdue } } } },
            {
              subscription: {
                status: SubscriptionStatus.PAST_DUE,
                gatewayPayments: { some: { status: PaymentStatus.overdue, dueDate: { lte: fimDaTolerancia } } },
              },
            },
            // cobrança contestada no cartão.
            { subscription: { gatewayPayments: { some: { status: PaymentStatus.chargeback } } } },
          ],
        },
      }),
    ]);
    return {
      enforceSubscriptionAccess: settings?.enforceSubscriptionAccess ?? false,
      totalStudents,
      studentsWithoutAccess,
    };
  }

  /**
   * Ligar o bloqueio tranca quem não tem plano: se houver alunos sem acesso liberado, exige
   * `confirmLockout` explícito (o admin vê a contagem antes). Desligar é sempre livre.
   */
  async setEnforcement(enable: boolean, confirmLockout = false): Promise<PlatformSettingsView> {
    if (enable && !confirmLockout) {
      const { studentsWithoutAccess } = await this.get();
      if (studentsWithoutAccess > 0) {
        throw new ConflictException(
          `${studentsWithoutAccess} aluno(s) ficariam sem acesso (sem plano ativo). Confirme para ligar mesmo assim.`,
        );
      }
    }
    await this.prisma.platformSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', enforceSubscriptionAccess: enable },
      update: { enforceSubscriptionAccess: enable },
    });
    return this.get();
  }
}
