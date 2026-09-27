import { Body, Controller, Delete, Get, Param, Put, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { AssignSubscriptionDto } from './dto/subscription.dto';

@ApiTags('subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class SubscriptionsController {
  constructor(private readonly service: SubscriptionsService) {}

  @Roles('athlete')
  @Get('subscriptions/me')
  @ApiOperation({ summary: 'Minha assinatura e as categorias que ela libera hoje' })
  getMine(@Request() req: any) {
    return this.service.getMine(req.user);
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
