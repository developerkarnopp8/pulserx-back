import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SubscriptionPlansService } from './subscription-plans.service';
import { CreateSubscriptionPlanDto, UpdateSubscriptionPlanDto } from './dto/subscription.dto';

@ApiTags('subscription-plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('coach', 'admin')
@Controller('subscription-plans')
export class SubscriptionPlansController {
  constructor(private readonly service: SubscriptionPlansService) {}

  @Get()
  @ApiOperation({ summary: 'Catálogo de planos de assinatura do coach (admin informa ?coachId=)' })
  list(@Request() req: any, @Query('coachId') coachId?: string) {
    return this.service.list(req.user, coachId);
  }

  @Post()
  @ApiOperation({ summary: 'Cria plano de assinatura (admin informa ?coachId=)' })
  create(@Request() req: any, @Body() dto: CreateSubscriptionPlanDto, @Query('coachId') coachId?: string) {
    return this.service.create(req.user, dto, coachId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edita plano (preço, categorias, Free, ativo). Não há exclusão: desative.' })
  update(@Param('id') id: string, @Request() req: any, @Body() dto: UpdateSubscriptionPlanDto) {
    return this.service.update(id, req.user, dto);
  }
}
