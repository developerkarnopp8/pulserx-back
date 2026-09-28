import {
  Body, Controller, Delete, Get, Param, Patch, Post, Put, Request, UseGuards, UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CoachProfileService } from './coach-profile.service';
import { imageUploadInterceptor, imageValidationPipe } from '../common/image-upload';
import { UpdateCoachProfileDto, PublishCoachProfileDto, UpsertTestimonialDto, UpsertFaqItemDto } from './dto/coach-profile.dto';


@ApiTags('coach-profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('coach')
@Controller('coach-profile')
export class CoachProfileController {
  constructor(private readonly service: CoachProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Meu perfil público (landing page) — null se ainda não configurado' })
  getMine(@Request() req: any) {
    return this.service.getMine(req.user.id);
  }

  @Put()
  @ApiOperation({ summary: 'Cria/edita o endereço (slug), bio e conteúdo do hero da landing page' })
  upsert(@Request() req: any, @Body() dto: UpdateCoachProfileDto) {
    return this.service.upsert(req.user.id, dto);
  }

  @Patch('publish')
  @ApiOperation({ summary: 'Liga/desliga a visibilidade pública da página' })
  publish(@Request() req: any, @Body() dto: PublishCoachProfileDto) {
    return this.service.setPublished(req.user.id, dto.published);
  }

  @Post('banner')
  @ApiOperation({ summary: 'Envia a foto de banner (hero) da landing page' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(imageUploadInterceptor)
  uploadBanner(@Request() req: any, @UploadedFile(imageValidationPipe) file: Express.Multer.File) {
    return this.service.uploadBanner(req.user.id, file.buffer);
  }

  @Post('photo')
  @ApiOperation({ summary: 'Envia a foto pessoal do coach (seção "Sobre o coach")' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(imageUploadInterceptor)
  uploadPhoto(@Request() req: any, @UploadedFile(imageValidationPipe) file: Express.Multer.File) {
    return this.service.uploadPhoto(req.user.id, file.buffer);
  }

  // ── Depoimentos ──────────────────────────────────────────────────────────

  @Get('testimonials')
  @ApiOperation({ summary: 'Lista os depoimentos cadastrados' })
  listTestimonials(@Request() req: any) {
    return this.service.listTestimonials(req.user.id);
  }

  @Post('testimonials')
  @ApiOperation({ summary: 'Cadastra um depoimento' })
  createTestimonial(@Request() req: any, @Body() dto: UpsertTestimonialDto) {
    return this.service.createTestimonial(req.user.id, dto);
  }

  @Patch('testimonials/:id')
  @ApiOperation({ summary: 'Edita um depoimento' })
  updateTestimonial(@Param('id') id: string, @Request() req: any, @Body() dto: UpsertTestimonialDto) {
    return this.service.updateTestimonial(id, req.user.id, dto);
  }

  @Delete('testimonials/:id')
  @ApiOperation({ summary: 'Remove um depoimento' })
  removeTestimonial(@Param('id') id: string, @Request() req: any) {
    return this.service.removeTestimonial(id, req.user.id);
  }

  // ── FAQ ──────────────────────────────────────────────────────────────────

  @Get('faq')
  @ApiOperation({ summary: 'Lista as perguntas frequentes cadastradas' })
  listFaqItems(@Request() req: any) {
    return this.service.listFaqItems(req.user.id);
  }

  @Post('faq')
  @ApiOperation({ summary: 'Cadastra uma pergunta frequente' })
  createFaqItem(@Request() req: any, @Body() dto: UpsertFaqItemDto) {
    return this.service.createFaqItem(req.user.id, dto);
  }

  @Patch('faq/:id')
  @ApiOperation({ summary: 'Edita uma pergunta frequente' })
  updateFaqItem(@Param('id') id: string, @Request() req: any, @Body() dto: UpsertFaqItemDto) {
    return this.service.updateFaqItem(id, req.user.id, dto);
  }

  @Delete('faq/:id')
  @ApiOperation({ summary: 'Remove uma pergunta frequente' })
  removeFaqItem(@Param('id') id: string, @Request() req: any) {
    return this.service.removeFaqItem(id, req.user.id);
  }
}
