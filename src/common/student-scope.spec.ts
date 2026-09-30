import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { ACTIVE_STUDENT } from './student-scope';

const RAIZ = join(__dirname, '..');

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return nome.endsWith('.ts') && !nome.endsWith('.spec.ts') ? [caminho] : [];
  });
}

describe('vínculo ativo aluno↔coach', () => {
  it('ACTIVE_STUDENT filtra só vínculos não encerrados', () => {
    expect(ACTIVE_STUDENT).toEqual({ unlinkedAt: null });
  });

  // Aluno desvinculado ou com a conta excluída não pode reaparecer nas telas do coach nem dar acesso: toda consulta
  // de aluno filtra `ACTIVE_STUDENT`, ou declara que inclui os desvinculados de propósito (comentário na consulta).
  it('toda consulta de aluno filtra o vínculo ativo ou declara "inclui desvinculados"', () => {
    const faltando: string[] = [];
    for (const arquivo of arquivos(RAIZ)) {
      const linhas = readFileSync(arquivo, 'utf8').split('\n');
      linhas.forEach((linha, i) => {
        if (!/\bstudent\.(findFirst|findMany|findUnique|findUniqueOrThrow|findFirstOrThrow|count)\(/.test(linha)) return;
        const trecho = linhas.slice(Math.max(0, i - 2), i + 6).join('\n');
        if (!/ACTIVE_STUDENT|unlinkedAt|inclui desvinculados/.test(trecho)) {
          faltando.push(`${relative(RAIZ, arquivo)}:${i + 1}`);
        }
      });
    }
    expect(faltando).toEqual([]);
  });
});
