import { Body, Controller, HttpCode, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AllowPendingTerms } from './decorators/allow-pending-terms.decorator';
import { AllowUnlinked } from './decorators/allow-unlinked.decorator';
import { ChangePasswordDto } from './dto/password-reset.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PasswordChangeService } from './password-change.service';

@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('auth')
export class PasswordChangeController {
  constructor(private readonly passwordChange: PasswordChangeService) {}

  // Qualquer perfil, sempre pelo id do token. Trocar a própria senha é segurança da conta: vale com termos pendentes e
  // sem vínculo. Limite igual ao do login (a senha atual é conferida aqui).
  @Post('change-password')
  @HttpCode(200)
  @AllowPendingTerms()
  @AllowUnlinked()
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @ApiOperation({ summary: 'Troca a própria senha (confirma a atual); devolve sessão nova e derruba as outras' })
  change(@Body() dto: ChangePasswordDto, @Request() req: { user: { id: string } }) {
    return this.passwordChange.changePassword(req.user.id, dto.currentPassword, dto.newPassword);
  }
}
