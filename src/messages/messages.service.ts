import { Injectable, Inject, NotFoundException, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesGateway } from './messages.gateway';
import { ACTIVE_STUDENT } from '../common/student-scope';

const userSelect = { id: true, name: true, role: true };

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => MessagesGateway))
    private gateway: MessagesGateway,
  ) {}

  /** Retorna a conversa entre dois usuários, ordenada por data */
  async getConversation(userId: string, otherId: string) {
    await this.prisma.message.updateMany({
      where: { fromId: otherId, toId: userId, read: false },
      data: { read: true },
    });

    return this.prisma.message.findMany({
      where: {
        OR: [
          { fromId: userId, toId: otherId },
          { fromId: otherId, toId: userId },
        ],
      },
      orderBy: { createdAt: 'asc' },
      include: {
        from: { select: userSelect },
        to:   { select: userSelect },
      },
    });
  }

  /** Lista todas as conversas do usuário (última mensagem por interlocutor) */
  async getInbox(userId: string) {
    const messages = await this.prisma.message.findMany({
      where: { OR: [{ fromId: userId }, { toId: userId }] },
      orderBy: { createdAt: 'desc' },
      include: {
        from: { select: userSelect },
        to:   { select: userSelect },
      },
    });

    // Deduplica: uma entrada por interlocutor (última mensagem)
    const seen = new Set<string>();
    return messages.filter(m => {
      const otherId = m.fromId === userId ? m.toId : m.fromId;
      if (seen.has(otherId)) return false;
      seen.add(otherId);
      return true;
    });
  }

  /** Conta mensagens não lidas */
  async unreadCount(userId: string): Promise<number> {
    return this.prisma.message.count({ where: { toId: userId, read: false } });
  }

  async send(fromId: string, toId: string, content: string, isSystem = false) {
    // Conversa só entre o aluno e o coach dele, com vínculo ativo. Antes qualquer usuário escrevia para qualquer id
    // (e o coach seguia escrevendo — e o tempo real entregando — ao aluno que desvinculou ou excluiu a conta).
    const vinculo = await this.prisma.student.count({
      where: {
        ...ACTIVE_STUDENT,
        OR: [
          { userId: fromId, coachId: toId },
          { userId: toId, coachId: fromId },
        ],
      },
    });
    if (!vinculo) throw new NotFoundException('Destinatário não encontrado.');
    const message = await this.prisma.message.create({
      data: { fromId, toId, content, isSystem },
      include: {
        from: { select: userSelect },
        to:   { select: userSelect },
      },
    });
    // Emite em tempo real para o destinatário
    this.gateway.emitToUser(toId, message);
    return message;
  }
}
