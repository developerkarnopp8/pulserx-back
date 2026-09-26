# PulseRx v2 — categorias de treino, assinaturas e planos (design + roadmap)

**Data:** 2026-09-26 · **Status:** proposta aprovada em conversa com o dono, **roadmap em rodadas** (nada implementado ainda)
**Repos:** `pulserx-back` (este) + `pulserx-front` · **Dono/decisor:** Gustavo Karnopp (admin da plataforma)

> Este documento existe para qualquer pessoa (ou Claude) retomar o trabalho sem depender da conversa em que ele nasceu.
> Referência visual: prints do Stitch enviados pelo dono (painel do coach, financeiro/joint venture, construtor de WODs,
> app do atleta com Aulas/PRs/Perfil/Treino ativo). Os prints são **referência, não o design final aprovado**.

## 1. Decisões já tomadas pelo dono

| # | Decisão | Consequência |
|---|---|---|
| 1 | Nome do produto: **PulseRx** (não "AevonFit"; `@aevonfit.com` é só o domínio de e-mail interno e **não se renomeia**). | Ver memória do projeto. |
| 2 | **Coach e admin controlam tudo** — inclusive o que o plano **Free** libera. O admin (dono) administra **mais de um coach** e pode fazer tudo que um coach faz, em qualquer coach. | Planos e regras são **dados configuráveis**, não enum fixo no código. Os 4 SKUs (Combo/Core/LPO/Free) são só o *padrão inicial*. |
| 3 | **Cobrança de assinatura pelo Mercado Pago.** A **porcentagem da plataforma é definida por contrato, por coach.** | Um contrato por coach (`platformFeePercent`) + conta Mercado Pago do coach. |
| 4 | **Alunos que já existem entram no Free** quando a v2 subir. | Risco: perdem o plano individual (que vira "Performance", fora do Free). **Mitigação combinada:** o bloqueio por assinatura nasce **desligado** (flag `enforceSubscriptionAccess`); coach/admin atribuem planos (ferramenta de atribuição em massa) e só então o admin liga o bloqueio. |
| 5 | **Manual primeiro, Mercado Pago depois.** O produto funciona com atribuição manual de plano; o teste técnico do Mercado Pago roda em paralelo. | Rodada 3 (manual) antes da 4 (gateway). |
| 6 | **Escopo = tudo dos prints**, dividido em rodadas. | Ver §5 — várias rodadas, nenhuma é um PR único. |

## 2. Modelo de dados (aditivo — `prisma db push`/migration sem quebrar produção)

```
enum TrainingCategory { CORE  LPO  PERFORMANCE }
enum PlanScope        { SHARED  INDIVIDUAL }
enum SubscriptionStatus { TRIALING  ACTIVE  PAST_DUE  CANCELED }

SubscriptionPlan            // por coach; admin edita de qualquer coach
  id, coachId, name, description
  priceCents Int            // 0 = Free
  categories TrainingCategory[]   // o que o plano libera (Combo = as 3; Core = [CORE]; LPO = [LPO]; Free = configurável)
  isFree Boolean
  freeConfig Json?          // o que o Free libera: nº de sessões-amostra por categoria, vídeos de dúvida, histórico, chat...
  active Boolean, createdAt, updatedAt

Subscription                // por aluno
  id, studentId, planId, status SubscriptionStatus
  startedAt, renewsAt, canceledAt
  mpPreapprovalId String?   // Mercado Pago (Rodada 4)
  trialEndsAt DateTime?

CoachContract               // por coach; SÓ o admin edita
  coachId (unique), platformFeePercent Decimal  // definido por contrato
  mpUserId String?, mpAccessToken (cifrado) ...  // OAuth do coach (Rodada 4)

TrainingPlan  (existente)  → ganha:
  category TrainingCategory   // existentes viram PERFORMANCE
  scope    PlanScope          // existentes viram INDIVIDUAL
  studentId  String?  (hoje obrigatório → passa a opcional; SHARED não tem aluno)

PerformanceEvaluation       // avaliação do coach sobre o aluno (Rodada 5)
  id, studentId, coachId, score, notes, category?, createdAt
```

**Regra de acesso:** o aluno vê (a) os planos `SHARED` das categorias do plano ativo dele + (b) o plano `INDIVIDUAL` PERFORMANCE dele, se PERFORMANCE estiver incluída. Free segue `freeConfig`. Com `enforceSubscriptionAccess = false`, o comportamento atual é preservado.

**Plano compartilhado (Core/LPO):** calendário próprio (não depende do `startDate` de cada aluno); progresso continua **por aluno** (`WorkoutLog`/`WorkoutSession`/`WorkoutSkip` já são por atleta e apontam para `Exercise`, que passa a ser compartilhado).

**Migração dos dados existentes:** todos os `TrainingPlan` atuais → `category=PERFORMANCE`, `scope=INDIVIDUAL`; todos os `Student` atuais → `Subscription` no plano Free do coach (decisão #4), com o bloqueio desligado.

## 3. Permissões

- **Coach:** CRUD dos próprios `SubscriptionPlan`; edita planos SHARED (Core/LPO) e INDIVIDUAL (Performance) dos próprios alunos; atribui plano a aluno; avalia aluno.
- **Admin:** tudo do coach, em qualquer coach; edita `CoachContract` (%); liga/desliga `enforceSubscriptionAccess`; vê assinaturas/receita de todos os coaches.
- **Atleta:** vê só o que o plano libera; nunca vê contrato/% do coach.
- Sempre com checagem de dono no controller (padrão `assertCanAccess` de `students.service.ts`), nunca só `@Roles`.

## 4. Riscos e pendências técnicas (não decididos)

1. **Mercado Pago: recorrência + repasse por coach.** No AmoraRunning usamos Checkout Pro com `marketplace_fee` + OAuth do vendedor. **Não está confirmado** que a API de assinaturas (`preapproval`) aceita repasse/`marketplace_fee` da mesma forma. **Fazer um spike antes de prometer** (Rodada 4). Alternativas se não for viável: cobrança mensal por Checkout Pro gerada por job (link/Pix mensal), ou split manual/contábil.
2. **Prints citam Asaas/Stripe** (ex.: "Custodiante Asaas / SmartSplit API", "Gateway Stripe + Pix"); o dono decidiu **Mercado Pago**. Tratar os prints como layout, não como decisão de gateway.
3. **Financeiro "joint venture 50/50", DRE, NF-e, escrow/contrato, chave PIX/CNPJ de recebimento:** envolvem contabilidade/jurídico (emissão de NFS-e, custódia, split). O que for **estimativa/relatório** entra; o que for **emissão fiscal ou custódia real** precisa de decisão jurídica/contábil e de um provedor — **não assumir**.
4. **LGPD (skill `validacao-lgpd-pre-producao` antes de produção):** cobrança, avaliação de desempenho, dados de pessoas físicas; a AEVON é operadora e o coach/plataforma controlador — deixar explícito.
5. **Carga adaptativa por PR** (kg calculado a partir do PR do atleta): depende de `PersonalRecord` (existe) e de regra de arredondamento definida pelo coach.
6. **Biometria (Face ID/Touch ID)** é recurso de app nativo/PWA (WebAuthn); tratar como Rodada própria.

## 5. Roadmap em rodadas (cada linha = um ou mais PRs pequenos, fluxo padrão: branch → CI → PR → dono mergeia)

| Rodada | Entrega | Depende de | Observação |
|---|---|---|---|
| **R1 — Fundação** | Schema aditivo (categoria/escopo/planos/assinaturas/contrato) + backfill + serviço de acesso + flag `enforceSubscriptionAccess` (desligada). Sem UI. | — | Baixo risco, base de tudo. |
| **R2 — Plano compartilhado** | Editor de plano Core/LPO (builder único por categoria) + visão do atleta por assinatura. | R1 | Reusa o Plan Builder atual. |
| **R3 — Assinaturas (manual)** | Tela de planos (coach/admin), atribuição individual **e em massa**, upgrade/downgrade, configuração do Free, contrato (%) pelo admin, ligar o bloqueio. | R1, R2 | Aqui o dono liga `enforceSubscriptionAccess`. |
| **R4 — Mercado Pago** | Spike (recorrência + repasse) → OAuth do coach, cobrança recorrente, webhook como fonte de verdade, %, dunning/inadimplência, trial→conversão. | R3 | Bloqueada pelo spike. |
| **R5 — Avaliação + chat** | Avaliação de desempenho; chat com filtros por plano (o módulo de mensagens já existe). | R1 | Independente de R4. |
| **R6 — Telas do atleta** | Assinatura/upgrade, Aulas (vídeos por plano com progresso), "Gestão". | R2, R3 | Conteúdo pago com upsell ("requer plano X"). |
| **R7 — Financeiro do coach/admin** | Painel de receita, churn, LTV, NPS, ledger e exportações (CSV/DRE como **relatório**). | R4 | Emissão de NFS-e/escrow só após decisão jurídica (§4.3). |
| **R8 — Construtor tático de WODs** | Periodização (ciclos), blocos, %1RM, RPE, carga adaptativa por PR, publicação agendada. | R2 | Evolução do Plan Builder. |
| **R9 — App: treino ativo e biometria** | Timer/haptics/RPE por série; login biométrico. | R8 | Depende de decisão PWA vs nativo. |

## 6. Como retomar

1. Ler `CLAUDE.md` de `backend/` e `frontend/` e a memória do projeto (rename, e-mail `@aevonfit.com` intocado, VPS fora de escopo).
2. Começar pela **R1**. Toda mudança de schema é **aditiva** (campo novo opcional/com default; `Subscription`/`SubscriptionPlan` são tabelas novas).
3. Antes de cada PR: `tsc`, lint, testes (`npm test` — usa `--experimental-vm-modules`, Node 24), `security-analyst`; LGPD antes de produção.
