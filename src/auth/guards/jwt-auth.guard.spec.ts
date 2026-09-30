import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TERMS_VERSION } from '../../common/terms';
import { JwtAuthGuard } from './jwt-auth.guard';

function contexto(): ExecutionContext {
  return {
    getHandler: () => 'h',
    getClass: () => 'c',
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard.handleRequest (aceite dos termos)', () => {
  const guard = (liberada?: boolean) =>
    new JwtAuthGuard({
      getAllAndOverride: jest.fn().mockReturnValue(liberada),
    } as unknown as Reflector);

  it('atleta com a versão atual dos termos: passa', () => {
    const user = { role: 'athlete', tv: TERMS_VERSION };
    expect(guard().handleRequest(null, user, null, contexto())).toBe(user);
  });

  it.each([null, undefined, '2026-09-28'])('atleta com versão %s: 403 TERMS_PENDING', (tv) => {
    expect(() => guard().handleRequest(null, { role: 'athlete', tv }, null, contexto())).toThrow(
      new ForbiddenException({
        statusCode: 403,
        code: 'TERMS_PENDING',
        message: 'Aceite os Termos de Uso e a Política de Privacidade atualizados para continuar.',
      }),
    );
  });

  it('rota do consentimento (@AllowPendingTerms): atleta pendente passa', () => {
    const user = { role: 'athlete', tv: null };
    expect(guard(true).handleRequest(null, user, null, contexto())).toBe(user);
  });

  it.each(['coach', 'admin'])('%s não depende dos termos do aluno', (role) => {
    const user = { role, tv: null };
    expect(guard().handleRequest(null, user, null, contexto())).toBe(user);
  });

  it('sem login: continua 401 (o passport decide antes)', () => {
    expect(() => guard().handleRequest(null, false, null, contexto())).toThrow(UnauthorizedException);
  });
});
