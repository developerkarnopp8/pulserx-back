import { ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { HttpThrottlerGuard } from './http-throttler.guard';

const ctx = (type: string) => ({ getType: () => type }) as unknown as ExecutionContext;

describe('HttpThrottlerGuard', () => {
  afterEach(() => jest.restoreAllMocks());

  it('não aplica rate limit HTTP em contexto WebSocket (libera sem chamar o ThrottlerGuard)', async () => {
    const parent = jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(false);
    const guard = Object.create(HttpThrottlerGuard.prototype) as HttpThrottlerGuard;

    await expect(guard.canActivate(ctx('ws'))).resolves.toBe(true);
    expect(parent).not.toHaveBeenCalled();
  });

  it('delega ao ThrottlerGuard em contexto HTTP (preserva o resultado, inclusive bloqueio)', async () => {
    const parent = jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(false);
    const guard = Object.create(HttpThrottlerGuard.prototype) as HttpThrottlerGuard;

    await expect(guard.canActivate(ctx('http'))).resolves.toBe(false);
    expect(parent).toHaveBeenCalledTimes(1);
  });
});
