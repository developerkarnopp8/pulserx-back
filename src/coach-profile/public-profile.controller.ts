import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CoachProfileService } from './coach-profile.service';
import { PublicSignupService } from './public-signup.service';
import { CreateLeadDto } from './dto/coach-profile.dto';
import { PublicSignupDto } from './dto/public-signup.dto';

/**
 * Rotas públicas, sem autenticação: ver a página, mandar contato e se inscrever como aluno do
 * coach (a única forma pública de criar conta — sempre de aluno, sempre desse coach).
 */
@ApiTags('public-coach-profile')
@Controller('public/coaches')
export class PublicProfileController {
  constructor(
    private readonly service: CoachProfileService,
    private readonly signupService: PublicSignupService,
  ) {}

  @Get(':slug')
  @ApiOperation({ summary: 'Landing page pública do coach (banner, bio, planos)' })
  getPublic(@Param('slug') slug: string) {
    return this.service.getPublicBySlug(slug);
  }

  @Post(':slug/leads')
  @ApiOperation({ summary: 'Envia contato pela landing page — vira notificação + e-mail pro coach' })
  // Rota pública sem auth: cota própria, bem mais restrita que o limite geral, pra não virar canal de spam.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  createLead(@Param('slug') slug: string, @Body() dto: CreateLeadDto) {
    return this.service.createLead(slug, dto);
  }

  @Post(':slug/signup')
  @ApiOperation({ summary: 'Inscrição do visitante como aluno deste coach (sai logado, segue pro pagamento)' })
  // Cria conta: cota própria e apertada por IP (abuso de cadastro / sondagem de e-mail).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  signup(@Param('slug') slug: string, @Body() dto: PublicSignupDto) {
    return this.signupService.signup(slug, dto);
  }
}
