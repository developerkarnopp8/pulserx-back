# CLAUDE.md — PulseRx Backend

> Arquivo mantido pelo Claude Code. Atualizar sempre que houver mudanças relevantes na arquitetura, dependências, comandos ou decisões de projeto.

> **Rename (2026-09-26):** o projeto se chamava AEVONFIT/AevonFit; agora é **PulseRx** (repo `pulserx-back`). O rename cobriu código, `package.json`, docker-compose de desenvolvimento, docs. **Domínio, CORS e `docker-compose.prod.yml` (nome dos containers/DB reais em produção) continuam com "aevonfit" até uma migração dedicada da VPS** — mudar isso agora quebraria o CORS/DNS reais sem um plano de janela de manutenção. **`@aevonfit.com` como domínio de e-mail (contas de coach/atleta/admin, prod e local) é mantido de propósito, por decisão do dono** — é só o domínio de e-mail interno, não faz parte da marca do produto; não renomear em nenhum ambiente, incluindo seed local.

> **CI/CD (2026-09-26):** `.github/workflows/ci.yml` criado do zero (lint + testes + build + CodeQL + `npm audit`). Restaurado `.eslintrc.js` (os pacotes ESLint 8/typescript-eslint 6 já estavam instalados, só faltava a config) — achado ao rodar: `training-plans/dto/training-plan.dto.ts` tinha o import de `IsUrl` nunca aplicado, ou seja, `CreateExerciseDto.youtubeUrl` aceitava qualquer valor sem validação de formato (corrigido, com teste cobrindo inclusive esquema `javascript:`). (A dívida do NestJS registrada aqui antes foi paga — ver o bloco "Upgrade NestJS 10→12" abaixo.)

> **Upgrade NestJS 10→12 (2026-09-26):** `@nestjs/common/core/platform-express/platform-socket.io/websockets/testing` 12.1, `swagger` 12.0, `config` 12.0, `jwt` 12.0, `passport` 12.0, `throttler` 6.7 (linha 6, suporta Nest 12), `@types/express` 5. **`npm audit --omit=dev`: 0 vulnerabilidades** (as 4 Altas de multer/qs/js-yaml/lodash fecharam); gate do CI voltou pra `--audit-level=high` e o `ignore` de `@nestjs/*` saiu do Dependabot (fica só `typescript`, `prisma` e `@prisma/client`). O que mudou de verdade, além de versões:
> - **Node 24 (Dockerfile `node:24-slim` e CI).** O Nest 12 é **ESM-only** (`"type": "module"`); o app continua compilando pra CommonJS e o Node carrega os pacotes via `require(esm)`. O `file-type` 22 (dependência de produção do `@nestjs/common`, usado pelo `addFileTypeValidator` do upload de PDF) exige Node ≥ 22, e o **Jest só carrega ESM via `require` no Node ≥ 24.9** — por isso Node 24 (LTS) e não 22.
> - **Testes rodam com `node --experimental-vm-modules node_modules/jest/bin/jest.js`** (scripts `test`, `test:watch`, `test:cov`). Sem a flag, todo spec que importa `@nestjs/*` falha com "Must use import to load ES Module". Não usar `jest` direto.
> - `@nestjs/schematics` ficou na **10** (a 12 exige TypeScript ≥ 6; é só o gerador do `nest g`, fora do build). Subir junto com a migração do TypeScript.
> - `JwtModule`: `expiresIn` agora é tipado como `number | StringValue`; o valor de `JWT_EXPIRES_IN` (string de env) leva cast em `auth.module.ts`.
> - **`HttpThrottlerGuard`** (`src/common/http-throttler.guard.ts`) substitui o `ThrottlerGuard` global: o guard padrão quebra em handlers de WebSocket (`Cannot read properties of undefined (reading 'header')`, derrubava o `@SubscribeMessage('ping')`); agora o rate limit vale só pra HTTP (o socket é autenticado por JWT na conexão). **Atenção:** mensagens WebSocket ficam sem rate limit — hoje o único handler é o `ping` (só responde `pong`) e o chat entra por REST (`POST /messages`, com throttler HTTP), então não há brecha; **qualquer `@SubscribeMessage` novo que faça trabalho de verdade precisa do próprio limite por socket**.
> - Upload de PDF ficou **mais rígido**: `addFileTypeValidator` agora confere os magic bytes (arquivo de texto declarado como `application/pdf` é barrado com 400; no Nest 10 só o mimetype era checado).
> - Validado em runtime (não só por testes, que mockam tudo): login/JWT (expira em 7d), guards de papel (401/403), ValidationPipe, upload de PDF (texto→400, PDF real→passa e cai na IA), CORS, WebSocket (`ping`→`pong`, token inválido desconecta, **push de chat em tempo real** coach→atleta), throttler (429 na 6ª tentativa de login), Swagger e a **imagem Docker de produção** (`npm ci --omit=dev`) subindo.

> **v2 — Rodada 1, fundação (2026-09-26):** spec e roadmap em `docs/superpowers/specs/2026-09-26-v2-categorias-assinaturas-design.md` (R1–R9). Schema **aditivo**: `TrainingCategory` (CORE/LPO/PERFORMANCE), `PlanScope` (SHARED/INDIVIDUAL), `SubscriptionPlan`, `Subscription` (uma por aluno), `CoachContract` (% da plataforma por coach — só admin edita, nunca exposto ao atleta), `PlatformSettings` (linha única `singleton`), `PaymentGateway` (MERCADO_PAGO|ASAAS — gateway ainda **não decidido**, spike na R4). `TrainingPlan` ganhou `category` (default `PERFORMANCE`) e `scope` (default `INDIVIDUAL`) e `studentId` virou **opcional** (plano SHARED pertence ao coach, não a um aluno) — planos existentes não mudam de comportamento. Módulo `src/subscriptions/`: `SubscriptionAccessService` (categorias liberadas pela assinatura; só `ACTIVE` e `TRIALING` não vencido dão acesso — carência de `PAST_DUE`/`CANCELED` é regra **não decidida**, fica bloqueado por ora) e `SubscriptionPlansService.ensureDefaultPlans` (Combo/Core/LPO/Free por coach; preço 0 e pagos inativos de propósito — não se inventa preço). **`PlatformSettings.enforceSubscriptionAccess` nasce `false`**: enquanto desligada, nada é limitado pela assinatura (comportamento pré-v2); liga-se na R3, quando existir tela pra atribuir plano. **R1 não expõe endpoint nem aplica o bloqueio em nenhuma rota** — o gate ainda não é chamado por ninguém (R2). **PRÉ-REQUISITO DA R2 (não esquecer):** com `TrainingPlan.studentId` opcional, todo código que deriva o dono do plano por `plan.studentId`/`plan.student.userId` **quebra com 500 num plano SHARED** (falha fechada — sem brecha, mas o atleta de um plano compartilhado não consegue ver/registrar/pular nada): `training-plans.service.ts` (`assertCanViewPlan`, `resolveAthleteIdForPlan`), `workout-logs.service.ts` (`loadExerciseContext` → `findOne(null)`), `workout-sessions.service.ts` (checkout), `workout-skips.service.ts` (alvo do skip). Antes de criar o primeiro plano SHARED por endpoint, trocar a checagem de dono desses pontos: **plano SHARED → coach dono do plano OU aluno cuja assinatura libera a categoria** (`SubscriptionAccessService.assertCanAccessCategory`), e cobrir com teste de IDOR (aluno sem a categoria, aluno de outro coach). O `pending-count` de skips já ignora `studentId` nulo. Hoje nenhum endpoint cria plano SHARED (o DTO exige `studentId` e `forbidNonWhitelisted` barra `category`/`scope`).

> **v2 — Rodada 2, backend do plano compartilhado (2026-09-26, branch `feat/v2-r2-plano-compartilhado`):** o pré-requisito da R1 foi pago. **`PlanAccessService`** (`src/subscriptions/plan-access.service.ts`) é a fonte única de "quem pode ver/usar este plano" — `resolveByPlanId/BySessionId/ByExerciseId` devolvem `{coachId, scope, category, studentId, athleteId, isCoach}` ou 403/404. Regras: coach só o dono (`plan.coachId`); aluno em plano INDIVIDUAL só o dono + categoria liberada pela assinatura; aluno em plano SHARED precisa ser aluno do coach dono (`student` com `userId`+`coachId`), plano **publicado** e categoria liberada; outros papéis 403; individual sem aluno falha fechado. Usado em `training-plans` (ver/`findByStudent`/`initializeWeeks`), `sessions.findById`, `workout-logs.logExercise`, `workout-sessions.checkout` e `workout-skips.create` — **nenhum deles lê mais `plan.studentId`/`plan.student.userId` direto**; quem escreve (log/checkout/skip) agora exige ser o aluno (coach → 403; antes o log do coach ficava no id dele). Progresso (`workoutLogs`/`workoutSkips`) sempre filtrado por um `athleteId`: o do aluno, ou o id do próprio coach num plano SHARED (volta vazio — nunca sem filtro). Novos endpoints (coach): `POST /training-plans/shared` (`CreateSharedPlanDto`: `category` só CORE/LPO — Performance é sempre individual —, `month`, `startDate`, `title`; `data` montado explícito) e `GET /training-plans/shared?category=`. `GET /training-plans/student/:id` para o **aluno** agora também devolve os SHARED publicados do coach dele, só das categorias liberadas (`SubscriptionAccessService.getViewableCategories`: todas enquanto `enforceSubscriptionAccess` estiver desligado). `publish` de SHARED notifica só os alunos que enxergam a categoria (`filterStudentsWithCategory`, em lote de 25). `pending-count` de skips e `sessionDetail` passaram a considerar plano SHARED (usam `skip.athleteId` / `plan OR shared do coach`). Edição de conteúdo (semana/dia/sessão/exercício) continua por `assertCoachOwnsPlan` (dono do plano) e funciona igual para SHARED. **Fail-open documentado:** com o bloqueio desligado, todo aluno do coach vê o SHARED publicado — regra: **ligar `enforceSubscriptionAccess` antes da primeira cobrança real (R3/R4)**. **Ainda sem UI:** o front (editor do plano compartilhado e visão do aluno) é a próxima entrega (R2-front). Observação fora do escopo: `POST /users` é público e aceita `role: coach` (auto-cadastro de coach) — confirmar se é intencional antes de produção.

> **v2 — R3 backend, assinaturas manuais (2026-09-26, branch `feat/v2-r3-assinaturas`, NÃO commitada — pausada a pedido do dono):** sem gateway ainda. **Catálogo** (`subscription-plans`, coach/admin): `GET/POST /subscription-plans` (admin passa `?coachId=`) e `PATCH /:id` — coach só o próprio; sem exclusão (desativa); o 1º `GET` cria os 4 planos-modelo com lock de aconselhamento do Postgres (evita duplicar em acessos simultâneos). Regras: Free não tem preço; pago exige ≥1 categoria; preço 0..R$ 10.000 em centavos; `freeConfig` só com os campos do DTO. **Atribuição** (`PUT/GET/DELETE /students/:studentId/subscription`, coach dono ou admin; `GET /subscriptions/me` para o aluno): o plano TEM de ser do mesmo coach do aluno (senão 404, inclusive p/ admin); plano inativo só para quem já está nele; `TRIALING` exige `trialEndsAt` futuro; `CANCELED` grava `canceledAt`; a resposta nunca traz `gateway`/`gatewaySubscriptionId`. **Admin:** `GET/PUT /admin/coaches/:id/contract` (% da plataforma 0–100, 2 casas; só admin, devolve só coachId+%) e `GET/PATCH /admin/platform-settings` (liga/desliga `enforceSubscriptionAccess`; ligar com alunos sem acesso — sem assinatura, PAST_DUE/CANCELED ou teste vencido — exige `confirmLockout`, senão 409 com a contagem). **Não implementado (decisão de negócio):** `freeConfig` (sessões-amostra etc.) só é armazenado — o Free hoje libera só as `categories` do plano (nasce com `[]`, então com o bloqueio ligado o Free não vê treino); carência de PAST_DUE/CANCELED continua bloqueando. Migration: nenhuma (modelos da R1). 272 testes, tsc, lint, build ok; security-analyst: 0 Crítico/Alto/Médio, 3 Baixos (2 corrigidos, 1 documentado acima). FALTA: front da R3 (tela de planos do coach, atribuir plano ao aluno, tela do admin p/ contrato % e bloqueio), conferir local com o dono, commit/PR.

> **Cobertura de testes 100% (2026-09-27, PR #74):** statements/branches/functions/lines em **todo arquivo**, exceto `*.module.ts` (DI/decorators puros) e `main.ts` (bootstrap) — mesma convenção já usada no AmoraRunning. Achado nesse trabalho: todo arquivo com `@Injectable`/`@Component` decorado sempre reporta 1 linha/branch "descoberto" na própria linha da declaração da classe — é código gerado pelo compilador do Nest (`ɵfac`) mapeado de volta pro source, **impossível de cobrir por teste**; tratar como o equivalente do `*.module.ts`, não é falta de teste real. Padrão firmado: instanciação direta da classe (`new Service(mockPrisma, ...)`), sem `Test.createTestingModule` a menos que o teste precise de DI de verdade; toda dependência mockada com `jest.fn()`.

> **Cloudinary + Resend (2026-09-27):** contas dedicadas ao PulseRx (separadas do AmoraRunning, por isolamento de quota/segurança). `src/common/cloudinary.service.ts` (`CloudinaryService.uploadImage`) e `src/common/email.service.ts` (`EmailService.send`, nunca lança — falha de e-mail não pode derrubar o fluxo que a disparou) são genéricos, reutilizáveis por qualquer módulo futuro. Env vars: `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`, `RESEND_API_KEY`/`EMAIL_FROM`. **Resend em modo de teste** (domínio não verificado): só entrega e-mail pro endereço da própria conta Resend — em dev, e-mail pra qualquer outro destinatário falha com 403 (`EmailService` loga e segue, não quebra o fluxo). Pra mandar e-mail de verdade pros usuários, precisa verificar um domínio em resend.com/domains.

> **Landing page pública do coach + cancelamento de assinatura (2026-09-27, PR #75):** dependia do Cloudinary/Resend acima. Módulo novo `src/coach-profile/`: `CoachProfile` (slug único kebab-case, bio, bannerUrl, published) e `Lead` (contato do visitante), schema aditivo. `CoachProfileController` (privado, role coach): `GET/PUT /coach-profile`, `PATCH /coach-profile/publish`, `POST /coach-profile/banner` (upload validado por magic bytes via `ParseFilePipeBuilder`, mesmo padrão do `pdf-import`). `PublicProfileController` (sem guard): `GET /public/coaches/:slug` (404 se não existe OU não está `published` — nunca diferencia os dois casos) e `POST /public/coaches/:slug/leads` (rate limit próprio 5/min, e-mail/nome do visitante sempre escapados via `escape-html.ts` antes de entrar no e-mail). Lead vira notificação in-app + e-mail pro coach. **Cancelamento**: `DELETE /subscriptions/me` (`SubscriptionsService.cancelMine`, role athlete) — muda o status pra `CANCELED` e grava `canceledAt` (mantém histórico, não apaga), notifica o coach. security-analyst: 0 Crítico/Alto/Médio, 3 Baixos aceitos (slug enumerável por natureza, rate limit por IP igual ao resto do projeto, upload sem otimização de imagem).

> **Landing page v2 — hero completo, depoimentos e FAQ (2026-09-27, PR #76):** estende o PR #75 com o resto do conteúdo de uma página de vendas real, a pedido do dono a partir de uma referência visual. **Decisão de escopo:** elementos genéricos do método (os "4 pilares" — periodização/cargas/vídeo/app —, o texto institucional) ficam **fixos no template**, não viram campo por coach; só o que é fato específico de cada coach virou dado real. `CoachProfile` ganhou `photoUrl` (foto pessoal, distinta do `bannerUrl` do hero), `headline`/`subheadline` (texto do hero — null usa o texto padrão do template), `quote`, `achievementBadge`, `yearsExperience`, `athletesCount`, `npsScore`/`completionRate` (métricas **autodeclaradas pelo coach**, sem verificação — mesma lógica de confiança já aplicada a bio/depoimentos), `whatsappNumber`, `videoUrl`. Dois models/CRUDs novos, escopados por `coachId` com checagem de dono em update/delete (`assertOwnsTestimonial`/`assertOwnsFaqItem`, testados como IDOR): `Testimonial` (depoimento cadastrado pelo **coach**, não é review verificado de aluno real) e `FaqItem`. `POST /coach-profile/photo` reusa a mesma validação de magic bytes do banner. `GET /public/coaches/:slug` devolve tudo isso. security-analyst: 0 achados bloqueantes (campos de texto livre do coach só por interpolação `{{ }}` no Angular, nunca `innerHTML`; link do WhatsApp sanitizado por regex; vídeo reaproveita o `YoutubeEmbedComponent` já auditado).

> **v2 — R4 backend, checkout com gateway real Asaas (2026-09-28, branch `feat/asaas-checkout-aluno`, ainda sem PR):** decisões de escopo confirmadas com o dono antes de codar: **aluno faz o próprio checkout** (não é o coach que assina por fora e o Asaas cobra depois) e **CPF só é pedido na hora do pagamento** (nunca no cadastro). Sem subconta/KYC pro coach — cada um só cadastra o próprio `walletId` Asaas já existente (`PUT/GET /subscriptions/wallet`, role coach, nunca o `:id` da URL); o split por cobrança usa `100 - platformFeePercent` (o % continua exclusivo do admin via `/admin/coaches/:id/contract`, nunca exposto ao coach/aluno). `src/common/asaas.service.ts` (client HTTP: createCustomer/createSubscription/cancelSubscription/listPaymentsBySubscription/getPayment, sandbox `api-sandbox.asaas.com` vs `api.asaas.com` por `ASAAS_ENV`, chave via `ASAAS_API_KEY` sem fallback); `src/common/cpf.ts` (dígito verificador, do zero); `src/common/safe-equal.ts` (`crypto.timingSafeEqual` pro token do webhook). `PUT /subscriptions/checkout` (`SubscriptionsService.checkout`, role athlete): plano Free é upsert direto; plano pago exige o coach ter `walletId`, pede/reusa CPF, cria/reusa `asaasCustomerId`, cria a assinatura real no Asaas (`billingType: 'PIX'` fixo pro MVP) e guarda o primeiro `GatewayPayment` (com `invoiceUrl` pro aluno pagar). `src/webhooks/` (`POST /webhooks/asaas`, público, sem JwtAuthGuard): autentica pelo header `asaas-access-token` via `safeEqual` contra `ASAAS_WEBHOOK_TOKEN` (**fail-closed** — sem a env var configurada, sempre 401); **nunca confia no corpo do evento**, sempre reconsulta o pagamento real (`asaas.getPayment`) antes de gravar status; idempotente via `upsert` por `asaasPaymentId`; `WebhookLog` nunca guarda o corpo cru (só provider/event/asaasPaymentId/processedAt, mesma lição do achado LGPD do `WebhookLog` do AmoraRunning — aqui já nasce sem esse problema). Testado contra a API real do Asaas sandbox (não só mocks): checkout sem CPF barrado, checkout com CPF válido criou customer real e falhou limpo (400, sem 500) na wallet de teste inválida; webhook sem header/header errado → 401, header certo + paymentId inexistente reconsultou a Asaas de verdade e devolveu 400 sem crashar. **security-analyst achou 3 problemas reais, todos corrigidos nesta mesma branch antes do PR:** (1) Alto — `checkout()` não cancelava a assinatura Asaas anterior antes de criar uma nova; duplo clique/retry/troca de plano/downgrade pro Free deixava uma cobrança recorrente órfã rodando pra sempre sem aparecer em lugar nenhum — corrigido com lock de aconselhamento do Postgres por aluno (mesmo padrão do `ensureDefaultPlans`) + cancelamento da assinatura antiga ANTES de criar a nova, fail-closed (se o cancelamento falhar, o checkout inteiro falha em vez de arriscar duplicar cobrança); (2) Alto — o `cpf`/`asaasCustomerId` novos no `Student` vazavam em claro pro coach via `GET /students`, `GET /students/:id` e `PATCH /students/:id` (queries antigas em `students.service.ts` sem `select`, herdavam os campos novos do schema) — corrigido com `select` explícito (`STUDENT_SAFE_SELECT`) que nunca inclui os dois campos, essas rotas nunca precisaram deles; (3) Médio — `checkout` caía só no throttler geral (30/min) — ganhou limite próprio (`@Throttle` 5/min), consistente com auth/pdf-import/leads. **FALTA:** frontend (nenhuma UI de checkout/carteira ainda existe), auditoria LGPD dedicada (CPF é dado pessoal novo — regra do projeto exige rodar antes de produção), registrar a URL do webhook na Asaas (precisa de endpoint público alcançável — decidir com o dono como testar isso localmente, Asaas não alcança `localhost`), conferir com o dono, commit/PR.

## Visão Geral

**PulseRx** é uma plataforma SaaS para gestão de academias. O backend expõe uma API REST consumida pelo frontend Angular e (futuramente) por apps mobile.

## Tech Stack

| Camada | Tecnologia |
|--------|------------|
| Runtime | Node.js 24 (LTS) |
| Framework | NestJS (TypeScript) |
| ORM | Prisma |
| Banco de dados | PostgreSQL 16 |
| Cache / Filas | Redis 7 + BullMQ |
| Auth | JWT (access + refresh tokens) |
| Armazenamento | AWS S3 / Cloudflare R2 |
| Email | Resend |
| Pagamentos | Stripe / MercadoPago |
| Documentação | Swagger (OpenAPI) |
| Deploy | Docker Compose |

## Estrutura de Diretórios

```
backend/
├── src/
│   ├── app.module.ts
│   ├── main.ts
│   ├── prisma/                  # PrismaService + PrismaModule (global)
│   ├── auth/                    # JWT + Passport Local, login endpoint
│   │   ├── strategies/          # local.strategy.ts, jwt.strategy.ts
│   │   ├── guards/              # jwt-auth.guard.ts, roles.guard.ts
│   │   └── decorators/          # @Roles()
│   ├── users/                   # POST /users, GET /users/me
│   ├── students/                # CRUD alunos + GET /students/:id/plan
│   ├── training-plans/          # CRUD plano + weeks + days + sessions + exercises
│   ├── sessions/                # GET /sessions/:id (com logs do atleta)
│   ├── workout-logs/            # POST log, GET history, GET session logs, GET history por aluno (coach)
│   ├── workout-skips/           # Atleta pula exercício/sessão com justificativa
│   ├── daily-intake/            # Log de hidratação/calorias do atleta
│   ├── movements/               # Catálogo de movimentos (global + customizado por coach)
│   ├── personal-records/        # Registro de PR/1RM do atleta (log-por-evento)
│   ├── exercise-library/        # Biblioteca de exercícios reutilizáveis do coach
│   ├── payments/                # Cobranças do coach aos alunos
│   └── messages/                # Chat coach↔atleta (REST + WebSocket)
├── prisma/
│   ├── schema.prisma            # Modelos: User, Student, TrainingPlan, Week, TrainingDay, Session, Exercise, WorkoutLog
│   ├── migrations/
│   └── seed.ts                  # Seed: coach + atleta + plano semana 1
├── .env.example
├── nest-cli.json
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

## Comandos Principais

```bash
# Desenvolvimento
npm run start:dev

# Build
npm run build

# Banco de dados
npx prisma generate          # Gerar Prisma client
npx prisma migrate dev       # Aplicar migrations
npx prisma studio            # Interface visual do banco
npm run prisma:seed          # Popular banco com dados iniciais

# Docker (banco + redis localmente)
docker compose up db redis -d
docker compose up -d         # Tudo (API + DB + Redis)

# Testes
npm run test
npm run test:e2e

# Lint
npm run lint
```

## Variáveis de Ambiente

Copie `.env.example` → `.env` antes de rodar localmente.

Variáveis obrigatórias:
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `JWT_SECRET` — Secret para tokens JWT
- `JWT_REFRESH_SECRET` — Secret para refresh tokens

## Módulos de Domínio

| Módulo | Endpoints principais |
|--------|----------------------|
| auth | POST /auth/login |
| users | POST /users, GET /users/me |
| students | GET /students, GET /students/me, GET /students/:id, GET /students/:id/plan, POST /students, PATCH /students/:id, DELETE /students/:id |
| training-plans | GET /training-plans/:id, GET /training-plans/student/:studentId, GET /training-plans/coach/weekly-completion (dashboard, % real de conclusão por dia da semana entre os alunos do coach), POST /training-plans (exige `startDate`, normalizado pro backend pra Segunda-feira da semana), PATCH /training-plans/:id/publish, POST /training-plans/:id/initialize, + weeks/days/sessions/exercises CRUD |
| sessions | GET /sessions/:id (inclui exercícios + último log do atleta, e workoutSkips filtrado por dono do plano) |
| workout-logs | POST /workout-logs, GET /workout-logs/history, GET /workout-logs/session/:id, GET /workout-logs/exercise/:id, GET /workout-logs/student/:studentId/history (coach dono, via `StudentsService.findOne`) |
| workout-skips | POST /workout-skips (atleta pula exercício/sessão com motivo, envia mensagem automática pro coach), GET /workout-skips/pending-count (coach, contagem de pulos pendentes por aluno) |
| daily-intake | POST /daily-intake/hydration, POST /daily-intake/calories, GET /daily-intake/today, GET /daily-intake/student/:studentId/history (coach dono) |
| movements | GET /movements (catálogo global + customizado do coach do usuário), POST /movements (`@Roles('coach')`) |
| personal-records | POST /personal-records (`@Roles('athlete')`, exige loadKg e/ou reps), GET /personal-records/me, GET /personal-records/student/:studentId/history (coach dono) |
| exercise-library | CRUD de exercícios reutilizáveis do coach (GET/POST/PATCH/DELETE) |
| payments | GET /payments, GET /payments/summary, GET /payments/student/:studentId, POST /payments, PATCH /payments/:id/pay, PATCH /payments/:id, DELETE /payments/:id |
| messages | GET /messages/inbox, GET /messages/unread, GET /messages/:otherId, POST /messages — WebSocket namespace `/messages` para real-time |
| admin | GET /admin/coaches, POST /admin/coaches, POST /admin/coaches/:id/reset-password (gera senha forte, mostrada uma vez), PATCH /admin/coaches/:id (só aiImportEnabled) — tudo atrás de @Roles('admin') |
| coach-profile | GET/PUT /coach-profile, PATCH /coach-profile/publish, POST /coach-profile/banner (privado, coach) — GET /public/coaches/:slug, POST /public/coaches/:slug/leads (público, sem auth) |

## Modelo de Dados

```
User (coach|athlete|admin)
└── Student (vinculado a um User atleta + coachId)
    └── TrainingPlan (month ordinal + startDate real, normalizado pra Segunda-feira, publicado?)
        └── Week (semana 1..N — sem data própria, derivada de startDate + weekNumber)
            └── TrainingDay (Terça, Quarta... dayIndex 1-6, sem data própria)
                └── Session (Mobilidade, LPO, Força, Metcon... com type enum)
                    └── Exercise (sets, reps, duration, restSeconds, loadPercent, coachNotes)
                        └── WorkoutLog (quando o atleta executa — setsCompleted, notes, completedAt)

Movement (catálogo global ou customizado por coach — coachId opcional)
└── PersonalRecord (atleta registra PR/1RM — loadKg e/ou reps, log-por-evento)
```

`User.aiImportEnabled`: Boolean, default true — só relevante pra role coach, liga/desliga a importação de PDF via IA daquele coach (controlado pelo painel admin).

## Decisões Arquiteturais

- **JWT via Passport**: `LocalStrategy` valida email/senha; `JwtStrategy` valida Bearer token — payload: `{ sub: userId, email, role, name }`
- **`req.user.id`**: controllers usam `req.user.id` (não `.sub`) — o JwtStrategy faz o mapeamento de `payload.sub → id`
- **WebSocket (MessagesGateway)**: usa `payload.sub` diretamente (não `payload.id`) para identificar o usuário conectado
- **PrismaModule global**: `isGlobal: true` — qualquer módulo pode injetar `PrismaService` sem reimportar
- **Cascade deletes**: todas as relações têm `onDelete: Cascade` — deletar plano remove tudo abaixo
- **Estrutura flat de módulos**: todos em `src/<modulo>/` diretamente, sem pasta `modules/`

## Convenções de Código

- Cada módulo segue: `controller` → `service` → `PrismaService` (sem camada repository separada)
- DTOs com `class-validator` para validação de entrada
- `req.user` vem do `JwtStrategy.validate()` → `{ id, email, role, name }`

## API

- Base URL local: `http://localhost:3000/api`
- Swagger UI: `http://localhost:3000/api/docs`

---

_Última atualização: 2026-09-28 — R4 backend: checkout real com gateway Asaas (branch `feat/asaas-checkout-aluno`, sem PR ainda), CPF coletado só na hora do pagamento, webhook fail-closed, 3 achados do security-analyst corrigidos na própria branch (assinatura órfã, CPF vazando pro coach, rate limit do checkout). Anterior: 2026-09-27 (2) — landing page v2: hero completo, credenciais, depoimentos e FAQ (PR #76). Anterior: 2026-09-27 — landing page pública do coach + cancelamento de assinatura (PR #75), Cloudinary/Resend integrados, cobertura de testes 100% em todo o backend (PR #74). Anterior: 2026-09-26 (3) — upgrade NestJS 10→12 (Node 24, Jest com vm-modules, HttpThrottlerGuard, audit gate em `high`). Anterior: 2026-09-26 (2) — CI/CD seguro (lint restaurado, CodeQL, npm audit — gate em `critical` até o upgrade do NestJS), fix de validação em `youtubeUrl`. Anterior: 2026-09-26 — rename AEVONFIT → PulseRx (código, package.json, docker-compose dev, docs; VPS/domínio/DB de produção ficam para depois). Anterior: 2026-08-28 — adicionado o papel admin, módulo /admin, e o campo User.aiImportEnabled._
