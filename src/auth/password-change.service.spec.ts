import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PasswordChangeService } from './password-change.service';

async function build(over: Record<string, unknown> = {}) {
  const user = {
    id: 'u1', name: 'Ana', email: 'ana@example.com', role: 'coach', termsVersion: 'v1', healthConsent: null,
    passwordHash: await bcrypt.hash('senha-atual-1', 4), deletedAt: null, ...over,
  };
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue('missing' in over ? null : user),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const auth = { login: jest.fn().mockResolvedValue({ access_token: 'novo', user: { id: 'u1' } }) };
  return { service: new PasswordChangeService(prisma as any, auth as any), prisma, auth };
}

describe('PasswordChangeService', () => {
  it('senha atual certa: grava o hash novo, marca a troca (derruba as outras sessões) e devolve sessão nova', async () => {
    const { service, prisma, auth } = await build();
    const antes = Date.now();
    await expect(service.changePassword('u1', 'senha-atual-1', 'senha-nova-123')).resolves.toEqual({ access_token: 'novo', user: { id: 'u1' } });

    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' } }));
    const { data } = prisma.user.update.mock.calls[0][0];
    expect(await bcrypt.compare('senha-nova-123', data.passwordHash)).toBe(true);
    expect(data.passwordChangedAt.getTime()).toBeGreaterThanOrEqual(antes);
    // A sessão nova nunca leva o hash nem a marca de exclusão.
    const sessao = auth.login.mock.calls[0][0];
    expect(sessao).toEqual({ id: 'u1', name: 'Ana', email: 'ana@example.com', role: 'coach', termsVersion: 'v1', healthConsent: null });
  });

  it('senha atual errada: 400 "Senha atual incorreta." (não 401 — não desloga) e nada muda', async () => {
    const { service, prisma, auth } = await build();
    const err = await service.changePassword('u1', 'errada', 'senha-nova-123').catch(e => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe('Senha atual incorreta.');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('senha nova igual à atual: recusa', async () => {
    const { service, prisma } = await build();
    await expect(service.changePassword('u1', 'senha-atual-1', 'senha-atual-1')).rejects.toThrow('diferente da atual');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('conta excluída ou inexistente: 404', async () => {
    const excluida = await build({ deletedAt: new Date() });
    await expect(excluida.service.changePassword('u1', 'senha-atual-1', 'senha-nova-123')).rejects.toBeInstanceOf(NotFoundException);
    const sumiu = await build({ missing: true });
    await expect(sumiu.service.changePassword('u1', 'senha-atual-1', 'senha-nova-123')).rejects.toBeInstanceOf(NotFoundException);
  });
});
