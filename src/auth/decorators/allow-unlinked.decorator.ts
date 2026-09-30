import { SetMetadata } from '@nestjs/common';

export const ALLOW_UNLINKED_KEY = 'allowUnlinked';

/** Rota que o aluno sem vínculo ativo com um coach ainda pode usar (ex.: excluir a própria conta). */
export const AllowUnlinked = () => SetMetadata(ALLOW_UNLINKED_KEY, true);
