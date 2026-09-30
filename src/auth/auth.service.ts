import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import { TERMS_VERSION } from '../common/terms';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return null;
    }

    const { passwordHash, ...result } = user;
    return result;
  }

  async login(user: any) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      // Versão dos termos que o usuário aceitou: o JwtAuthGuard barra atleta com versão antiga.
      tv: user.termsVersion ?? null,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        // Só o aluno: a tela de consentimento abre se os termos estão pendentes ou a saúde não foi respondida.
        ...(user.role === 'athlete'
          ? {
              termsPending: user.termsVersion !== TERMS_VERSION,
              healthConsent: user.healthConsent ?? null,
            }
          : {}),
      },
    };
  }
}
