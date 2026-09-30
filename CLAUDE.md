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

> **LGPD — consentimento de saúde + aceite dos termos (decisões do dono, 2026-09-30, branch `feat-consentimento-saude`):** dado de saúde
> (Art. 11) no PulseRx = pulo de treino com motivo **"Lesão / dor"**, a **observação livre** do pulo (e as cópias automáticas dela na
> mensagem ao coach e na notificação) e o que o aluno escrever no chat. Decisões: (1) consentimento **opcional** — sem ele o aluno usa o app,
> mas o pulo **não oferece "Lesão / dor" nem observação** (a API recusa também); (2) pedido **na inscrição** (caixa própria, desmarcada,
> separada dos termos) e **no próximo login** de quem já tem conta — a mesma tela pede o **aceite dos termos** (item 2 da LGPD: alunos
> criados pelo coach nunca aceitaram; e toda troca de `TERMS_VERSION` pede de novo); (3) **retirar** (no Perfil, a qualquer momento): os pulos
> continuam registrados, mas o motivo "Lesão" vira **"removido a pedido do aluno"** (valor próprio `Withheld` — não se inventa outro motivo)
> e as observações são apagadas, inclusive nas mensagens/notificações automáticas geradas pelo pulo; (4) **chat**: quem não consentiu vê um
> aviso para não enviar dados de saúde. Atleta com termos desatualizados recebe 403 `TERMS_PENDING` em toda rota (exceto as do consentimento);
> a versão aceita vai no JWT (`tv`) e aceitar devolve um token novo.
>
> **Implementação (mesma branch, 2026-09-30):** `src/common/terms.ts` (`TERMS_VERSION = '2026-09-30'` — trocar = todo aluno aceita de novo);
> `JwtAuthGuard` barra atleta com `tv` diferente (403 `TERMS_PENDING`), exceto rotas com `@AllowPendingTerms()`; módulo `src/consents/`
> (`GET/PUT /consents/me`, `PATCH /consents/me/health`, só atleta, sempre pelo `req.user.id`). `User.healthConsent Boolean?` (null = nunca
> respondeu) + `healthConsentAt`; enum `SkipReason.Withheld` (o DTO do pulo aceita só os 4 motivos do aluno). Texto do pulo tem **fonte única**
> em `workout-skips/skip-message.ts` (`buildSkipMessage`/`scrubSkipText`) — a limpeza desfaz exatamente esse formato e só toca mensagens
> `isSystem` DO aluno e notificações `workout_skipped` com o link do plano DELE. Observação vazia/só espaços = sem observação (achado no ataque
> ao vivo). **Armadilha:** `npm run lint` roda `eslint --fix` e o Prettier sem `.prettierrc` troca TODAS as aspas simples por duplas — reformatou
> 40 arquivos que eu não tinha tocado; revertido. Não rodar `npm run lint` sem conferir `git status` depois (ou criar o `.prettierrc` com
> `singleQuote` num PR próprio). Validação: back 774 testes, 100% (fora module/main); front 592, mutação manual 18/18 (back+front), ataque ao vivo 45/45
> cruzado com o banco. security-analyst: 0 Crítico/Alto; **Médio em aberto** — pulos com "Lesão"/observação gravados antes deste PR só são
> limpos quando o aluno responde "não" (até lá o coach ainda os vê); Baixo aceito — corrida entre pulo com lesão e retirada simultânea (retirar
> de novo limpa). **Produção:** schema novo (2 colunas + 1 valor de enum) entra na pendência de estratégia de schema de produção.
>
> **Decisão do dono sobre o Médio acima (2026-09-30): opção 2 — fica como está** (o dado antigo só some quando o aluno responde "não").

> **LGPD item 3 — desvincular e excluir conta (decisões do dono, 2026-09-30, branch `feat-lgpd-exclusao-termo-coach`):** exclusão pelo
> **próprio aluno** (Perfil, com a senha) **e pelo admin** (pedido por e-mail); **anonimizar guardando só o fiscal**; o "remover aluno" do coach
> virou **"desvincular"** (não apaga a conta). Implementação:
> - `Student.unlinkedAt` (vínculo encerrado) e `User.deletedAt` (conta anonimizada). **Toda consulta de aluno filtra `ACTIVE_STUDENT`**
>   (`common/student-scope.ts`) ou declara `inclui desvinculados` no comentário — `student-scope.spec.ts` varre o código e falha se alguém
>   esquecer. Plano individual de ex-aluno = 404 no `PlanAccessService`.
> - `JwtStrategy.validate` agora consulta o banco a cada requisição: conta excluída → 401 "Sessão encerrada" (antes o token valia 7 dias);
>   aluno desvinculado → `unlinked` e o `JwtAuthGuard` responde 403 `UNLINKED` fora das rotas `@AllowUnlinked()` (só `POST /account/delete`).
> - `SubscriptionsService.endSubscription`: **cancela no Asaas antes** (falhou = nada muda) e marca CANCELED mantendo assinatura e cobranças.
>   Usado por desvincular, excluir conta e `DELETE /students/:id/subscription`. **Bugs de cobrança órfã corrigidos (existiam no main):** remover
>   aluno apagava a conta sem cancelar no Asaas (e levava o histórico fiscal junto); remover assinatura idem; trocar o plano à mão de quem paga
>   pelo app deixava o Asaas cobrando o antigo (agora 409); o checkout não pede mais para cancelar de novo uma assinatura já cancelada.
> - `DELETE /students/:id` = desvincular. `POST /account/delete {password}` (aluno, 5/15 min). Admin: `GET /admin/athletes?email=` (e-mail
>   exato) e `POST /admin/athletes/:id/anonymize`. Anonimizar (`account/account.service.ts`) apaga treinos/logs/pulos/hidratação/calorias/PRs/
>   movimentos próprios/planos individuais, mensagens, notificações dele e as do coach que citam nome/e-mail/plano dele, leads com o mesmo
>   e-mail; limpa CPF/id do Asaas; troca nome/e-mail (`Aluno removido`, `removido-<id>@anonimo.invalid`) e inutiliza a senha. Assinatura,
>   `GatewayPayment` e `Payment` ficam.
> - **`POST /messages` passou a exigir vínculo ativo aluno↔coach** (antes qualquer usuário escrevia para qualquer id, e o coach seguia
>   escrevendo ao ex-aluno).
> - Validação: 824 testes, 100%; mutação 22/22; ataque ao vivo 48/48 cruzado com o banco (+ regressão do item 1+2 45/45). **Erro meu no
>   caminho:** a 1ª rodada do ataque estourou o limite de login (5/15 min) e dois casos "passaram" com 401 por falta de sessão — o script agora
>   aborta sem token e cria alunos pela inscrição pública. security-analyst: 0 Crítico/Alto/Médio; Baixos aceitos: leads apagados por e-mail sem
>   confirmação de e-mail (fecha com a confirmação), notificações de homônimo do mesmo coach, cadastro do aluno continua no Asaas (registro de
>   pagamento), socket aberto não cai (nada mais chega). Limitação: ex-aluno desvinculado não pode ser recadastrado com o mesmo e-mail.
> - **Produção:** mais 2 colunas (`users.deletedAt`, `students.unlinkedAt`) na pendência de schema.

> **LGPD item 4 — Termo do Coach (decisão do dono, 2026-09-30, branch `feat-lgpd-termo-coach`):** o painel fica **bloqueado até o coach
> aceitar** a versão atual. `COACH_TERMS_VERSION = 'coach-2026-09-30'` (`common/terms.ts`), gravado no mesmo `User.termsVersion` com
> prefixo próprio (a versão dos termos do aluno não vale para o coach). `JwtAuthGuard`: coach sem a versão no token → 403
> `COACH_TERMS_PENDING` fora de `@AllowPendingTerms()`; admin não é barrado. `GET/PUT /coach-terms/me` (`consents/coach-terms.controller.ts`,
> só coach; `PUT {acceptTerms: true}` grava data+versão e devolve token novo). Login do coach responde `termsPending`. Coach criado pelo admin
> aceita no 1º acesso. **Texto = rascunho para revisão de advogado** (no front, `legal-content.ts`, doc `termo-coach`, página pública
> `/termo-coach`): finalidade, sigilo, dados de saúde, segurança da conta, incidentes ("imediatamente" — sem prazo inventado), direitos dos
> alunos, fim do vínculo, descumprimento, atualizações; **não afirma o papel LGPD de cada parte** (controlador/operador), decisão jurídica.
> Mudou o texto → trocar a versão. Validação: back 836 testes 100%, mutação 12/12, ataque ao vivo 22/22 (+ regressão do item 3 48/48),
> security-analyst sem achados. Sem schema novo.

> **Banco de produção — migrations (decisão do dono, 2026-09-30, branch `chore-migration-producao`):** de 26/09 a 30/09 o schema mudou
> só por `db push` local e produção ficou 2 migrations atrás. Conferido na VPS (só leitura): produção tem 10 migrations aplicadas, checksums
> iguais aos do repo e estrutura idêntica a elas. Criada **`20260930200000_landing_asaas_lgpd`** (tudo desde a migration 11, só aditivo),
> gerada por `prisma migrate diff` entre o schema do commit da migration 11 e o atual e validada de 3 formas: 12 migrations do zero = schema
> atual; migrations 11+12 sobre a estrutura de produção com dados fictícios (dados preservados); `prisma migrate deploy` real com o histórico
> de produção → "up to date". **Regra daqui para frente: mudou o `schema.prisma`, gera migration no mesmo PR** — o job de CI "Migrations em
> dia com o schema" falha se não gerar. Passo a passo de deploy (backup → rsync limpo → build → `migrate deploy` ANTES de trocar o container →
> smoke) em **`docs/DEPLOY_PRODUCAO.md`**. Banco local: `npx prisma migrate resolve --applied <nome>` quando a mudança já foi aplicada por `db push`.

> **Painel do admin — PR 1 financeiro por coach (pedido do dono, 2026-09-30, branch `feat-admin-financeiro-coach`):** `GET /admin/financial`
> (`AdminService.financialOverview`, lógica pura em `admin/financial-months.ts`): cobranças PAGAS do Asaas por coach e por mês do pagamento
> (atual + 5 anteriores) e o total da plataforma, com a MESMA conta do Financeiro do coach (`paymentBreakdown`: bruto → taxa do Asaas →
> AEVON pelo % gravado na assinatura → coach); corte de mês no fuso do servidor, igual ao `getMonthlyBreakdown`. **Correção:** o
> `listCoaches` calculava o repasse sobre o BRUTO e com o % ATUAL do contrato — agora usa a conta real (+ `gatewayFee`, `pendingBreakdown`).
> Cobranças de alunos desvinculados/excluídos continuam contando (registro fiscal). PR 2 (depois): assinaturas/MRR por coach, alertas,
> uso (com registro novo de último login e de planos importados por IA — decisão do dono).
>
> **PR 2 (branch `feat-admin-assinaturas-alertas-uso`):** `GET /admin/coaches` ganhou `subscriptions` (ativas/teste/inadimplentes/canceladas/
> sem plano + MRR = ACTIVE+TRIALING, igual ao Financeiro do coach; só alunos ativos), `alerts` (`NO_CONTRACT` % ≤ 0, `NO_WALLET` sem
> `gatewayAccountRef`, `PAGE_UNPUBLISHED`) e `usage` (planos, `importedByAi`, sessões `Completed` nos últimos 30 dias, `lastLoginAt`, última
> edição de plano). Lógica pura em `admin/coach-insights.ts`. Schema: `User.lastLoginAt` (gravado no login com senha — falha nunca bloqueia) e
> `TrainingPlan.importedByAi` (marcado no pdf-import), migration `20260930201153_admin_uso_login_importacao` (aditiva). Antes de 30/09 = sem registro.

> **Senha e e-mail (decisões do dono, 2026-09-30):** (1) **Esqueci minha senha** = link por e-mail, **uso único, vale 1 hora**; trocar a
> senha derruba as sessões abertas; a resposta é sempre a mesma (não revela quem tem conta). (2) **Confirmação de e-mail BLOQUEIA a entrada**
> até confirmar; **contas que já existem contam como confirmadas** (o bloqueio vale para as criadas depois do deploy). (3) Contas criadas pelo
> **coach (aluno) e pelo admin (coach)** recebem e-mail **"crie sua senha"** (mesmo link do Esqueci minha senha) — criar a senha pelo link
> confirma o e-mail; ninguém mais passa senha por WhatsApp. (4) **Coach reseta a senha do aluno enviando o link por e-mail.** (5) Redesign do
> painel do coach espera os mockups; cartão com débito automático começa por um estudo do Asaas (sem código). **Tudo isso depende do domínio
> verificado no Resend** (hoje só entrega ao dono da conta): o bloqueio da confirmação NÃO pode ir para produção antes do domínio.
> Entrega: PR A (esqueci senha + reset pelo coach), PR B (confirmação + boas-vindas), C (estudo do cartão).
>
> **PR A — senha por e-mail (branch `feat-senha-por-email`):** tabela `auth_tokens` (finalidade RESET_PASSWORD/SET_PASSWORD/VERIFY_EMAIL,
> só o SHA-256 do token, `expiresAt`, `usedAt`) e `User.passwordChangedAt` (migration `20260930203625_tokens_por_email`). `POST
> /auth/forgot-password` (3/15 min por IP; resposta sempre igual; o envio roda em segundo plano para o tempo de resposta não revelar a conta),
> `POST /auth/reset-password` (10/15 min; uso único com trava otimista; invalida os outros links; grava `passwordChangedAt`) e `POST
> /students/:id/password-reset` (coach dono, vínculo ativo, 5/15 min). `JwtStrategy` recusa token com `iat` anterior à troca de senha. Link =
> `${APP_URL}/redefinir-senha#token=…` (fragmento: não vai a log nem Referer); `APP_URL` vem da configuração, NUNCA do cabeçalho (em produção
> fica no compose). Fora de produção o link também vai para o log (o Resend sem domínio verificado só entrega ao dono). Validação: 888 testes
> 100%, mutação 9/9 (a 1ª rodada deixou sobreviver "esperar o envio antes de responder" — teste novo), ataque ao vivo 18/18. Baixo aceito:
> alguém com vários IPs pode encher a caixa de uma vítima de e-mails de "nova senha" (limite é por IP).
>
> **PR B — confirmação de e-mail + boas-vindas (branch `feat-confirmar-email`, empilhada sobre a A):** `User.emailVerifiedAt`
> (migration `20260930205619_email_confirmado`, que marca **todas as contas existentes como confirmadas** — decisão do dono). Login com
> senha certa e e-mail não confirmado → 403 `EMAIL_NOT_VERIFIED` (senha errada continua 401: não revela a conta). **Inscrição pela landing
> não devolve mais sessão**: responde `{pendingVerification, email}` e manda o link `${APP_URL}/confirmar-email#token=…&c=<slug>&plano=<id>`
> (48 h, uso único; o front confirma só no clique — antivírus que abre links não gasta o link — e volta ao pagamento do plano). `POST
> /auth/verify-email` (10/15 min; trava otimista; abre a sessão = prova de posse do e-mail, igual ao reset) e `POST
> /auth/resend-verification` (3/15 min; resposta sempre igual; envio em segundo plano; link sem plano). **Coach cadastra aluno sem senha**
> (`CreateStudentDto` sem `password` — mandar o campo dá 400; senha interna aleatória; e-mail "crie sua senha" de 7 dias, `SET_PASSWORD`;
> `POST /students` com limite próprio de 20/h, porque cada cadastro manda e-mail). **Admin cria coach sem senha** (mesmo e-mail) e o "resetar
> senha" do admin virou **"enviar link de nova senha"** (1 h; a senha atual vale até o coach trocar). Criar a senha por qualquer link confirma o
> e-mail. Scripts (`seed`, `create-first-admin`, `seed-production`) criam contas já confirmadas. Helper `issueEmailToken` (`auth/email-tokens.ts`)
> é a fonte única de criação de link. Validação: back 921 testes 100%, front 695; mutação back 14/14 (a 1ª rodada deixou sobreviver "senha fixa
> no cadastro" — teste novo), front 6/6; ataque ao vivo 31/31 cruzado com o banco. **Ordem de deploy: back e front juntos** (o front antigo
> mandaria `password` no cadastro de aluno → 400; a inscrição antiga esperaria sessão). security-analyst: 0 Crítico/Alto/Médio; 3 Baixos —
> (1) pré-sequestro: quem se inscreve com o e-mail de outra pessoa escolhe a senha; se a vítima clicar em "Confirmar" (de uma inscrição que não
> fez), a senha do atacante continua valendo — mitigação possível: criar a senha no próprio link de confirmação (**decisão do dono pendente**);
> (2) cadastro de aluno sem limite próprio — **corrigido** (20/h); (3) contas nunca confirmadas ficavam para sempre — **corrigido** (abaixo).
> Domínio `pulserx.com.br` verificado no Resend (2026-09-30); falta trocar `EMAIL_FROM` de produção no deploy.
>
> **Limpeza de inscrições não confirmadas (decisão do dono, 2026-09-30 — "ponto 3"):** `auth/unverified-cleanup.service.ts` roda DENTRO da API
> (1 min depois de subir e a cada 6 h; `setTimeout`/`setInterval` com `unref`, sem dependência nova de agendador — produção tem um só
> container; se um dia houver réplicas, a limpeza continua segura porque o delete é condicional, só roda repetida). Apaga (em lotes de 100) o
> aluno com e-mail **não confirmado há mais de 7 dias** que **não** foi cadastrado pelo coach (nunca teve link `SET_PASSWORD`) e que não tem
> assinatura, cobrança, plano de treino nem mensagens; o delete exige `emailVerifiedAt: null` (quem confirmou no meio do caminho fica) e
> leva junto o aviso "Fulano se inscreveu" do coach (mesmo nome, até 10 min depois da conta). Log só com a contagem. Aluno cadastrado pelo coach
> que não criar a senha **não** é apagado (o coach reenvia o link). Validação: 928 testes 100%, mutação 7/7 (a 1ª rodada deixou sobreviver
> "tirar o `unref`" — teste novo), ao vivo 7/7 no banco local (velha apagada + aviso do coach; recente, do coach e confirmadas ficam).

> **Cartão com débito automático — opção A (decisão do dono, 2026-09-30; estudo em `docs/ESTUDO_CARTAO_ASAAS.md`):** a assinatura
> continua `UNDEFINED` (aluno escolhe na fatura); pagar com cartão faz o Asaas guardar o cartão e cobrar as próximas sozinho (testado no
> sandbox). `GET /subscriptions/me` ganhou `autoDebitCard` (`{brand, last4}` ou null): `AsaasService.getSubscriptionCard` consulta o
> Asaas na hora (timeout 5 s, só bandeira + 4 dígitos, nunca token; o PulseRx **não grava** dado de cartão), só para assinatura própria não
> cancelada; falha = null (a tela abre). Memória de 10 min por assinatura (`cardOf`, teto 1000) — achado Baixo do security-analyst
> (consumo da cota do Asaas), corrigido no mesmo PR. O `gatewaySubscriptionId` nunca vai na resposta. **Ambiente de teste
> (`aevonfit.aevon.online`) continua com o Asaas real — decisão do dono.**

> **Senha criada no link de confirmação (decisão do dono, 2026-09-30 — corrige o Baixo de pré-sequestro do PR B):** a inscrição pela
> landing **não tem mais senha** (`PublicSignupDto` sem `password`; mandar o campo = 400; a conta nasce com senha interna aleatória).
> `POST /auth/verify-email` exige `{token, password}`: grava a senha, `passwordChangedAt` e `emailVerifiedAt` e invalida todos os links
> abertos do usuário; `resetPassword` também invalida `VERIFY_EMAIL`. Quem se inscreve com o e-mail de outra pessoa nunca tem uma senha que
> funcione. Quem perdeu o e-mail de confirmação usa "Esqueci minha senha" (o link de nova senha também confirma) — o 403
> `EMAIL_NOT_VERIFIED` do login fica só como defesa (conta sem senha conhecida sempre dá 401). Validação: 942 testes 100%, mutação 5/5,
> ataque ao vivo 12/12 (intruso se inscreve → não entra com nenhuma senha → vítima cria a senha pelo link e entra), security-analyst sem achados.

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
