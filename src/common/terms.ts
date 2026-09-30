/**
 * Versão dos textos legais (Termos/Privacidade). Trocar quando eles mudarem — junto com o `LEGAL_LAST_UPDATED` do
 * front: todo aluno com versão antiga é levado a aceitar de novo no próximo acesso (o guard devolve TERMS_PENDING).
 * 2026-09-30: Política passa a tratar dados de saúde (consentimento específico, LGPD Art. 11).
 */
export const TERMS_VERSION = '2026-09-30';

/**
 * Versão do Termo do Coach (sigilo e uso dos dados dos alunos — LGPD, decisão do dono 2026-09-30). Fica no mesmo
 * campo `User.termsVersion`, com prefixo próprio (nunca confunde com a versão dos termos do aluno). Trocar = todo
 * coach aceita de novo no próximo acesso (o guard devolve COACH_TERMS_PENDING). Rascunho: revisar com advogado.
 */
export const COACH_TERMS_VERSION = 'coach-2026-09-30';
