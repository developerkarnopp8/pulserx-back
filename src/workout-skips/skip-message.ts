import type { SkipDecision, SkipReason } from '@prisma/client';

/** Motivos que o aluno escolhe (o `Withheld` só o sistema grava, ao retirar o consentimento de saúde). */
export const REASON_LABEL: Record<SkipReason, string> = {
  NoTime: 'sem tempo',
  Injury: 'lesão/dor',
  Later: 'vai fazer depois',
  Other: 'outro motivo',
  Withheld: 'removido a pedido do aluno',
};

const DECISION_LABEL: Record<SkipDecision, string> = {
  Postponed: 'vai fazer depois',
  Abandoned: 'não vai fazer',
};

/**
 * Texto do pulo que vai para o coach (mensagem automática e notificação). Fonte ÚNICA do formato — o
 * `scrubSkipText` desfaz exatamente este formato quando o aluno retira o consentimento de saúde.
 */
export function buildSkipMessage(s: {
  name: string;
  reason: SkipReason;
  decision: SkipDecision;
  note?: string | null;
}): string {
  const nota = s.note ? ` Nota: ${s.note}` : '';
  return `Pulei "${s.name}" — motivo: ${REASON_LABEL[s.reason]}. ${DECISION_LABEL[s.decision]}.${nota}`;
}

// O nome vem do coach (pode ter aspas/travessão): o motivo é casado pelo FIM do texto, onde o formato é nosso.
const FORMATO = /^(Pulei ".*" — motivo: )(.+?)\. (vai fazer depois|não vai fazer)\.(?: Nota: [\s\S]*)?$/;

/**
 * Tira o que é dado de saúde de um texto de pulo: motivo "lesão/dor" vira "removido a pedido do aluno" e a nota some.
 * Devolve null quando não há o que mudar (ou o texto não é de pulo).
 */
export function scrubSkipText(texto: string): string | null {
  const m = FORMATO.exec(texto);
  if (!m) return null;
  const [, inicio, motivo, decisao] = m as unknown as [string, string, string, string];
  const temNota = texto.length > `${inicio}${motivo}. ${decisao}.`.length;
  const lesao = motivo === REASON_LABEL.Injury;
  if (!lesao && !temNota) return null;
  return `${inicio}${lesao ? REASON_LABEL.Withheld : motivo}. ${decisao}.`;
}
