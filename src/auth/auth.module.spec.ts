import { ConfigService } from '@nestjs/config';
import { buildJwtModuleOptions } from './auth.module';

function configWith(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string, defaultValue?: string) => values[key] ?? defaultValue),
  } as unknown as ConfigService;
}

describe('buildJwtModuleOptions', () => {
  it('sem JWT_SECRET: lança erro explícito (nunca sobe sem segredo)', () => {
    expect(() => buildJwtModuleOptions(configWith({}))).toThrow('JWT_SECRET não configurado');
  });

  it('com JWT_SECRET e sem JWT_EXPIRES_IN: usa 7d como padrão', () => {
    const options = buildJwtModuleOptions(configWith({ JWT_SECRET: 'segredo' }));
    expect(options).toEqual({ secret: 'segredo', signOptions: { expiresIn: '7d' } });
  });

  it('com JWT_EXPIRES_IN definido: usa o valor da env', () => {
    const options = buildJwtModuleOptions(configWith({ JWT_SECRET: 'segredo', JWT_EXPIRES_IN: '1h' }));
    expect(options).toEqual({ secret: 'segredo', signOptions: { expiresIn: '1h' } });
  });
});
