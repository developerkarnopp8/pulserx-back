import {
  Body, Controller, Get, Patch, Post, Put, Request, UseGuards, UseInterceptors,
  UploadedFile, ParseFilePipeBuilder, HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CoachProfileService } from './coach-profile.service';
import { UpdateCoachProfileDto, PublishCoachProfileDto } from './dto/coach-profile.dto';

const MAX_BANNER_SIZE_BYTES = 5 * 1024 * 1024; // 5MB — banner é imagem de tela, não precisa de mais

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
  @ApiOperation({ summary: 'Cria/edita o endereço (slug) e a bio da landing page' })
  upsert(@Request() req: any, @Body() dto: UpdateCoachProfileDto) {
    return this.service.upsert(req.user.id, dto);
  }

  @Patch('publish')
  @ApiOperation({ summary: 'Liga/desliga a visibilidade pública da página' })
  publish(@Request() req: any, @Body() dto: PublishCoachProfileDto) {
    return this.service.setPublished(req.user.id, dto.published);
  }

  @Post('banner')
  @ApiOperation({ summary: 'Envia a foto de banner da landing page' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BANNER_SIZE_BYTES, files: 1 } }))
  uploadBanner(
    @Request() req: any,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ })
        .addMaxSizeValidator({ maxSize: MAX_BANNER_SIZE_BYTES })
        .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }),
    )
    file: Express.Multer.File,
  ) {
    return this.service.uploadBanner(req.user.id, file.buffer);
  }
}
