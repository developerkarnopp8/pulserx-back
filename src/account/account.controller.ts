import { Body, Controller, HttpCode, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AllowPendingTerms } from '../auth/decorators/allow-pending-terms.decorator';
import { AllowUnlinked } from '../auth/decorators/allow-unlinked.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AccountService } from './account.service';
import { DeleteAccountDto } from './dto/account.dto';

@ApiTags('account')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('account')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  // Vale mesmo sem vínculo ativo e com termos pendentes: excluir a conta é direito do titular em qualquer situação.
  // Limite igual ao do login: a senha é conferida aqui.
  @Post('delete')
  @HttpCode(200)
  @Roles('athlete')
  @AllowUnlinked()
  @AllowPendingTerms()
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @ApiOperation({ summary: 'O aluno exclui (anonimiza) a própria conta, confirmando a senha' })
  deleteMine(@Body() dto: DeleteAccountDto, @Request() req: { user: { id: string } }) {
    return this.account.deleteMine(req.user.id, dto.password);
  }
}
