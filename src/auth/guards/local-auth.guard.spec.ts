import { AuthGuard } from '@nestjs/passport';
import { LocalAuthGuard } from './local-auth.guard';

describe('LocalAuthGuard', () => {
  it('é o AuthGuard da estratégia "local"', () => {
    expect(new LocalAuthGuard()).toBeInstanceOf(AuthGuard('local'));
  });
});
