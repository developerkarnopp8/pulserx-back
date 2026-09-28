import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Não existe cadastro público de usuário (decisão do dono, 2026-09-28): coach é criado só pelo
  // admin (POST /admin/coaches) e aluno pelo coach ou pela inscrição na landing do coach
  // (POST /public/coaches/:slug/signup). O antigo POST /users deixava qualquer um virar coach.

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retorna o usuário autenticado' })
  getMe(@Request() req: any) {
    return this.usersService.findById(req.user.id);
  }
}
