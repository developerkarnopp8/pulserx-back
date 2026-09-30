import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { COACH_TERMS_VERSION, TERMS_VERSION } from '../../common/terms';
import { ALLOW_PENDING_TERMS_KEY } from '../decorators/allow-pending-terms.decorator';
import { ALLOW_UNLINKED_KEY } from '../decorators/allow-unlinked.decorator';

type Autenticado = { role: string; tv?: string | null; unlinked?: boolean };

/**
 * Login (JWT) + regras do aluno, nesta ordem:
 * 1. vínculo encerrado (coach desvinculou): 403 `UNLINKED` em toda rota, exceto as marcadas com `@AllowUnlinked()`;
 * 2. termos: atleta cujo token não traz a versão atual (`tv`) recebe 403 `TERMS_PENDING`, exceto `@AllowPendingTerms()`.
 * Coach: sem o Termo do Coach na versão atual (`tv`), 403 `COACH_TERMS_PENDING` fora das rotas `@AllowPendingTerms()`.
 * Conta excluída nem chega aqui: o JwtStrategy já recusa (401). Admin não é barrado.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  handleRequest<TUser = Autenticado>(err: unknown, user: TUser, info: unknown, context: ExecutionContext): TUser {
    const autenticado = super.handleRequest(err, user, info, context) as Autenticado;
    const marcada = (chave: string) =>
      this.reflector.getAllAndOverride<boolean>(chave, [context.getHandler(), context.getClass()]);

    if (autenticado.role === 'coach') {
      if (autenticado.tv !== COACH_TERMS_VERSION && !marcada(ALLOW_PENDING_TERMS_KEY)) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'COACH_TERMS_PENDING',
          message: 'Aceite o Termo do Coach para continuar usando o painel.',
        });
      }
      return autenticado as TUser;
    }
    if (autenticado.role !== 'athlete') return autenticado as TUser;

    if (autenticado.unlinked && !marcada(ALLOW_UNLINKED_KEY)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'UNLINKED',
        message: 'Seu vínculo com o treinador foi encerrado.',
      });
    }
    if (autenticado.tv !== TERMS_VERSION && !marcada(ALLOW_PENDING_TERMS_KEY)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'TERMS_PENDING',
        message: 'Aceite os Termos de Uso e a Política de Privacidade atualizados para continuar.',
      });
    }
    return autenticado as TUser;
  }
}
