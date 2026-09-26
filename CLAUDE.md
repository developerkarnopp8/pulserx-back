# CLAUDE.md — PulseRx Backend

> Arquivo mantido pelo Claude Code. Atualizar sempre que houver mudanças relevantes na arquitetura, dependências, comandos ou decisões de projeto.

> **Rename (2026-09-26):** o projeto se chamava AEVONFIT/AevonFit; agora é **PulseRx** (repo `pulserx-back`). O rename cobriu código, `package.json`, docker-compose de desenvolvimento, docs. **Domínio, CORS e `docker-compose.prod.yml` (nome dos containers/DB reais em produção) continuam com "aevonfit" até uma migração dedicada da VPS** — mudar isso agora quebraria o CORS/DNS reais sem um plano de janela de manutenção. **`@aevonfit.com` como domínio de e-mail (contas de coach/atleta/admin, prod e local) é mantido de propósito, por decisão do dono** — é só o domínio de e-mail interno, não faz parte da marca do produto; não renomear em nenhum ambiente, incluindo seed local.

> **CI/CD (2026-09-26):** `.github/workflows/ci.yml` criado do zero (lint + testes + build + CodeQL + `npm audit`). Restaurado `.eslintrc.js` (os pacotes ESLint 8/typescript-eslint 6 já estavam instalados, só faltava a config) — achado ao rodar: `training-plans/dto/training-plan.dto.ts` tinha o import de `IsUrl` nunca aplicado, ou seja, `CreateExerciseDto.youtubeUrl` aceitava qualquer valor sem validação de formato (corrigido, com teste cobrindo inclusive esquema `javascript:`). **Dívida técnica pendente, decisão do dono:** `npm audit --omit=dev` tem 4 Altas reais em produção (`multer`/`qs`/`js-yaml`/`lodash`, puxadas por `@nestjs/platform-express`/`@nestjs/swagger`/`@nestjs/config` — DoS e prototype pollution, não RCE) que só fecham com **NestJS 10→12 (major, breaking change)** — fora do escopo do CI. O gate do CI hoje trava em `--audit-level=critical` (não `high`) até essa migração acontecer; reapertar pra `high` quando o upgrade for feito. **`.github/dependabot.yml` ignora majors de `@nestjs/*` e `typescript` pelo mesmo motivo (PR isolado falha no CI) — TEMPORÁRIO: remover esse `ignore` junto com a migração do NestJS 10→12.** Os alertas de segurança do Dependabot (30 abertos em 2026-09-26) continuam visíveis em Security → Dependabot independente do `ignore`.

> **v2 — Rodada 1, fundação (2026-09-26):** spec e roadmap em `docs/superpowers/specs/2026-09-26-v2-categorias-assinaturas-design.md` (R1–R9). Schema **aditivo**: `TrainingCategory` (CORE/LPO/PERFORMANCE), `PlanScope` (SHARED/INDIVIDUAL), `SubscriptionPlan`, `Subscription` (uma por aluno), `CoachContract` (% da plataforma por coach — só admin edita, nunca exposto ao atleta), `PlatformSettings` (linha única `singleton`), `PaymentGateway` (MERCADO_PAGO|ASAAS — gateway ainda **não decidido**, spike na R4). `TrainingPlan` ganhou `category` (default `PERFORMANCE`) e `scope` (default `INDIVIDUAL`) e `studentId` virou **opcional** (plano SHARED pertence ao coach, não a um aluno) — planos existentes não mudam de comportamento. Módulo `src/subscriptions/`: `SubscriptionAccessService` (categorias liberadas pela assinatura; só `ACTIVE` e `TRIALING` não vencido dão acesso — carência de `PAST_DUE`/`CANCELED` é regra **não decidida**, fica bloqueado por ora) e `SubscriptionPlansService.ensureDefaultPlans` (Combo/Core/LPO/Free por coach; preço 0 e pagos inativos de propósito — não se inventa preço). **`PlatformSettings.enforceSubscriptionAccess` nasce `false`**: enquanto desligada, nada é limitado pela assinatura (comportamento pré-v2); liga-se na R3, quando existir tela pra atribuir plano. **R1 não expõe endpoint nem aplica o bloqueio em nenhuma rota** — o gate ainda não é chamado por ninguém (R2). **PRÉ-REQUISITO DA R2 (não esquecer):** com `TrainingPlan.studentId` opcional, todo código que deriva o dono do plano por `plan.studentId`/`plan.student.userId` **quebra com 500 num plano SHARED** (falha fechada — sem brecha, mas o atleta de um plano compartilhado não consegue ver/registrar/pular nada): `training-plans.service.ts` (`assertCanViewPlan`, `resolveAthleteIdForPlan`), `workout-logs.service.ts` (`loadExerciseContext` → `findOne(null)`), `workout-sessions.service.ts` (checkout), `workout-skips.service.ts` (alvo do skip). Antes de criar o primeiro plano SHARED por endpoint, trocar a checagem de dono desses pontos: **plano SHARED → coach dono do plano OU aluno cuja assinatura libera a categoria** (`SubscriptionAccessService.assertCanAccessCategory`), e cobrir com teste de IDOR (aluno sem a categoria, aluno de outro coach). O `pending-count` de skips já ignora `studentId` nulo. Hoje nenhum endpoint cria plano SHARED (o DTO exige `studentId` e `forbidNonWhitelisted` barra `category`/`scope`).

## Visão Geral

**PulseRx** é uma plataforma SaaS para gestão de academias. O backend expõe uma API REST consumida pelo frontend Angular e (futuramente) por apps mobile.

## Tech Stack

| Camada | Tecnologia |
|--------|------------|
| Runtime | Node.js 20+ |
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

_Última atualização: 2026-09-26 (2) — CI/CD seguro (lint restaurado, CodeQL, npm audit — gate em `critical` até o upgrade do NestJS), fix de validação em `youtubeUrl`. Anterior: 2026-09-26 — rename AEVONFIT → PulseRx (código, package.json, docker-compose dev, docs; VPS/domínio/DB de produção ficam para depois). Anterior: 2026-08-28 — adicionado o papel admin, módulo /admin, e o campo User.aiImportEnabled._
