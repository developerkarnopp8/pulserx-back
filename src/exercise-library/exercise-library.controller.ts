import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Request, UseGuards, UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExerciseLibraryService } from './exercise-library.service';
import { CreateExerciseLibraryDto, UpdateExerciseLibraryDto } from './dto/exercise-library.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { imageUploadInterceptor, imageValidationPipe } from '../common/image-upload';

// Biblioteca é do coach — antes qualquer usuário logado alcançava estas rotas (sem vazamento,
// tudo escopado pelo próprio id, mas o atleta não tem o que fazer aqui).
@ApiTags('exercise-library')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('coach')
@Controller('exercise-library')
export class ExerciseLibraryController {
  constructor(private readonly service: ExerciseLibraryService) {}

  @Get()
  @ApiOperation({ summary: 'Lista exercícios da biblioteca do coach' })
  findAll(@Request() req: any) {
    return this.service.findAll(req.user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Adiciona exercício à biblioteca' })
  create(@Request() req: any, @Body() dto: CreateExerciseLibraryDto) {
    return this.service.create(req.user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza exercício da biblioteca' })
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateExerciseLibraryDto) {
    return this.service.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove exercício da biblioteca' })
  remove(@Request() req: any, @Param('id') id: string) {
    return this.service.remove(id, req.user.id);
  }

  @Post(':id/image')
  @ApiOperation({ summary: 'Envia a imagem de capa do exercício (JPEG/PNG/WebP, até 5MB)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(imageUploadInterceptor)
  uploadImage(@Param('id') id: string, @Request() req: any, @UploadedFile(imageValidationPipe) file: Express.Multer.File) {
    return this.service.uploadImage(id, req.user.id, file.buffer);
  }

  @Delete(':id/image')
  @ApiOperation({ summary: 'Remove a imagem de capa do exercício' })
  removeImage(@Param('id') id: string, @Request() req: any) {
    return this.service.removeImage(id, req.user.id);
  }
}
