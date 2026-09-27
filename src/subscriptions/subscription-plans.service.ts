import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_PLAN_TEMPLATES } from './default-plans';
import { CreateSubscriptionPlanDto, UpdateSubscriptionPlanDto } from './dto/subscription.dto';

type AuthUser = { id: string; role: string };

@Injectable()
export class SubscriptionPlansService {
  constructor(private prisma: PrismaService) {}

  /**
   * Cria Combo/Core/LPO/Free para o coach se ele ainda não tem nenhum plano. Idempotente e seguro
   * contra duas requisições simultâneas no 1º acesso: o lock de aconselhamento do Postgres (por coach,
   * liberado no fim da transação) serializa o "conta + cria", senão os 4 planos nasceriam em dobro.
   */
  async ensureDefaultPlans(coachId: string): Promise<{ created: number }> {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${coachId}))`;
      const existing = await tx.subscriptionPlan.count({ where: { coachId } });
      if (existing > 0) return { created: 0 };

      const { count } = await tx.subscriptionPlan.createMany({
        data: DEFAULT_PLAN_TEMPLATES.map(t => ({ ...t, coachId })),
      });
      return { created: count };
    });
  }

  /**
   * Coach só age no próprio catálogo; admin age no de qualquer coach (informando `coachId`).
   * Devolve o coach dono do catálogo.
   */
  private async resolveCatalogCoach(user: AuthUser, coachId?: string): Promise<string> {
    if (user.role === 'coach') {
      if (coachId && coachId !== user.id) throw new ForbiddenException('Você não tem acesso a este catálogo.');
      return user.id;
    }
    if (user.role !== 'admin') throw new ForbiddenException('Você não tem acesso a este catálogo.');
    if (!coachId) throw new BadRequestException('Informe o coachId.');
    const coach = await this.prisma.user.findUnique({ where: { id: coachId }, select: { role: true } });
    if (!coach || coach.role !== 'coach') throw new NotFoundException('Coach não encontrado');
    return coachId;
  }

  /** Lista o catálogo; o primeiro acesso de um coach cria os 4 planos-modelo (sem backfill em migration). */
  async list(user: AuthUser, coachId?: string) {
    const owner = await this.resolveCatalogCoach(user, coachId);
    await this.ensureDefaultPlans(owner);
    return this.prisma.subscriptionPlan.findMany({
      where: { coachId: owner },
      orderBy: [{ isFree: 'desc' }, { priceCents: 'asc' }, { name: 'asc' }],
    });
  }

  async create(user: AuthUser, dto: CreateSubscriptionPlanDto, coachId?: string) {
    const owner = await this.resolveCatalogCoach(user, coachId);
    const isFree = dto.isFree ?? false;
    this.assertConsistent({ isFree, priceCents: dto.priceCents, categories: dto.categories });
    return this.prisma.subscriptionPlan.create({
      data: {
        coachId: owner,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        priceCents: dto.priceCents,
        categories: dto.categories,
        isFree,
        freeConfig: isFree && dto.freeConfig ? ({ ...dto.freeConfig } as Prisma.InputJsonObject) : undefined,
        active: dto.active ?? true,
      },
    });
  }

  async update(planId: string, user: AuthUser, dto: UpdateSubscriptionPlanDto) {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plano não encontrado');
    if (!(user.role === 'admin' || (user.role === 'coach' && plan.coachId === user.id))) {
      throw new ForbiddenException('Você não tem acesso a este plano.');
    }

    const isFree = dto.isFree ?? plan.isFree;
    const priceCents = dto.priceCents ?? plan.priceCents;
    const categories = dto.categories ?? plan.categories;
    this.assertConsistent({ isFree, priceCents, categories });

    return this.prisma.subscriptionPlan.update({
      where: { id: planId },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.description !== undefined && { description: dto.description.trim() || null }),
        priceCents,
        categories,
        isFree,
        ...(dto.freeConfig !== undefined && { freeConfig: { ...dto.freeConfig } as Prisma.InputJsonObject }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
    });
  }

  /** Free tem preço 0; plano pago precisa de preço e de pelo menos uma categoria. */
  private assertConsistent(p: { isFree: boolean; priceCents: number; categories: unknown[] }) {
    if (p.isFree && p.priceCents !== 0) {
      throw new BadRequestException('Plano gratuito não pode ter preço.');
    }
    if (!p.isFree && p.categories.length === 0) {
      throw new BadRequestException('Um plano pago precisa liberar ao menos uma categoria.');
    }
  }
}
