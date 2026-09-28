import { Body, Controller, Delete, Get, Param, Put, Request, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { CoachContractsService } from './coach-contracts.service';
import { AssignSubscriptionDto, CheckoutSubscriptionDto, SetCoachWalletDto } from './dto/subscription.dto';

@ApiTags('subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class SubscriptionsController {
  constructor(
    private readonly service: SubscriptionsService,
    private readonly coachContracts: CoachContractsService,
  ) {}

  @Roles('athlete')
  @Get('subscriptions/me')
  @ApiOperation({ summary: 'Minha assinatura e as categorias que ela libera hoje' })
  getMine(@Request() req: any) {
    return this.service.getMine(req.user);
  }

  @Roles('athlete')
  @Get('subscriptions/me/payments')
  @ApiOperation({ summary: 'Histórico real das próprias cobranças (Asaas)' })
  listMyPayments(@Request() req: any) {
    return this.service.listMyPayments(req.user);
  }

  // Limite próprio, mais apertado que o geral da API (30/min): cada chamada aqui pode disparar
  // requisições reais pro gateway (Asaas) — cria cliente/assinatura de verdade e tem custo/cota.
  // Reduz também a janela de exploração de retries acidentais duplicando assinatura no gateway.
  @Roles('athlete')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Put('subscriptions/checkout')
  @ApiOperation({ summary: 'Assina um plano do próprio coach — gratuito é direto, pago passa pelo gateway (Asaas)' })
  checkout(@Request() req: any, @Body() dto: CheckoutSubscriptionDto) {
    return this.service.checkout(req.user, dto);
  }

  @Roles('coach')
  @Get('subscriptions/wallet')
  @ApiOperation({ summary: 'Carteira Asaas cadastrada pelo próprio coach (onde recebe o split das cobranças)' })
  getWallet(@Request() req: any) {
    return this.coachContracts.getWallet(req.user.id);
  }

  @Roles('coach')
  @Put('subscriptions/wallet')
  @ApiOperation({ summary: 'Cadastra/atualiza a carteira Asaas do próprio coach' })
  setWallet(@Request() req: any, @Body() dto: SetCoachWalletDto) {
    return this.coachContracts.setWallet(req.user.id, dto.walletId);
  }

  @Roles('coach')
  @Get('subscriptions/gateway-payments')
  @ApiOperation({ summary: 'Histórico real de cobranças do gateway (Asaas) dos alunos do próprio coach' })
  listGatewayPayments(@Request() req: any) {
    return this.service.listGatewayPayments(req.user.id);
  }

  @Roles('coach')
  @Get('subscriptions/financial-summary')
  @ApiOperation({ summary: 'MRR/receita por plano, inadimplência e churn/LTV projetado — tudo real, do próprio coach' })
  getFinancialSummary(@Request() req: any) {
    return this.service.getFinancialSummary(req.user.id);
  }

  @Roles('athlete')
  @Delete('subscriptions/me')
  @ApiOperation({ summary: 'Cancela a própria assinatura (mantém histórico, notifica o coach)' })
  cancelMine(@Request() req: any) {
    return this.service.cancelMine(req.user);
  }

  @Roles('coach', 'admin')
  @Get('students/:studentId/subscription')
  @ApiOperation({ summary: 'Assinatura de um aluno (coach dono ou admin)' })
  getForStudent(@Param('studentId') studentId: string, @Request() req: any) {
    return this.service.getForStudent(studentId, req.user);
  }

  @Roles('coach', 'admin')
  @Put('students/:studentId/subscription')
  @ApiOperation({ summary: 'Atribui/troca o plano do aluno (upgrade/downgrade, status, teste)' })
  assign(@Param('studentId') studentId: string, @Request() req: any, @Body() dto: AssignSubscriptionDto) {
    return this.service.assign(studentId, req.user, dto);
  }

  @Roles('coach', 'admin')
  @Delete('students/:studentId/subscription')
  @ApiOperation({ summary: 'Remove a assinatura do aluno (volta a "sem plano")' })
  remove(@Param('studentId') studentId: string, @Request() req: any) {
    return this.service.remove(studentId, req.user);
  }
}
