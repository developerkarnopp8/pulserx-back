import { ForbiddenException, Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma, SubscriptionStatus, TrainingCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Status que dão acesso ao conteúdo sem condição. PAST_DUE dá acesso só durante a tolerância (abaixo) e CANCELED nunca.
 */
export const GRANTING_STATUSES: SubscriptionStatus[] = [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING];

/** Decisão do dono (2026-10-01): inadimplente continua vendo os treinos até 5 dias depois do vencimento da fatura mais antiga em aberto. */
export const PAST_DUE_GRACE_DAYS = 5;
const DIA_MS = 24 * 60 * 60 * 1000;
/** Decisão do dono (2026-10-01): o Free é uma amostra — vê só a 1ª semana dos planos das categorias que ele libera. */
export const FREE_SAMPLE_WEEKS = 1;

/** O que a regra precisa da assinatura: status, fim do teste, categorias do plano e as cobranças vencidas/contestadas. */
export const ACCESS_INCLUDE = Prisma.validator<Prisma.SubscriptionInclude>()({
  plan: { select: { categories: true, isFree: true } },
  gatewayPayments: {
    where: { status: { in: [PaymentStatus.overdue, PaymentStatus.chargeback] } },
    select: { status: true, dueDate: true },
  },
});

export interface AccessSubscription {
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  plan: { categories: TrainingCategory[]; isFree?: boolean };
  gatewayPayments?: { status: PaymentStatus; dueDate: Date }[];
}

export interface AccessState {
  categories: TrainingCategory[];
  /** Inadimplente ainda dentro da tolerância: até quando continua vendo os treinos. */
  graceUntil: Date | null;
  /** Há cobrança contestada no cartão: sem acesso até a contestação ser resolvida (decisão do dono, 2026-10-01). */
  chargeback: boolean;
  /** Plano Free (amostra): até qual semana dos planos liberados o aluno vê. null = sem limite. */
  sampleWeeks: number | null;
}

/** Regra única de acesso pela assinatura (fonte de verdade para o app e para a contagem do admin). */
export function accessState(sub: AccessSubscription | null, now: Date): AccessState {
  const nada: AccessState = { categories: [], graceUntil: null, chargeback: false, sampleWeeks: null };
  const libera = (graceUntil: Date | null = null): AccessState => ({
    categories: sub!.plan.categories,
    graceUntil,
    chargeback: false,
    sampleWeeks: sub!.plan.isFree ? FREE_SAMPLE_WEEKS : null,
  });
  if (!sub) return nada;
  const payments = sub.gatewayPayments ?? [];
  if (payments.some(p => p.status === PaymentStatus.chargeback)) return { ...nada, chargeback: true };

  if (sub.status === SubscriptionStatus.ACTIVE) return libera();
  if (sub.status === SubscriptionStatus.TRIALING) {
    const vencido = sub.trialEndsAt != null && sub.trialEndsAt.getTime() <= now.getTime();
    return vencido ? nada : libera();
  }
  if (sub.status === SubscriptionStatus.PAST_DUE) {
    const vencidas = payments.filter(p => p.status === PaymentStatus.overdue).map(p => p.dueDate.getTime());
    // PAST_DUE posto à mão pelo coach (sem fatura vencida no Asaas): decisão dele, sem tolerância.
    if (!vencidas.length) return nada;
    const ate = new Date(Math.min(...vencidas) + PAST_DUE_GRACE_DAYS * DIA_MS);
    return ate.getTime() > now.getTime() ? libera(ate) : nada;
  }
  return nada;
}

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
    return (await this.getAccessState(studentId, now)).categories;
  }

  /** Estado completo (categorias, tolerância, contestação) — a tela do aluno usa para avisar. */
  async getAccessState(studentId: string, now: Date = new Date()): Promise<AccessState> {
    const subscription = await this.prisma.subscription.findUnique({ where: { studentId }, include: ACCESS_INCLUDE });
    return accessState(subscription, now);
  }

  /** Até qual semana o aluno vê os planos (Free = amostra). null = sem limite, inclusive com o bloqueio desligado. */
  async weekLimit(studentId: string): Promise<number | null> {
    if (!(await this.isEnforced())) return null;
    return (await this.getAccessState(studentId)).sampleWeeks;
  }

  /** Dos alunos informados, os que enxergam a categoria — em 1–2 consultas, não uma por aluno. */
  async filterStudentsWithCategory(studentIds: string[], category: TrainingCategory, now: Date = new Date()): Promise<string[]> {
    if (studentIds.length === 0) return [];
    if (!(await this.isEnforced())) return studentIds;

    const subscriptions = await this.prisma.subscription.findMany({
      where: { studentId: { in: studentIds } },
      include: ACCESS_INCLUDE,
    });
    return subscriptions
      .filter(s => accessState(s, now).categories.includes(category))
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
