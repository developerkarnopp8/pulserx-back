/**
 * Vínculo aluno↔coach ativo. Toda consulta de aluno feita para o coach/admin (ou para decidir acesso) filtra por
 * isto: aluno desvinculado ou com a conta excluída some das telas do coach e não dá acesso a nada.
 * Consulta que precisa incluir os desvinculados de propósito leva o comentário `inclui desvinculados`
 * (conferido por `student-scope.spec.ts`).
 */
export const ACTIVE_STUDENT = { unlinkedAt: null } as const;
