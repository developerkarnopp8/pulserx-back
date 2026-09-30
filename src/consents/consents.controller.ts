import { Body, Controller, Get, Patch, Put, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowPendingTerms } from '../auth/decorators/allow-pending-terms.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ConsentsService } from './consents.service';
import { AcceptConsentsDto, HealthConsentDto } from './dto/consents.dto';

/** Consentimentos do aluno (LGPD): termos na versão atual e dados de saúde (Art. 11). */
@ApiTags('consents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('consents')
export class ConsentsController {
  constructor(private readonly consents: ConsentsService) {}

  @Get('me')
  @Roles('athlete')
  @AllowPendingTerms()
  @ApiOperation({ summary: 'Situação dos consentimentos do aluno' })
  get(@Request() req: { user: { id: string } }) {
    return this.consents.get(req.user.id);
  }

  @Put('me')
  @Roles('athlete')
  @AllowPendingTerms()
  @ApiOperation({
    summary: 'Aceita os termos atuais e responde sobre dados de saúde; devolve um token novo',
  })
  accept(@Body() dto: AcceptConsentsDto, @Request() req: { user: { id: string } }) {
    return this.consents.accept(req.user.id, dto.healthConsent);
  }

  @Patch('me/health')
  @Roles('athlete')
  @ApiOperation({ summary: 'Dá ou retira o consentimento de dados de saúde' })
  setHealth(@Body() dto: HealthConsentDto, @Request() req: { user: { id: string } }) {
    return this.consents.setHealth(req.user.id, dto.healthConsent);
  }
}
