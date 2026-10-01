-- Decisão do dono (2026-10-01): o plano Free mostra o Core como amostra. Os Free que ainda estão sem nenhuma categoria
-- (o padrão antigo) passam a liberar o Core; os que o coach já configurou não mudam.
UPDATE "subscription_plans" SET "categories" = ARRAY['CORE']::"TrainingCategory"[]
WHERE "isFree" = true AND cardinality("categories") = 0;

UPDATE "subscription_plans" SET "description" = 'Amostra do Core, para conhecer a plataforma.'
WHERE "isFree" = true AND "description" = 'Acesso limitado, para conhecer a plataforma.';
