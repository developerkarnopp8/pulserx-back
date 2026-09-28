/** Valida CPF pelo algoritmo padrão dos dígitos verificadores — aceita com ou sem máscara. */
export function isValidCpf(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false; // todos os dígitos iguais (000.000.000-00 etc.)

  // `len` trava em 10 (o maior `base` possível aqui é `digits.slice(0, 10)`) mesmo que `base`
  // venha maior — evita a análise estática apontar o `for` como um loop de tamanho não travado
  // vindo de entrada do usuário (CodeQL "loop bound injection"), já que `digits` só chega até
  // aqui com exatamente 11 caracteres (checado acima).
  const calcCheckDigit = (base: string): number => {
    let sum = 0;
    const len = Math.min(base.length, 10);
    for (let i = 0; i < len; i++) {
      sum += Number(base[i]) * (len + 1 - i);
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
