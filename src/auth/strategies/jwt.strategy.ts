import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET não configurado — defina a variável de ambiente antes de iniciar a aplicação.',
    );
  }
  return secret;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireJwtSecret(),
    });
  }

  /**
   * O token vale 7 dias, mas a conta pode ter sido excluída (anonimizada) ou o vínculo encerrado nesse meio-tempo:
   * confere no banco a cada requisição, para que excluir/desvincular valha na hora.
   */
  async validate(payload: any) {
    const conta = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { deletedAt: true, student: { select: { unlinkedAt: true } } },
    });
    if (!conta || conta.deletedAt) throw new UnauthorizedException('Sessão encerrada. Entre novamente.');
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      name: payload.name,
      // Versão dos termos aceita (o JwtAuthGuard barra atleta com versão antiga).
      tv: payload.tv ?? null,
      // Aluno sem vínculo ativo com um coach (o JwtAuthGuard só deixa as rotas @AllowUnlinked).
      unlinked: payload.role === 'athlete' && !!conta.student?.unlinkedAt,
    };
  }
}
