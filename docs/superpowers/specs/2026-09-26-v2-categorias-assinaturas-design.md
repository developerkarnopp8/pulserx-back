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
| 3 | **Gateway: Mercado Pago preferido, mas Asaas também serve** (dono, 2026-09-26: "podemos optar por MP; se der, cada coach loga a conta Asaas dele e eu recebo na minha, ou crio uma conta Asaas só da PulseRx, tanto faz"). A **porcentagem da plataforma é definida por contrato, por coach.** | Schema **agnóstico de gateway** (`PaymentGateway`). Um contrato por coach (`platformFeePercent`) + credencial do coach no gateway escolhido. **A escolha final sai do spike da Rodada 4** (ver §4.1). |
| 4 | **Os alunos que já existem em produção são todos TESTE e podem ser removidos** (dono, 2026-09-26; substitui a decisão anterior de "todos entram no Free"). | **Sem backfill/grandfathering.** A remoção dos dados de teste em produção é uma operação destrutiva: fazer **só na hora do deploy**, com **backup do banco antes** e confirmação explícita do dono naquele momento. |
| 5 | **Manual primeiro, Mercado Pago depois.** O produto funciona com atribuição manual de plano; o teste técnico do Mercado Pago roda em paralelo. | Rodada 3 (manual) antes da 4 (gateway). |
| 6 | **Escopo = tudo dos prints**, dividido em rodadas. | Ver §5 — várias rodadas, nenhuma é um PR único. |
| 7 | **Financeiro: só relatório/estimativa** (dono: "pode ser"). Emissão de NFS-e, custódia/escrow e contrato jurídico **não** entram sem decisão jurídica/contábil. | Rodada 7 é relatório (receita, churn, LTV, exportações CSV), não emissão fiscal. |

## 2. Modelo de dados (aditivo — `prisma db push`/migration sem quebrar produção)

```
enum TrainingCategory { CORE  LPO  PERFORMANCE }
enum PlanScope        { SHARED  INDIVIDUAL }
enum SubscriptionStatus { TRIALING  ACTIVE  PAST_DUE  CANCELED }
enum PaymentGateway     { MERCADO_PAGO  ASAAS }

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
  gateway PaymentGateway?   // definido na Rodada 4
  gatewaySubscriptionId String?   // id da assinatura no gateway (preapproval no MP / subscription no Asaas)
  trialEndsAt DateTime?

CoachContract               // por coach; SÓ o admin edita
  coachId (unique), platformFeePercent Decimal  // definido por contrato
  gateway PaymentGateway?, gatewayAccountRef String?   // MP: user id + token OAuth (cifrado); Asaas: walletId do coach
                                                        // (segredos nunca em claro nem em log — usar `utils/safeLog`)

TrainingPlan  (existente)  → ganha:
  category TrainingCategory   // existentes viram PERFORMANCE
  scope    PlanScope          // existentes viram INDIVIDUAL
  studentId  String?  (hoje obrigatório → passa a opcional; SHARED não tem aluno)

PerformanceEvaluation       // avaliação do coach sobre o aluno (Rodada 5)
  id, studentId, coachId, score, notes, category?, createdAt
```

**Regra de acesso:** o aluno vê (a) os planos `SHARED` das categorias do plano ativo dele + (b) o plano `INDIVIDUAL` PERFORMANCE dele, se PERFORMANCE estiver incluída. Free segue `freeConfig`. O bloqueio por assinatura fica atrás da flag `enforceSubscriptionAccess`, **desligada até a Rodada 3** — não por causa de dados legados (são teste), mas porque enquanto não existir tela para atribuir plano (R3) ligar o bloqueio trancaria todo mundo. Na R3 o admin liga.

**Plano compartilhado (Core/LPO):** calendário próprio (não depende do `startDate` de cada aluno); progresso continua **por aluno** (`WorkoutLog`/`WorkoutSession`/`WorkoutSkip` já são por atleta e apontam para `Exercise`, que passa a ser compartilhado).

**Migração de schema:** `TrainingPlan.category` com default `PERFORMANCE` e `scope` com default `INDIVIDUAL` (campos novos com default — nenhuma linha existente quebra). Sem backfill de `Subscription`: os alunos atuais são teste e serão removidos (decisão #4).

## 3. Permissões

- **Coach:** CRUD dos próprios `SubscriptionPlan`; edita planos SHARED (Core/LPO) e INDIVIDUAL (Performance) dos próprios alunos; atribui plano a aluno; avalia aluno.
- **Admin:** tudo do coach, em qualquer coach; edita `CoachContract` (%); liga/desliga `enforceSubscriptionAccess`; vê assinaturas/receita de todos os coaches.
- **Atleta:** vê só o que o plano libera; nunca vê contrato/% do coach.
- Sempre com checagem de dono no controller (padrão `assertCanAccess` de `students.service.ts`), nunca só `@Roles`.

## 4. Riscos e pendências técnicas (não decididos)

1. **Gateway de assinatura recorrente com repasse por coach — decidir por spike (Rodada 4).** Duas rotas viáveis, a definir:
   - **Asaas (provável melhor encaixe técnico):** a **plataforma** cria a assinatura recorrente na conta Asaas dela e usa o **split** (`walletId` do coach + percentual) para repassar a parte do coach; o coach só precisa ter conta Asaas e informar o `walletId` — **não exige criar subconta por API** (importante: no AmoraRunning a criação de subconta Asaas esteve quebrada do lado deles em ago/2026). A plataforma seria a "vendedora" (responde por estorno/chargeback e emite a cobrança) — **implicação contratual a validar**. O dono aceita tanto "cada coach loga a conta Asaas dele e eu recebo na minha" quanto "uma conta Asaas só da PulseRx".
   - **Mercado Pago:** no AmoraRunning usamos Checkout Pro + `marketplace_fee` + OAuth do vendedor. **Não está confirmado** que a API de assinaturas (`preapproval`) aceita repasse/`marketplace_fee` do mesmo jeito. Alternativa: cobrança mensal por Checkout Pro gerada por job (link/Pix mensal).
   - O spike deve confirmar, em **sandbox**: recorrência, split com % por coach, webhook idempotente, cancelamento/upgrade/downgrade, inadimplência. O código Asaas do AmoraRunning está dormente e serve de ponto de partida (`api/src/services/asaas.service.ts` naquele repo).
2. **Prints citam Asaas/Stripe;** o dono aceitou **Asaas ou Mercado Pago** (decisão #3). Stripe está fora.
3. **Financeiro "joint venture 50/50", DRE, NF-e, escrow/contrato, chave PIX/CNPJ de recebimento:** envolvem contabilidade/jurídico (emissão de NFS-e, custódia, split). O que for **estimativa/relatório** entra; o que for **emissão fiscal ou custódia real** precisa de decisão jurídica/contábil e de um provedor — **não assumir**.
4. **LGPD (skill `validacao-lgpd-pre-producao` antes de produção):** cobrança, avaliação de desempenho, dados de pessoas físicas; a AEVON é operadora e o coach/plataforma controlador — deixar explícito.
5. **Carga adaptativa por PR** (kg calculado a partir do PR do atleta): depende de `PersonalRecord` (existe) e de regra de arredondamento definida pelo coach.
6. **Biometria (Face ID/Touch ID)** é recurso de app nativo/PWA (WebAuthn); tratar como Rodada própria.

## 5. Roadmap em rodadas (cada linha = um ou mais PRs pequenos, fluxo padrão: branch → CI → PR → dono mergeia)

| Rodada | Entrega | Depende de | Observação |
|---|---|---|---|
| **R1 — Fundação** | Schema aditivo (categoria/escopo/planos/assinaturas/contrato, gateway-agnóstico) + serviço de acesso + flag `enforceSubscriptionAccess` (desligada). Sem UI, sem backfill (alunos atuais são teste). | — | Baixo risco, base de tudo. |
| **R2 — Plano compartilhado** | Editor de plano Core/LPO (builder único por categoria) + visão do atleta por assinatura. | R1 | Reusa o Plan Builder atual. |
| **R3 — Assinaturas (manual)** | Tela de planos (coach/admin), atribuição individual, upgrade/downgrade, configuração do Free, contrato (%) pelo admin, ligar o bloqueio. | R1, R2 | Aqui o dono liga `enforceSubscriptionAccess`. |
| **R4 — Gateway (Asaas ou MP)** | Spike em sandbox (recorrência + split por coach) → decisão → credencial do coach, cobrança recorrente, webhook como fonte de verdade, %, dunning/inadimplência, trial→conversão. | R3 | Bloqueada pelo spike. |
| **R5 — Avaliação + chat** | Avaliação de desempenho; chat com filtros por plano (o módulo de mensagens já existe). | R1 | Independente de R4. |
| **R6 — Telas do atleta** | Assinatura/upgrade, Aulas (vídeos por plano com progresso), "Gestão". | R2, R3 | Conteúdo pago com upsell ("requer plano X"). |
| **R7 — Financeiro do coach/admin** | Painel de receita, churn, LTV, NPS, ledger e exportações (CSV/DRE como **relatório**). | R4 | Emissão de NFS-e/escrow só após decisão jurídica (§4.3). |
| **R8 — Construtor tático de WODs** | Periodização (ciclos), blocos, %1RM, RPE, carga adaptativa por PR, publicação agendada. | R2 | Evolução do Plan Builder. |
| **R9 — App: treino ativo e biometria** | Timer/haptics/RPE por série; login biométrico. | R8 | Depende de decisão PWA vs nativo. |

## 6. Como retomar

1. Ler `CLAUDE.md` de `backend/` e `frontend/` e a memória do projeto (rename, e-mail `@aevonfit.com` intocado, VPS fora de escopo).
2. Começar pela **R1**. Toda mudança de schema é **aditiva** (campo novo opcional/com default; `Subscription`/`SubscriptionPlan` são tabelas novas).
3. Antes de cada PR: `tsc`, lint, testes (`npm test` — usa `--experimental-vm-modules`, Node 24), `security-analyst`; LGPD antes de produção.
