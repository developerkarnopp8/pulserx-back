import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { TERMS_VERSION } from '../../common/terms';
import { ALLOW_PENDING_TERMS_KEY } from '../decorators/allow-pending-terms.decorator';

/**
 * Login (JWT) + aceite dos termos: atleta cujo token não traz a versão atual dos termos (`tv`) recebe 403
 * `TERMS_PENDING` em toda rota, exceto as marcadas com `@AllowPendingTerms()` (as do consentimento).
 * Coach e admin não são barrados por esta regra (o termo do coach é outro item da LGPD).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  handleRequest<TUser = { role: string; tv?: string | null }>(
    err: unknown,
    user: TUser,
    info: unknown,
    context: ExecutionContext,
  ): TUser {
    const autenticado = super.handleRequest(err, user, info, context) as {
      role: string;
      tv?: string | null;
    };
    const liberada = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PENDING_TERMS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (
      autenticado.role === 'athlete' &&
      autenticado.tv !== TERMS_VERSION &&
      !liberada
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'TERMS_PENDING',
        message:
          'Aceite os Termos de Uso e a Política de Privacidade atualizados para continuar.',
      });
    }
    return autenticado as TUser;
  }
}
