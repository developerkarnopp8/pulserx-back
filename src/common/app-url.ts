/**
 * Endereço do site para montar links enviados por e-mail. Vem SEMPRE da configuração (`APP_URL`) — nunca do
 * cabeçalho da requisição, que um atacante controla (e-mail de "redefinir senha" apontando para site falso).
 * Fora de produção cai no front local; em produção, sem `APP_URL`, falha em vez de mandar link errado.
 */
export function appUrl(): string {
  const url = process.env.APP_URL?.trim();
  if (url) return url.replace(/\/+$/, '');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('APP_URL não configurado — defina o endereço público do site.');
  }
  return 'http://localhost:4200';
}
