import { Body, Controller, Get, Put, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowPendingTerms } from '../auth/decorators/allow-pending-terms.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ConsentsService } from './consents.service';
import { AcceptCoachTermsDto } from './dto/coach-terms.dto';

/** Termo do Coach (LGPD): sigilo e uso dos dados dos alunos — aceito no próximo acesso ao painel. */
@ApiTags('coach-terms')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('coach')
@AllowPendingTerms()
@Controller('coach-terms')
export class CoachTermsController {
  constructor(private readonly consents: ConsentsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Versão atual do Termo do Coach e se este coach já aceitou' })
  get(@Request() req: { user: { id: string } }) {
    return this.consents.getCoachTerms(req.user.id);
  }

  @Put('me')
  @ApiOperation({ summary: 'Aceita o Termo do Coach na versão atual; devolve um token novo' })
  // O DTO só confere que o aceite foi marcado; quem aceita é sempre o coach do token.
  accept(@Body() _dto: AcceptCoachTermsDto, @Request() req: { user: { id: string } }) {
    return this.consents.acceptCoachTerms(req.user.id);
  }
}
