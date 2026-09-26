import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_PLAN_TEMPLATES } from './default-plans';

@Injectable()
export class SubscriptionPlansService {
  constructor(private prisma: PrismaService) {}

  /** Cria Combo/Core/LPO/Free para o coach se ele ainda não tem nenhum plano. Idempotente. */
  async ensureDefaultPlans(coachId: string): Promise<{ created: number }> {
    const existing = await this.prisma.subscriptionPlan.count({ where: { coachId } });
    if (existing > 0) return { created: 0 };

    const { count } = await this.prisma.subscriptionPlan.createMany({
      data: DEFAULT_PLAN_TEMPLATES.map(t => ({ ...t, coachId })),
    });
    return { created: count };
  }
}
