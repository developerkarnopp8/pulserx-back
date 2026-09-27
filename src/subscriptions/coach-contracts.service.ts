import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Contrato do coach com a plataforma (% por cobrança). SÓ o admin lê/edita — o controller
 * é @Roles('admin') e nada aqui é devolvido a coach ou aluno. gateway/gatewayAccountRef
 * ficam para a Rodada 4 e nunca saem daqui.
 */
@Injectable()
export class CoachContractsService {
  constructor(private prisma: PrismaService) {}

  private async assertCoach(coachId: string) {
    const coach = await this.prisma.user.findUnique({ where: { id: coachId }, select: { role: true } });
    if (!coach || coach.role !== 'coach') throw new NotFoundException('Coach não encontrado');
  }

  /** Sem contrato cadastrado = 0% (Decimal vira string no JSON; devolvemos número). */
  async get(coachId: string): Promise<{ coachId: string; platformFeePercent: number }> {
    await this.assertCoach(coachId);
    const contract = await this.prisma.coachContract.findUnique({ where: { coachId } });
    return { coachId, platformFeePercent: contract ? Number(contract.platformFeePercent) : 0 };
  }

  async setFee(coachId: string, platformFeePercent: number): Promise<{ coachId: string; platformFeePercent: number }> {
    await this.assertCoach(coachId);
    const contract = await this.prisma.coachContract.upsert({
      where: { coachId },
      create: { coachId, platformFeePercent },
      update: { platformFeePercent },
    });
    return { coachId, platformFeePercent: Number(contract.platformFeePercent) };
  }
}
