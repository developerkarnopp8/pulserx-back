import { appUrl } from './app-url';

describe('appUrl', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it('usa APP_URL, sem barra no fim', () => {
    process.env.APP_URL = 'https://aevonfit.aevon.online//';
    expect(appUrl()).toBe('https://aevonfit.aevon.online');
  });

  it('fora de produção, sem APP_URL: front local', () => {
    delete process.env.APP_URL;
    process.env.NODE_ENV = 'development';
    expect(appUrl()).toBe('http://localhost:4200');
  });

  it('em produção, sem APP_URL (ou vazio): erro, nunca link errado', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.APP_URL;
    expect(() => appUrl()).toThrow('APP_URL não configurado');
    process.env.APP_URL = '   ';
    expect(() => appUrl()).toThrow('APP_URL não configurado');
  });
});
