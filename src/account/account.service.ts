import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

export const NOME_ANONIMO = 'Aluno removido';

/**
 * Exclusão da conta do aluno a pedido dele (LGPD Art. 18) — decisões do dono, 2026-09-30: pedida pelo próprio aluno
 * (no Perfil, com a senha) ou pelo admin (pedido por e-mail). A conta é ANONIMIZADA, não apagada: as cobranças pagas
 * ficam (obrigação fiscal), com o nome trocado; todo o resto que identifica ou é do aluno some.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private prisma: PrismaService,
    private subscriptions: SubscriptionsService,
  ) {}

  async deleteMine(userId: string, password: string): Promise<{ deleted: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Senha incorreta.');
    }
    return this.anonymize(userId, 'aluno');
  }

  /** Admin: acha o aluno pelo e-mail exato (sem busca parcial — não vira listagem de alunos). */
  async findAthleteByEmail(email: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email.trim(), mode: 'insensitive' }, role: 'athlete', deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        // inclui desvinculados: o admin precisa achar também quem o coach já desvinculou.
        student: { select: { unlinkedAt: true, coach: { select: { name: true } } } },
      },
    });
    if (!user) throw new NotFoundException('Nenhum aluno com este e-mail.');
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      coachName: user.student?.coach.name ?? null,
      unlinked: !!user.student?.unlinkedAt,
    };
  }

  async anonymize(userId: string, quem: 'aluno' | 'admin'): Promise<{ deleted: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        deletedAt: true,
        name: true,
        email: true,
        student: { select: { id: true, coachId: true, unlinkedAt: true } },
      },
    });
    if (!user || user.role !== 'athlete') throw new NotFoundException('Aluno não encontrado.');
    if (user.deletedAt) return { deleted: false };
    const student = user.student;

    // Cobrança primeiro: se o Asaas recusar o cancelamento, nada é apagado (nunca "conta excluída" ainda cobrando).
    if (student) await this.subscriptions.endSubscription(student.id);

    const agora = new Date();
    const feito = await this.prisma.$transaction(async (tx) => {
      // Marca antes de tudo, com trava otimista: dois pedidos ao mesmo tempo → só um executa.
      const { count } = await tx.user.updateMany({ where: { id: userId, deletedAt: null }, data: { deletedAt: agora } });
      if (count === 0) return false;

      // Treino, saúde e progresso do aluno.
      const doAluno = { where: { athleteId: userId } };
      await tx.workoutLog.deleteMany(doAluno);
      await tx.workoutSession.deleteMany(doAluno);
      await tx.workoutSkip.deleteMany(doAluno);
      await tx.hydrationLog.deleteMany(doAluno);
      await tx.calorieLog.deleteMany(doAluno);
      await tx.personalRecord.deleteMany(doAluno);
      await tx.movement.deleteMany(doAluno);

      // Conversas e notificações dele, e as do coach que carregam o nome, o e-mail ou o que ele escreveu.
      await tx.message.deleteMany({ where: { OR: [{ fromId: userId }, { toId: userId }] } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({
        where: {
          OR: [
            { type: 'new_message', title: `Nova mensagem de ${user.name}` },
            { type: 'subscription_canceled', body: { startsWith: `${user.name} cancelou` } },
            { type: 'new_student', body: { startsWith: `${user.name} se inscreveu` } },
            { type: 'new_lead', body: { contains: `(${user.email})` } },
            ...(student ? [{ link: `/coach/plan-builder/${student.id}` }] : []),
          ],
        },
      });
      // Contatos pela landing de qualquer coach, com o mesmo e-mail.
      await tx.lead.deleteMany({ where: { email: { equals: user.email, mode: 'insensitive' } } });

      if (student) {
        // Planos individuais (semanas/sessões/exercícios em cascata). Cobranças e assinatura FICAM (fiscal).
        await tx.trainingPlan.deleteMany({ where: { studentId: student.id } });
        await tx.student.update({
          where: { id: student.id },
          data: { cpf: null, asaasCustomerId: null, goal: null, unlinkedAt: student.unlinkedAt ?? agora },
        });
      }

      await tx.user.update({
        where: { id: userId },
        data: {
          name: NOME_ANONIMO,
          email: `removido-${userId}@anonimo.invalid`,
          // Senha que ninguém conhece: a conta não entra mais (e o token antigo é recusado pelo deletedAt).
          passwordHash: await bcrypt.hash(randomBytes(32).toString('hex'), 10),
          healthConsent: null,
          healthConsentAt: null,
        },
      });
      return true;
    }, { timeout: 15_000 });

    // Só o id (pseudônimo) e quem pediu — nunca nome/e-mail no log.
    if (feito) this.logger.log(`Conta de aluno anonimizada a pedido do ${quem}: ${userId}`);
    return { deleted: feito };
  }
}
