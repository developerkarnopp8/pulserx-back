import { isValidCpf, onlyCpfDigits } from './cpf';

describe('isValidCpf', () => {
  it('aceita CPFs válidos, com e sem máscara', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
  });

  it('aceita CPF cujo resto do módulo 11 é exatamente 10 (dígito verificador vira 0)', () => {
    expect(isValidCpf('10000000108')).toBe(true);
  });

  it('rejeita tamanho diferente de 11 dígitos', () => {
    expect(isValidCpf('123')).toBe(false);
    expect(isValidCpf('123456789012')).toBe(false);
  });

  it('rejeita todos os dígitos iguais (000.000.000-00, 111.111.111-11, etc.)', () => {
    expect(isValidCpf('00000000000')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
  });

  it('rejeita primeiro dígito verificador errado', () => {
    expect(isValidCpf('52998224735')).toBe(false);
  });

  it('rejeita segundo dígito verificador errado', () => {
    expect(isValidCpf('52998224726')).toBe(false);
  });
});

describe('onlyCpfDigits', () => {
  it('remove pontuação, mantendo só os dígitos', () => {
    expect(onlyCpfDigits('529.982.247-25')).toBe('52998224725');
  });

  it('CPF já sem máscara fica igual', () => {
    expect(onlyCpfDigits('52998224725')).toBe('52998224725');
  });
});
