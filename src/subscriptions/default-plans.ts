import { Prisma, TrainingCategory } from '@prisma/client';

export interface DefaultPlanTemplate {
  name: string;
  description: string;
  priceCents: number;
  categories: TrainingCategory[];
  isFree: boolean;
  active: boolean;
  freeConfig?: Prisma.InputJsonObject;
}

/**
 * Ponto de partida de cada coach (Combo/Core/LPO/Free). São só sugestões: coach e admin
 * editam tudo, inclusive o que o Free libera. Os pagos nascem INATIVOS e com preço 0 de
 * propósito — o valor é decisão do coach/contrato, não se inventa preço aqui.
 */
export const DEFAULT_PLAN_TEMPLATES: DefaultPlanTemplate[] = [
  {
    name: 'Combo (Core + LPO + Performance)',
    description: 'As três categorias de treino.',
    priceCents: 0,
    categories: [TrainingCategory.CORE, TrainingCategory.LPO, TrainingCategory.PERFORMANCE],
    isFree: false,
    active: false,
  },
  { name: 'Core', description: 'Somente Core.', priceCents: 0, categories: [TrainingCategory.CORE], isFree: false, active: false },
  { name: 'LPO', description: 'Somente LPO.', priceCents: 0, categories: [TrainingCategory.LPO], isFree: false, active: false },
  {
    name: 'Free',
    description: 'Acesso limitado, para conhecer a plataforma.',
    priceCents: 0,
    categories: [],
    isFree: true,
    active: true,
    // Sugestão inicial — o coach/admin decidem o que o Free libera.
    freeConfig: { sampleSessionsPerCategory: 1, supportVideos: true, fullHistory: false },
  },
];
