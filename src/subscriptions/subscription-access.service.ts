import { ForbiddenException, Injectable } from '@nestjs/common';
import { SubscriptionStatus, TrainingCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Status que dão acesso ao conteúdo. PAST_DUE e CANCELED NÃO dão acesso por enquanto —
 * carência de inadimplência e "cancelou mas pagou até o fim do período" são regras de
 * negócio ainda não decididas (Rodada 3/4); até lá, o mais conservador.
 */
export const GRANTING_STATUSES: SubscriptionStatus[] = [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING];

@Injectable()
export class SubscriptionAccessService {
  constructor(private prisma: PrismaService) {}

  /** Quando false o acesso NÃO é limitado pela assinatura (comportamento pré-v2). */
  async isEnforced(): Promise<boolean> {
    const settings = await this.prisma.platformSettings.findUnique({ where: { id: 'singleton' } });
    return settings?.enforceSubscriptionAccess ?? false;
  }

  /**
   * Categorias que a assinatura do aluno libera. Sem assinatura, assinatura sem status de
   * acesso ou trial vencido → []. O plano estar `active: false` NÃO corta quem já assina
   * (active só controla se o plano aparece pra novas assinaturas).
   */
  async getAccessibleCategories(studentId: string, now: Date = new Date()): Promise<TrainingCategory[]> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { studentId },
      include: { plan: { select: { categories: true } } },
    });
    return SubscriptionAccessService.grantedCategories(subscription, now);
  }

  private static grantedCategories(
    subscription: { status: SubscriptionStatus; trialEndsAt: Date | null; plan: { categories: TrainingCategory[] } } | null,
    now: Date,
  ): TrainingCategory[] {
    if (!subscription || !GRANTING_STATUSES.includes(subscription.status)) return [];

    const trialExpired =
      subscription.status === SubscriptionStatus.TRIALING &&
      subscription.trialEndsAt != null &&
      subscription.trialEndsAt.getTime() <= now.getTime();
    if (trialExpired) return [];

    return subscription.plan.categories;
  }

  /** Dos alunos informados, os que enxergam a categoria — em 1–2 consultas, não uma por aluno. */
  async filterStudentsWithCategory(studentIds: string[], category: TrainingCategory, now: Date = new Date()): Promise<string[]> {
    if (studentIds.length === 0) return [];
    if (!(await this.isEnforced())) return studentIds;

    const subscriptions = await this.prisma.subscription.findMany({
      where: { studentId: { in: studentIds } },
      include: { plan: { select: { categories: true } } },
    });
    return subscriptions
      .filter(s => SubscriptionAccessService.grantedCategories(s, now).includes(category))
      .map(s => s.studentId);
  }

  /** Categorias que o aluno pode ver agora: todas quando o bloqueio está desligado, senão as da assinatura. */
  async getViewableCategories(studentId: string): Promise<TrainingCategory[]> {
    if (!(await this.isEnforced())) return Object.values(TrainingCategory);
    return this.getAccessibleCategories(studentId);
  }

  async canAccessCategory(studentId: string, category: TrainingCategory): Promise<boolean> {
    if (!(await this.isEnforced())) return true;
    return (await this.getAccessibleCategories(studentId)).includes(category);
  }

  async assertCanAccessCategory(studentId: string, category: TrainingCategory): Promise<void> {
    if (!(await this.canAccessCategory(studentId, category))) {
      throw new ForbiddenException('Seu plano não inclui esta categoria de treino.');
    }
  }
}
