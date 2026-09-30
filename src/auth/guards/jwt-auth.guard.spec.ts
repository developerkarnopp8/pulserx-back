import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { COACH_TERMS_VERSION, TERMS_VERSION } from '../../common/terms';
import { ALLOW_PENDING_TERMS_KEY } from '../decorators/allow-pending-terms.decorator';
import { ALLOW_UNLINKED_KEY } from '../decorators/allow-unlinked.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

function contexto(): ExecutionContext {
  return {
    getHandler: () => 'h',
    getClass: () => 'c',
  } as unknown as ExecutionContext;
}

const TERMS_PENDING = new ForbiddenException({
  statusCode: 403,
  code: 'TERMS_PENDING',
  message: 'Aceite os Termos de Uso e a Política de Privacidade atualizados para continuar.',
});
const UNLINKED = new ForbiddenException({
  statusCode: 403,
  code: 'UNLINKED',
  message: 'Seu vínculo com o treinador foi encerrado.',
});

/** Reflector que responde por chave: marca a rota com os decorators passados. */
const guard = (...marcas: string[]) => {
  const reflector = {
    getAllAndOverride: jest.fn((chave: string, alvos: unknown[]) => {
      expect(alvos).toEqual(['h', 'c']);
      return marcas.includes(chave) ? true : undefined;
    }),
  };
  return new JwtAuthGuard(reflector as unknown as Reflector);
};

describe('JwtAuthGuard.handleRequest — aceite dos termos', () => {
  it('atleta com a versão atual dos termos: passa', () => {
    const user = { role: 'athlete', tv: TERMS_VERSION };
    expect(guard().handleRequest(null, user, null, contexto())).toBe(user);
  });

  it.each([null, undefined, '2026-09-28'])('atleta com versão %s: 403 TERMS_PENDING', (tv) => {
    expect(() => guard().handleRequest(null, { role: 'athlete', tv }, null, contexto())).toThrow(TERMS_PENDING);
  });

  it('rota do consentimento (@AllowPendingTerms): atleta pendente passa', () => {
    const user = { role: 'athlete', tv: null };
    expect(guard(ALLOW_PENDING_TERMS_KEY).handleRequest(null, user, null, contexto())).toBe(user);
  });

  it('@AllowUnlinked sozinho não libera termos pendentes', () => {
    expect(() => guard(ALLOW_UNLINKED_KEY).handleRequest(null, { role: 'athlete', tv: null }, null, contexto())).toThrow(
      TERMS_PENDING,
    );
  });

  it('admin não depende de termo nenhum', () => {
    const user = { role: 'admin', tv: null, unlinked: true };
    expect(guard().handleRequest(null, user, null, contexto())).toBe(user);
  });

  it('sem login: continua 401 (o passport decide antes)', () => {
    expect(() => guard().handleRequest(null, false, null, contexto())).toThrow(UnauthorizedException);
  });
});

describe('JwtAuthGuard.handleRequest — vínculo encerrado', () => {
  it('aluno desvinculado: 403 UNLINKED (vem antes dos termos)', () => {
    expect(() =>
      guard(ALLOW_PENDING_TERMS_KEY).handleRequest(null, { role: 'athlete', tv: null, unlinked: true }, null, contexto()),
    ).toThrow(UNLINKED);
    expect(() =>
      guard().handleRequest(null, { role: 'athlete', tv: TERMS_VERSION, unlinked: true }, null, contexto()),
    ).toThrow(UNLINKED);
  });

  it('rota @AllowUnlinked + @AllowPendingTerms (excluir a conta): aluno desvinculado e pendente passa', () => {
    const user = { role: 'athlete', tv: null, unlinked: true };
    expect(guard(ALLOW_UNLINKED_KEY, ALLOW_PENDING_TERMS_KEY).handleRequest(null, user, null, contexto())).toBe(user);
  });

  it('aluno com vínculo (unlinked false) segue normal', () => {
    const user = { role: 'athlete', tv: TERMS_VERSION, unlinked: false };
    expect(guard().handleRequest(null, user, null, contexto())).toBe(user);
  });
});

describe('JwtAuthGuard.handleRequest — Termo do Coach', () => {
  const COACH_PENDENTE = new ForbiddenException({
    statusCode: 403,
    code: 'COACH_TERMS_PENDING',
    message: 'Aceite o Termo do Coach para continuar usando o painel.',
  });

  it('coach com o termo na versão atual: passa (e nunca cai nas regras do aluno)', () => {
    const user = { role: 'coach', tv: COACH_TERMS_VERSION, unlinked: true };
    expect(guard().handleRequest(null, user, null, contexto())).toBe(user);
  });

  it.each([null, undefined, '2026-09-30', 'coach-2026-01-01'])('coach com versão %s: 403 COACH_TERMS_PENDING', (tv) => {
    expect(() => guard().handleRequest(null, { role: 'coach', tv }, null, contexto())).toThrow(COACH_PENDENTE);
  });

  it('a versão dos termos do ALUNO não vale como termo do coach', () => {
    expect(() => guard().handleRequest(null, { role: 'coach', tv: TERMS_VERSION }, null, contexto())).toThrow(COACH_PENDENTE);
  });

  it('rota do termo (@AllowPendingTerms): coach pendente passa', () => {
    const user = { role: 'coach', tv: null };
    expect(guard(ALLOW_PENDING_TERMS_KEY).handleRequest(null, user, null, contexto())).toBe(user);
  });

  it('@AllowUnlinked não libera o coach pendente', () => {
    expect(() => guard(ALLOW_UNLINKED_KEY).handleRequest(null, { role: 'coach', tv: null }, null, contexto())).toThrow(
      COACH_PENDENTE,
    );
  });
});
