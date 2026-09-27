import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessService } from './subscription-access.service';
import { AssignSubscriptionDto } from './dto/subscription.dto';

type AuthUser = { id: string; role: string };

const SUBSCRIPTION_VIEW = {
  id: true,
  studentId: true,
  status: true,
  startedAt: true,
  renewsAt: true,
  canceledAt: true,
  trialEndsAt: true,
  plan: { select: { id: true, name: true, priceCents: true, categories: true, isFree: true } },
} as const;

/**
 * Atribuição manual de plano ao aluno (Rodada 3). Sem gateway ainda: coach dono ou admin
 * decidem o plano e o status. Nunca expõe gateway/contrato.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private prisma: PrismaService,
    private access: SubscriptionAccessService,
  ) {}

  /** Coach dono do aluno, ou admin. O aluno consulta a própria assinatura por `getMine`. */
  private async assertCanManageStudent(studentId: string, user: AuthUser): Promise<{ id: string; coachId: string }> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, coachId: true },
    });
    if (!student) throw new NotFoundException('Aluno não encontrado');
    const isOwningCoach = user.role === 'coach' && student.coachId === user.id;
    if (!isOwningCoach && user.role !== 'admin') {
      throw new ForbiddenException('Você não tem acesso a este aluno.');
    }
    return student;
  }

  async getForStudent(studentId: string, user: AuthUser) {
    await this.assertCanManageStudent(studentId, user);
    return this.prisma.subscription.findUnique({ where: { studentId }, select: SUBSCRIPTION_VIEW });
  }

  /** O próprio aluno: a assinatura dele e o que ela libera hoje. */
  async getMine(user: AuthUser) {
    const student = await this.prisma.student.findFirst({ where: { userId: user.id }, select: { id: true } });
    if (!student) throw new NotFoundException('Perfil de aluno não encontrado para este usuário');
    const [subscription, categories] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { studentId: student.id }, select: SUBSCRIPTION_VIEW }),
      this.access.getViewableCategories(student.id),
    ]);
    return { subscription, categories };
  }

  async assign(studentId: string, user: AuthUser, dto: AssignSubscriptionDto) {
    const student = await this.assertCanManageStudent(studentId, user);

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.planId },
      select: { id: true, coachId: true, active: true },
    });
    // Plano de outro coach é tratado como inexistente (não confirma que existe).
    if (!plan || plan.coachId !== student.coachId) throw new NotFoundException('Plano não encontrado');

    const current = await this.prisma.subscription.findUnique({
      where: { studentId },
      select: { planId: true },
    });
    if (!plan.active && current?.planId !== plan.id) {
      throw new BadRequestException('Este plano está inativo — ative-o antes de atribuir a um aluno.');
    }

    const status = dto.status ?? SubscriptionStatus.ACTIVE;
    let trialEndsAt: Date | null = null;
    if (status === SubscriptionStatus.TRIALING) {
      trialEndsAt = dto.trialEndsAt ? new Date(dto.trialEndsAt) : null;
      if (!trialEndsAt || trialEndsAt.getTime() <= Date.now()) {
        throw new BadRequestException('Período de teste exige uma data de término no futuro.');
      }
    } else if (dto.trialEndsAt) {
      throw new BadRequestException('A data de fim do teste só vale para o status TRIALING.');
    }

    const data = {
      planId: plan.id,
      status,
      trialEndsAt,
      canceledAt: status === SubscriptionStatus.CANCELED ? new Date() : null,
    };
    return this.prisma.subscription.upsert({
      where: { studentId },
      create: { studentId, ...data },
      update: data,
      select: SUBSCRIPTION_VIEW,
    });
  }

  /** Remove a assinatura: o aluno volta a "sem plano". Idempotente. */
  async remove(studentId: string, user: AuthUser): Promise<{ removed: boolean }> {
    await this.assertCanManageStudent(studentId, user);
    const { count } = await this.prisma.subscription.deleteMany({ where: { studentId } });
    return { removed: count > 0 };
  }
}
