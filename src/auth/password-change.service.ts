import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

/**
 * Troca de senha de quem está logado (coach, aluno ou admin). Exige a senha atual — o token sozinho não basta (sessão
 * esquecida aberta num computador não pode trocar a senha do dono). Trocar derruba as OUTRAS sessões (`passwordChangedAt`,
 * conferido pelo JwtStrategy) e devolve uma sessão nova para quem trocou continuar logado.
 */
@Injectable()
export class PasswordChangeService {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
  ) {}

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, email: true, role: true, termsVersion: true, healthConsent: true,
        passwordHash: true, deletedAt: true,
      },
    });
    if (!user || user.deletedAt) throw new NotFoundException('Conta não encontrada.');
    // 400 (não 401): é erro de digitação, não sessão vencida — o front não pode deslogar por isso.
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new BadRequestException('Senha atual incorreta.');
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new BadRequestException('A senha nova precisa ser diferente da atual.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(newPassword, 10), passwordChangedAt: new Date() },
    });
    const { passwordHash: _hash, deletedAt: _del, ...session } = user;
    return this.auth.login(session);
  }
}
