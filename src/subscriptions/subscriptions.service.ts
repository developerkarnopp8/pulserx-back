import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentGateway, SubscriptionStatus } from '@prisma/client';
import { paymentBreakdown, sumBreakdowns } from './payment-breakdown';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessService } from './subscription-access.service';
import { CoachContractsService } from './coach-contracts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AsaasService, SavedCard } from '../common/asaas.service';
import { ACTIVE_STUDENT } from '../common/student-scope';
import { isValidCpf, onlyCpfDigits } from '../common/cpf';
import { AssignSubscriptionDto, CheckoutSubscriptionDto } from './dto/subscription.dto';

type AuthUser = { id: string; role: string };

/** Memória do cartão do débito automático (ver `cardOf`). */
const CARD_CACHE_TTL_MS = 10 * 60 * 1000;
const CARD_CACHE_MAX = 1000;

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
  private readonly cardCache = new Map<string, { card: SavedCard | null; expira: number }>();

  constructor(
    private prisma: PrismaService,
    private access: SubscriptionAccessService,
    private notifications: NotificationsService,
    private coachContracts: CoachContractsService,
    private asaas: AsaasService,
  ) {}

  /** Coach dono do aluno, ou admin. O aluno consulta a própria assinatura por `getMine`. */
  private async assertCanManageStudent(studentId: string, user: AuthUser): Promise<{ id: string; coachId: string }> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId, ...ACTIVE_STUDENT },
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

  /**
   * O próprio aluno: a assinatura dele, o que ela libera hoje e, se paga no cartão, em qual cartão é o débito automático
   * (só bandeira e final, consultados no Asaas na hora — o PulseRx não guarda dado de cartão).
   */
  async getMine(user: AuthUser) {
    const student = await this.prisma.student.findFirst({ where: { userId: user.id, ...ACTIVE_STUDENT }, select: { id: true } });
    if (!student) throw new NotFoundException('Perfil de aluno não encontrado para este usuário');
    const [row, categories] = await Promise.all([
      this.prisma.subscription.findUnique({
        where: { studentId: student.id },
        select: { ...SUBSCRIPTION_VIEW, gatewaySubscriptionId: true },
      }),
      this.access.getViewableCategories(student.id),
    ]);
    if (!row) return { subscription: null, categories, autoDebitCard: null };
    // O id da assinatura no Asaas nunca vai para a resposta.
    const { gatewaySubscriptionId, ...subscription } = row;
    const ativa = gatewaySubscriptionId && subscription.status !== SubscriptionStatus.CANCELED;
    // Falhou ou demorou no Asaas: a tela abre sem a linha do cartão (nunca derruba a tela da assinatura).
    const autoDebitCard = ativa ? await this.cardOf(gatewaySubscriptionId) : null;
    return { subscription, categories, autoDebitCard };
  }

  /**
   * Cartão do débito automático com memória de 10 min por assinatura: abrir a tela várias vezes não vira várias consultas
   * ao Asaas (cota da conta da plataforma). Falha não é guardada — a próxima abertura tenta de novo.
   */
  private async cardOf(gatewaySubscriptionId: string): Promise<SavedCard | null> {
    const agora = Date.now();
    const guardado = this.cardCache.get(gatewaySubscriptionId);
    if (guardado && guardado.expira > agora) return guardado.card;
    try {
      const card = await this.asaas.getSubscriptionCard(gatewaySubscriptionId);
      if (this.cardCache.size >= CARD_CACHE_MAX) this.cardCache.clear();
      this.cardCache.set(gatewaySubscriptionId, { card, expira: agora + CARD_CACHE_TTL_MS });
      return card;
    } catch {
      return null;
    }
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
      select: { planId: true, status: true, gatewaySubscriptionId: true },
    });
    // Aluno que paga pelo app: trocar o plano "à mão" deixaria o Asaas cobrando o plano antigo.
    if (current?.gatewaySubscriptionId && current.status !== SubscriptionStatus.CANCELED) {
      throw new ConflictException(
        'Este aluno paga pelo app. Para mudar o plano à mão, remova a assinatura antes — isso cancela a cobrança no Asaas.',
      );
    }
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
      // Atribuição manual não tem gateway (a cobrança antiga, se houve, já está cancelada no Asaas).
      gateway: null,
      gatewaySubscriptionId: null,
    };
    return this.prisma.subscription.upsert({
      where: { studentId },
      create: { studentId, ...data },
      update: data,
      select: SUBSCRIPTION_VIEW,
    });
  }

  /**
   * Remove a assinatura: o aluno volta a "sem plano". Idempotente. Se o aluno paga (ou já pagou) pelo app, a
   * assinatura é ENCERRADA em vez de apagada — cancela no Asaas e mantém as cobranças (histórico fiscal).
   */
  async remove(studentId: string, user: AuthUser): Promise<{ removed: boolean }> {
    await this.assertCanManageStudent(studentId, user);
    const current = await this.prisma.subscription.findUnique({
      where: { studentId },
      select: { gatewaySubscriptionId: true, _count: { select: { gatewayPayments: true } } },
    });
    if (current && (current.gatewaySubscriptionId || current._count.gatewayPayments > 0)) {
      return { removed: await this.endSubscription(studentId) };
    }
    const { count } = await this.prisma.subscription.deleteMany({ where: { studentId } });
    return { removed: count > 0 };
  }

  /**
   * Encerra a cobrança recorrente do aluno (coach removendo a assinatura, desvincular, excluir a conta): cancela no
   * Asaas ANTES — se o Asaas recusar, nada muda aqui (nunca fica "cancelada" com o gateway ainda cobrando) — e marca
   * CANCELED, mantendo o registro e as cobranças já feitas (histórico fiscal). Mesma trava por aluno do checkout.
   * Devolve se havia algo a encerrar.
   */
  async endSubscription(studentId: string): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${studentId}))`;
      const current = await tx.subscription.findUnique({
        where: { studentId },
        select: { status: true, gatewaySubscriptionId: true },
      });
      if (!current || current.status === SubscriptionStatus.CANCELED) return false;
      if (current.gatewaySubscriptionId) await this.asaas.cancelSubscription(current.gatewaySubscriptionId);
      await tx.subscription.update({
        where: { studentId },
        data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date() },
      });
      return true;
    }, { timeout: 15_000 });
  }

  /** O próprio aluno cancela a própria assinatura (fica CANCELED, não some — mantém histórico) e o coach é notificado. */
  async cancelMine(user: AuthUser) {
    const student = await this.prisma.student.findFirst({
      where: { userId: user.id, ...ACTIVE_STUDENT },
      select: { id: true, coachId: true, user: { select: { name: true } } },
    });
    if (!student) throw new NotFoundException('Perfil de aluno não encontrado para este usuário');

    const subscription = await this.prisma.subscription.findUnique({
      where: { studentId: student.id },
      select: { ...SUBSCRIPTION_VIEW, gatewaySubscriptionId: true },
    });
    if (!subscription) throw new NotFoundException('Você não tem uma assinatura ativa.');
    if (subscription.status === SubscriptionStatus.CANCELED) {
      const { gatewaySubscriptionId: _omit, ...view } = subscription;
      return view;
    }

    // Cancela no gateway ANTES de mudar o status local — se o Asaas rejeitar, a assinatura
    // continua ACTIVE aqui (não fica "cancelada" pro aluno enquanto o gateway ainda cobra).
    if (subscription.gatewaySubscriptionId) {
      await this.asaas.cancelSubscription(subscription.gatewaySubscriptionId);
    }

    const updated = await this.prisma.subscription.update({
      where: { studentId: student.id },
      data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date() },
      select: SUBSCRIPTION_VIEW,
    });

    await this.notifications.create(
      student.coachId,
      'subscription_canceled',
      'Assinatura cancelada',
      `${student.user.name} cancelou a própria assinatura.`,
      `/coach/students`,
    );

    return updated;
  }

  /**
   * O próprio aluno assina um plano do coach dele. Plano Free/gratuito é atribuído direto
   * (sem gateway); plano pago exige o coach já ter cadastrado a carteira Asaas e cria a
   * assinatura recorrente na Asaas com split automático pro coach.
   *
   * Lock de aconselhamento do Postgres por aluno (mesmo padrão de `ensureDefaultPlans`) serializa
   * reexecuções (duplo clique, retry, duas abas): sem ele, duas chamadas concorrentes releriam o
   * mesmo `gatewaySubscriptionId` antigo e criariam DUAS assinaturas no Asaas, e o upsert local
   * (studentId único) sobrescreveria uma pela outra — a outra ficaria órfã cobrando pra sempre,
   * sem aparecer em nenhuma tela nem ter como ser cancelada pelo app.
   */
  async checkout(user: AuthUser, dto: CheckoutSubscriptionDto) {
    const student = await this.prisma.student.findFirst({
      where: { userId: user.id, ...ACTIVE_STUDENT },
      select: { id: true, coachId: true, cpf: true, asaasCustomerId: true, user: { select: { name: true, email: true } } },
    });
    if (!student) throw new NotFoundException('Perfil de aluno não encontrado para este usuário');

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.planId },
      select: { id: true, coachId: true, active: true, isFree: true, priceCents: true },
    });
    if (!plan || plan.coachId !== student.coachId || !plan.active) {
      throw new NotFoundException('Plano não encontrado');
    }

    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${student.id}))`;

      const current = await tx.subscription.findUnique({
        where: { studentId: student.id },
        select: { gatewaySubscriptionId: true, status: true },
      });
      // Cancela a assinatura anterior no Asaas ANTES de criar/trocar — nunca deixa uma cobrança
      // recorrente órfã rodando por trás (troca de plano, retry, ou downgrade pro Free). Se o
      // cancelamento falhar, o checkout inteiro falha (fail-closed) em vez de arriscar duplicar cobrança.
      // Já cancelada (pelo aluno, pelo coach ou ao desvincular): não pede ao Asaas para cancelar de novo.
      if (current?.gatewaySubscriptionId && current.status !== SubscriptionStatus.CANCELED) {
        await this.asaas.cancelSubscription(current.gatewaySubscriptionId);
      }

      if (plan.isFree || plan.priceCents === 0) {
        const subscription = await tx.subscription.upsert({
          where: { studentId: student.id },
          create: { studentId: student.id, planId: plan.id, status: SubscriptionStatus.ACTIVE },
          update: {
            planId: plan.id, status: SubscriptionStatus.ACTIVE, canceledAt: null,
            gateway: null, gatewaySubscriptionId: null, platformFeePercent: null,
          },
          select: SUBSCRIPTION_VIEW,
        });
        return { subscription, checkoutUrl: null };
      }

      const contract = await this.coachContracts.getContractForCharge(student.coachId);
      if (!contract.walletId) {
        throw new BadRequestException('Este treinador ainda não configurou o recebimento de pagamentos. Fale com ele antes de assinar.');
      }

      let cpfDigits = student.cpf;
      if (!cpfDigits) {
        if (!dto.cpf || !isValidCpf(dto.cpf)) {
          throw new BadRequestException('Informe um CPF válido para assinar um plano pago.');
        }
        cpfDigits = onlyCpfDigits(dto.cpf);
        await tx.student.update({ where: { id: student.id }, data: { cpf: cpfDigits } });
      }

      let asaasCustomerId = student.asaasCustomerId;
      if (!asaasCustomerId) {
        const customer = await this.asaas.createCustomer(student.user.name, student.user.email, cpfDigits);
        asaasCustomerId = customer.id;
        await tx.student.update({ where: { id: student.id }, data: { asaasCustomerId } });
      }

      const asaasSubscription = await this.asaas.createSubscription({
        customerId: asaasCustomerId,
        valueCents: plan.priceCents,
        walletId: contract.walletId,
        coachPercent: 100 - contract.platformFeePercent,
        externalReference: student.id,
      });

      const subscription = await tx.subscription.upsert({
        where: { studentId: student.id },
        create: {
          studentId: student.id, planId: plan.id, status: SubscriptionStatus.PAST_DUE,
          gateway: PaymentGateway.ASAAS, gatewaySubscriptionId: asaasSubscription.id,
          platformFeePercent: contract.platformFeePercent,
        },
        update: {
          planId: plan.id, status: SubscriptionStatus.PAST_DUE, canceledAt: null,
          gateway: PaymentGateway.ASAAS, gatewaySubscriptionId: asaasSubscription.id,
          platformFeePercent: contract.platformFeePercent,
        },
        select: SUBSCRIPTION_VIEW,
      });

      const localSubscription = await tx.subscription.findUniqueOrThrow({ where: { studentId: student.id }, select: { id: true } });
      const payments = await this.asaas.listPaymentsBySubscription(asaasSubscription.id);
      const firstPayment = payments[0];
      if (firstPayment) {
        await tx.gatewayPayment.upsert({
          where: { asaasPaymentId: firstPayment.id },
          create: {
            subscriptionId: localSubscription.id, asaasPaymentId: firstPayment.id,
            amount: firstPayment.value, netValue: firstPayment.netValue ?? null,
            dueDate: new Date(firstPayment.dueDate), invoiceUrl: firstPayment.invoiceUrl,
          },
          update: { invoiceUrl: firstPayment.invoiceUrl, netValue: firstPayment.netValue ?? null },
        });
      }

      return { subscription, checkoutUrl: firstPayment?.invoiceUrl ?? null };
    }, { timeout: 15_000 });
  }

  /**
   * Resumo financeiro real do coach — MRR/receita por plano, inadimplência e churn/LTV
   * projetado. Tudo calculado a partir de `Subscription` (status/startedAt/canceledAt) e
   * `SubscriptionPlan.priceCents`, sem nenhum dado inventado — não existe billing history
   * tabular (snapshot mês a mês), então churn e LTV são aproximações honestas explicadas
   * nos comentários abaixo, não um cálculo contábil oficial.
   */
  async getFinancialSummary(coachId: string) {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { student: { coachId } },
      select: {
        status: true,
        startedAt: true,
        canceledAt: true,
        plan: { select: { id: true, name: true, priceCents: true } },
      },
    });

    const active = subscriptions.filter(s => s.status === 'ACTIVE' || s.status === 'TRIALING');
    const pastDue = subscriptions.filter(s => s.status === 'PAST_DUE');

    // MRR e receita por plano: soma do preço de cada assinatura ativa/em teste, agrupada por plano.
    const byPlan = new Map<string, { planId: string; planName: string; priceCents: number; activeCount: number; mrrCents: number }>();
    for (const s of active) {
      const entry = byPlan.get(s.plan.id) ?? { planId: s.plan.id, planName: s.plan.name, priceCents: s.plan.priceCents, activeCount: 0, mrrCents: 0 };
      entry.activeCount++;
      entry.mrrCents += s.plan.priceCents;
      byPlan.set(s.plan.id, entry);
    }
    const revenueByPlan = Array.from(byPlan.values()).sort((a, b) => b.mrrCents - a.mrrCents);
    const mrrCents = revenueByPlan.reduce((sum, p) => sum + p.mrrCents, 0);

    // Inadimplência: % de quem tem assinatura e está PAST_DUE agora.
    const pastDueRatePercent = subscriptions.length > 0 ? Math.round((pastDue.length / subscriptions.length) * 10_000) / 100 : 0;

    // Churn mensal (aproximação): cancelados dentro do mês corrente ÷ quem já estava com
    // assinatura antes do mês começar e ainda não tinha cancelado até lá. Sem uma tabela de
    // snapshots mensais reais, essa é a melhor aproximação honesta com o dado disponível.
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const canceledThisMonth = subscriptions.filter(
      s => s.canceledAt && s.canceledAt >= startOfMonth && s.canceledAt < startOfNextMonth,
    ).length;
    const activeAtStartOfMonth = subscriptions.filter(
      s => s.startedAt < startOfMonth && (!s.canceledAt || s.canceledAt >= startOfMonth),
    ).length;
    const churnRatePercent = activeAtStartOfMonth > 0
      ? Math.round((canceledThisMonth / activeAtStartOfMonth) * 10_000) / 100
      : 0;

    // LTV projetado = ticket médio mensal ÷ taxa de churn mensal (fórmula padrão de SaaS).
    // Sem cancelamento nenhum no mês, a taxa de churn é 0 e a divisão não faz sentido — null
    // em vez de "infinito" ou um número fictício.
    const arpuCents = active.length > 0 ? Math.round(mrrCents / active.length) : 0;
    const ltvProjectedCents = churnRatePercent > 0 ? Math.round(arpuCents / (churnRatePercent / 100)) : null;

    return {
      mrrCents,
      revenueByPlan,
      totalActive: active.length,
      totalPastDue: pastDue.length,
      pastDueRatePercent,
      churn: { canceledThisMonth, activeAtStartOfMonth, ratePercent: churnRatePercent },
      arpuCents,
      ltvProjectedCents,
    };
  }

  /**
   * Histórico real de cobranças do gateway (Asaas) dos alunos deste coach — pra tela de
   * governança/repasses. Nunca inclui gatewaySubscriptionId nem qualquer campo do CoachContract
   * (walletId/%), só o que já é seguro mostrar (o próprio coach vendo as cobranças dos alunos dele).
   */
  async listGatewayPayments(coachId: string) {
    const payments = await this.prisma.gatewayPayment.findMany({
      where: { subscription: { student: { coachId } } },
      select: {
        id: true,
        asaasPaymentId: true,
        status: true,
        amount: true,
        netValue: true,
        dueDate: true,
        paidAt: true,
        invoiceUrl: true,
        createdAt: true,
        subscription: {
          select: {
            platformFeePercent: true,
            student: { select: { id: true, user: { select: { name: true } } } },
            plan: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    // Divisão real (Asaas → plataforma → coach) de cada cobrança; o % é o gravado na assinatura.
    return payments.map(({ netValue, subscription: { platformFeePercent, ...subscription }, ...p }) => ({
      ...p,
      subscription,
      breakdown: paymentBreakdown(p.amount, netValue, platformFeePercent),
    }));
  }

  /**
   * Totais do mês corrente das cobranças PAGAS dos alunos do coach (bruto, taxa do Asaas,
   * plataforma e líquido do coach) + o % atual do contrato. Decisão do dono (2026-09-28): o coach
   * vê o % da plataforma e a taxa do gateway pra ter controle do que recebe.
   */
  async getMonthlyBreakdown(coachId: string) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const [paid, contract] = await Promise.all([
      this.prisma.gatewayPayment.findMany({
        where: { status: 'paid', paidAt: { gte: start, lt: end }, subscription: { student: { coachId } } },
        select: { amount: true, netValue: true, subscription: { select: { platformFeePercent: true } } },
      }),
      this.prisma.coachContract.findUnique({ where: { coachId }, select: { platformFeePercent: true } }),
    ]);
    return {
      // null = o admin ainda não definiu o contrato (diferente de 0% combinado) — a tela avisa.
      currentPlatformFeePercent: contract ? Number(contract.platformFeePercent) : null,
      month: sumBreakdowns(paid.map(p => paymentBreakdown(p.amount, p.netValue, p.subscription.platformFeePercent))),
    };
  }

  /**
   * Histórico real de cobranças (Asaas) do PRÓPRIO aluno logado — pra tela "Minha Assinatura".
   * Sempre resolve o studentId a partir do userId do token (nunca aceita um id vindo do body/URL).
   */
  async listMyPayments(user: AuthUser) {
    const student = await this.prisma.student.findFirst({ where: { userId: user.id, ...ACTIVE_STUDENT }, select: { id: true } });
    if (!student) throw new NotFoundException('Perfil de aluno não encontrado para este usuário');

    return this.prisma.gatewayPayment.findMany({
      where: { subscription: { studentId: student.id } },
      select: {
        id: true,
        status: true,
        amount: true,
        dueDate: true,
        paidAt: true,
        invoiceUrl: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
