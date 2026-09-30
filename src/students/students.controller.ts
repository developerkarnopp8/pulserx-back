import {
  Controller, Get, Post, Patch, Delete, Body, Param, Request, UseGuards, HttpCode,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { StudentsService } from './students.service';
import { PasswordResetService } from '../auth/password-reset.service';
import { CreateStudentDto, UpdateStudentDto } from './dto/create-student.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('students')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('students')
export class StudentsController {
  constructor(
    private readonly studentsService: StudentsService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Retorna o perfil de aluno do usuário autenticado (atleta)' })
  getMyProfile(@Request() req: any) {
    return this.studentsService.findByUserId(req.user.id);
  }

  @Roles('coach')
  @Get()
  @ApiOperation({ summary: 'Lista os alunos do coach autenticado' })
  findAll(@Request() req: any) {
    return this.studentsService.findAll(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca aluno por ID (coach dono ou o próprio aluno)' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.studentsService.findOne(id, req.user);
  }

  @Get(':id/plan')
  @ApiOperation({ summary: 'Retorna o plano ativo do aluno com estrutura completa' })
  getCurrentPlan(@Param('id') id: string, @Request() req: any) {
    return this.studentsService.getCurrentPlan(id, req.user);
  }

  @Roles('coach')
  @Post()
  // Cada cadastro manda um e-mail "crie sua senha": limite próprio protege a reputação do domínio de e-mail.
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Cria aluno vinculado a um coach (ele recebe o link para criar a senha)' })
  create(@Request() req: any, @Body() dto: CreateStudentDto) {
    return this.studentsService.create(req.user.id, dto);
  }

  @Roles('coach')
  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza dados do aluno (somente o coach dono)' })
  update(@Param('id') id: string, @Body() dto: UpdateStudentDto, @Request() req: any) {
    return this.studentsService.update(id, req.user.id, dto);
  }

  @Roles('coach')
  @Post(':id/password-reset')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @ApiOperation({ summary: 'Envia ao aluno (do próprio coach) o link por e-mail para criar uma senha nova' })
  sendPasswordReset(@Param('id') id: string, @Request() req: any) {
    return this.passwordReset.sendStudentReset(id, req.user.id);
  }

  @Roles('coach')
  @Delete(':id')
  @ApiOperation({
    summary: 'Desvincula o aluno: cancela a cobrança, tira da lista e corta o acesso (somente o coach dono). Não apaga a conta.',
  })
  unlink(@Param('id') id: string, @Request() req: any) {
    return this.studentsService.unlink(id, req.user.id);
  }
}
