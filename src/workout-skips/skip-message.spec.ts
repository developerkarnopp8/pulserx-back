import { buildSkipMessage, scrubSkipText } from './skip-message';

describe('buildSkipMessage', () => {
  it('monta o texto com motivo, decisão e nota (quando houver)', () => {
    expect(
      buildSkipMessage({
        name: 'Supino',
        reason: 'Injury',
        decision: 'Postponed',
        note: 'dor no ombro',
      }),
    ).toBe('Pulei "Supino" — motivo: lesão/dor. vai fazer depois. Nota: dor no ombro');
    expect(
      buildSkipMessage({
        name: 'Remo',
        reason: 'NoTime',
        decision: 'Abandoned',
      }),
    ).toBe('Pulei "Remo" — motivo: sem tempo. não vai fazer.');
    expect(
      buildSkipMessage({
        name: 'X',
        reason: 'Withheld',
        decision: 'Abandoned',
      }),
    ).toBe('Pulei "X" — motivo: removido a pedido do aluno. não vai fazer.');
  });
});

describe('scrubSkipText (ao retirar o consentimento de saúde)', () => {
  it('lesão: troca o motivo por "removido a pedido do aluno" e tira a nota', () => {
    expect(scrubSkipText('Pulei "Supino" — motivo: lesão/dor. vai fazer depois. Nota: dor no ombro')).toBe(
      'Pulei "Supino" — motivo: removido a pedido do aluno. vai fazer depois.',
    );
  });

  it('outro motivo com nota: mantém o motivo e tira só a nota (a nota pode ter saúde)', () => {
    expect(scrubSkipText('Pulei "Remo" — motivo: sem tempo. não vai fazer. Nota: joelho\ninchado')).toBe(
      'Pulei "Remo" — motivo: sem tempo. não vai fazer.',
    );
  });

  it('nome com aspas e travessão no meio continua intacto', () => {
    expect(scrubSkipText('Pulei "Agachamento "livre" — pesado" — motivo: lesão/dor. não vai fazer.')).toBe(
      'Pulei "Agachamento "livre" — pesado" — motivo: removido a pedido do aluno. não vai fazer.',
    );
  });

  it.each([
    ['sem saúde (motivo comum, sem nota): nada muda', 'Pulei "Remo" — motivo: sem tempo. não vai fazer.'],
    ['texto que não é de pulo', 'Oi coach, tudo bem?'],
  ])('%s → null', (_caso, texto) => {
    expect(scrubSkipText(texto)).toBeNull();
  });
});
