import { Controller, Get, Post, Patch, Put, Body, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { CreateCoachDto, ToggleCoachAiDto } from './dto/admin.dto';
import { CoachContractsService } from '../subscriptions/coach-contracts.service';
import { PlatformSettingsService } from '../subscriptions/platform-settings.service';
import { UpdateCoachContractDto, UpdatePlatformSettingsDto } from '../subscriptions/dto/subscription.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly service: AdminService,
    private readonly contracts: CoachContractsService,
    private readonly platformSettings: PlatformSettingsService,
  ) {}

  @Get('coaches')
  @ApiOperation({ summary: 'Lista todos os coaches' })
  listCoaches() {
    return this.service.listCoaches();
  }

  @Post('coaches')
  @ApiOperation({ summary: 'Cria conta de coach nova, com senha forte gerada na hora' })
  createCoach(@Body() dto: CreateCoachDto) {
    return this.service.createCoach(dto);
  }

  @Post('coaches/:id/reset-password')
  @ApiOperation({ summary: 'Gera senha nova pro coach' })
  resetPassword(@Param('id') id: string) {
    return this.service.resetCoachPassword(id);
  }

  @Patch('coaches/:id')
  @ApiOperation({ summary: 'Liga/desliga a importação de PDF via IA pro coach' })
  toggleAi(@Param('id') id: string, @Body() dto: ToggleCoachAiDto) {
    return this.service.toggleCoachAi(id, dto.aiImportEnabled);
  }

  @Get('coaches/:id/contract')
  @ApiOperation({ summary: 'Contrato do coach (% da plataforma) — só admin' })
  getContract(@Param('id') id: string) {
    return this.contracts.get(id);
  }

  @Put('coaches/:id/contract')
  @ApiOperation({ summary: 'Define a % da plataforma para o coach (por contrato) — só admin' })
  setContract(@Param('id') id: string, @Body() dto: UpdateCoachContractDto) {
    return this.contracts.setFee(id, dto.platformFeePercent);
  }

  @Get('platform-settings')
  @ApiOperation({ summary: 'Configurações da plataforma + quantos alunos ficariam sem acesso com o bloqueio ligado' })
  getPlatformSettings() {
    return this.platformSettings.get();
  }

  @Patch('platform-settings')
  @ApiOperation({ summary: 'Liga/desliga o bloqueio por assinatura (ligar com alunos sem plano exige confirmLockout)' })
  setPlatformSettings(@Body() dto: UpdatePlatformSettingsDto) {
    return this.platformSettings.setEnforcement(dto.enforceSubscriptionAccess, dto.confirmLockout ?? false);
  }
}
