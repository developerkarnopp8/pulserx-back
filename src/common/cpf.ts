/** Valida CPF pelo algoritmo padrão dos dígitos verificadores — aceita com ou sem máscara. */
export function isValidCpf(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false; // todos os dígitos iguais (000.000.000-00 etc.)

  const calcCheckDigit = (base: string): number => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) {
      sum += Number(base[i]) * (base.length + 1 - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  const firstCheck = calcCheckDigit(digits.slice(0, 9));
  if (firstCheck !== Number(digits[9])) return false;
  const secondCheck = calcCheckDigit(digits.slice(0, 10));
  if (secondCheck !== Number(digits[10])) return false;

  return true;
}

/** Remove máscara, deixando só os 11 dígitos — pra salvar/enviar ao gateway de forma consistente. */
export function onlyCpfDigits(value: string): string {
  return value.replace(/\D/g, '');
}
