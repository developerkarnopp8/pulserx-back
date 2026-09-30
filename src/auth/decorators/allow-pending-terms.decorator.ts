import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_TERMS_KEY = 'allowPendingTerms';

/** Rota que o atleta com termos desatualizados pode usar (só as do próprio consentimento). */
export const AllowPendingTerms = () => SetMetadata(ALLOW_PENDING_TERMS_KEY, true);
