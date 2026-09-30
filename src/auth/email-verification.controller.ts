import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ForgotPasswordDto, VerifyEmailDto } from './dto/password-reset.dto';
import { EmailVerificationService } from './email-verification.service';

/** Rotas públicas da confirmação de e-mail (sem login), com limite próprio por IP. */
@ApiTags('auth')
@Controller('auth')
export class EmailVerificationController {
  constructor(private readonly verification: EmailVerificationService) {}

  @Post('verify-email')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @ApiOperation({ summary: 'Confirma o e-mail pelo link recebido (uso único, 48 horas), cria a senha e abre a sessão' })
  verify(@Body() dto: VerifyEmailDto) {
    return this.verification.verify(dto.token, dto.password);
  }

  @Post('resend-verification')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 900_000 } })
  @ApiOperation({ summary: 'Reenvia o e-mail de confirmação (resposta igual exista a conta ou não)' })
  async resend(@Body() dto: ForgotPasswordDto) {
    await this.verification.resend(dto.email);
    return { message: 'Se houver uma conta esperando confirmação com esse e-mail, enviamos um novo link.' };
  }
}
