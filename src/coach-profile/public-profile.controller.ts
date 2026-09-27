import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CoachProfileService } from './coach-profile.service';
import { CreateLeadDto } from './dto/coach-profile.dto';

/** Rotas públicas, sem autenticação — visitante nunca cria conta aqui, só vê a página e manda contato. */
@ApiTags('public-coach-profile')
@Controller('public/coaches')
export class PublicProfileController {
  constructor(private readonly service: CoachProfileService) {}

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
}
