/**
 * Sites que podem chamar a API e o chat em tempo real (CORS da API e do socket — a mesma lista nos dois).
 * `pulserx.com.br` é o domínio definitivo; o antigo `aevonfit.aevon.online` fica durante a migração (abas abertas e
 * o redirecionamento) e sai quando o domínio novo estiver confirmado.
 */
export const ALLOWED_ORIGINS = [
  'http://localhost:4200',
  'http://localhost:3000',
  'https://pulserx.com.br',
  'https://www.pulserx.com.br',
  'https://aevonfit.aevon.online',
  'https://aevonfit.bfit.aevon.online',
];
