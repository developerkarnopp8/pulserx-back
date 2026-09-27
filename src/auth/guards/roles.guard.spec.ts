import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function makeContext(role: string | undefined): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('sem @Roles() na rota: libera geral (guard não é o gate de autenticação, só de papel)', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    expect(guard.canActivate(makeContext(undefined))).toBe(true);
  });

  it('com @Roles() e o papel do usuário bate: libera', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['coach', 'admin']) };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    expect(guard.canActivate(makeContext('coach'))).toBe(true);
  });

  it('com @Roles() e o papel não bate: nega', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['coach', 'admin']) };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    expect(guard.canActivate(makeContext('athlete'))).toBe(false);
  });

  it('com @Roles() e sem usuário na requisição (não autenticado): nega, sem lançar', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['admin']) };
    const guard = new RolesGuard(reflector as unknown as Reflector);

    expect(guard.canActivate(makeContext(undefined))).toBe(false);
  });
});
