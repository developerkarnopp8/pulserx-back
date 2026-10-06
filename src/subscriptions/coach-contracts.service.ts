import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentGateway } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isValidWalletId } from '../common/wallet-id';

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

  /**
   * O próprio coach lê a carteira que cadastrou (não o %, que é exclusivo do admin). `valid` diz se está no formato de um
   * Wallet ID do Asaas — carteiras salvas antes da validação podem não estar, e a tela precisa avisar.
   */
  async getWallet(coachId: string): Promise<{ walletId: string | null; valid: boolean }> {
    const contract = await this.prisma.coachContract.findUnique({ where: { coachId } });
    const walletId = contract?.gatewayAccountRef ?? null;
    return { walletId, valid: isValidWalletId(walletId) };
  }

  /** O próprio coach cadastra a carteira (walletId) do Asaas onde recebe o split — nunca o %. */
  async setWallet(coachId: string, walletId: string): Promise<{ walletId: string; valid: boolean }> {
    const contract = await this.prisma.coachContract.upsert({
      where: { coachId },
      create: { coachId, gatewayAccountRef: walletId, gateway: PaymentGateway.ASAAS },
      update: { gatewayAccountRef: walletId, gateway: PaymentGateway.ASAAS },
    });
    return { walletId: contract.gatewayAccountRef!, valid: isValidWalletId(contract.gatewayAccountRef) };
  }

  /**
   * Uso interno (checkout) — nunca exposto a controller sem checar antes se o coach tem carteira. Carteira fora do formato
   * conta como sem carteira: o Asaas recusaria a cobrança de qualquer jeito, e o aluno recebe a mensagem certa.
   */
  async getContractForCharge(coachId: string): Promise<{ walletId: string | null; platformFeePercent: number }> {
    const contract = await this.prisma.coachContract.findUnique({ where: { coachId } });
    const walletId = contract?.gatewayAccountRef ?? null;
    return {
      walletId: isValidWalletId(walletId) ? walletId : null,
      platformFeePercent: contract ? Number(contract.platformFeePercent) : 0,
    };
  }
}
