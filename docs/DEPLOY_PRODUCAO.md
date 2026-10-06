# Deploy de produção — PulseRx (backend)

> Só com a autorização do dono ("Podemos subir"). Produção ainda roda com os nomes antigos: pasta `/opt/aevonfit/backend`,
> containers `aevonfit-api` / `aevonfit-db`, banco `aevonfit` (a migração de nomes da VPS é uma etapa própria, não misturar).
> O backend chega na VPS por **rsync** (a pasta não tem `.git`).
> **Domínio (2026-10-06): `pulserx.com.br`** — mesmo servidor, banco e Asaas real que antes atendiam `aevonfit.aevon.online`.
> Vhost do host em `/etc/nginx/sites-available/pulserx.conf` (certificado Certbot para `pulserx.com.br` + `www`). O webhook do Asaas
> aponta para `https://pulserx.com.br/api/webhooks/asaas`. O `aevonfit.aevon.online` redireciona para o domínio novo, com `/api/`
> ainda atendido lá durante a transição. CORS/socket: `src/common/allowed-origins.ts`; links dos e-mails: `APP_URL` no compose.

## Como o banco muda (desde 2026-09-30)

- **Toda mudança no `schema.prisma` vem com migration** (`npx prisma migrate dev --name <descricao>`), commitada no mesmo PR.
  O job de CI **"Migrations em dia com o schema"** falha se o schema mudar sem migration.
- Em produção só roda `prisma migrate deploy` (aplica as migrations pendentes, na ordem, e registra em `_prisma_migrations`).
  Nunca `db push` em produção.
- A imagem de produção já tem o CLI do Prisma (5.22.0, vem junto com o `@prisma/client`) — conferido no container em 2026-09-30.

## Estado conferido em 2026-09-30 (só leitura)

- Produção tem **10 migrations** aplicadas (até `20260828114127_add_workout_session_and_duration`), com checksums iguais aos do repo,
  e a estrutura do banco bate exatamente com elas (sem alteração manual).
- Pendentes: `20260926204047_v2_r1_categorias_assinaturas` e `20260930200000_landing_asaas_lgpd`. As duas são **só aditivas**
  (tabelas novas, colunas opcionais ou com valor padrão, `studentId` do plano deixa de ser obrigatório, valor novo no enum
  `SkipReason`). Testadas localmente sobre a estrutura de produção com dados fictícios e com o `prisma migrate deploy` real.

## Chaves no `.env` da VPS (`/opt/aevonfit/backend/.env`)

O dono coloca os valores direto na VPS — nunca em chat, commit ou PR. A API **não sobe** sem estas (o `docker-compose.prod.yml`
usa `${VAR:?}` e para antes de trocar o container se faltar alguma):

| Variável | O que é |
|---|---|
| `DB_PASSWORD`, `JWT_SECRET`, `ANTHROPIC_API_KEY` | já existiam |
| `ASAAS_API_KEY` | chave da conta Asaas. **Começa com `$`: escreva entre aspas simples** (`ASAAS_API_KEY='$aact_prod_...'`) — sem aspas o Compose apaga o valor (armadilha nº 4 do guia) |
| `ASAAS_ENV` | `production` (cobrança real) ou `sandbox` (teste) |
| `ASAAS_WEBHOOK_TOKEN` | um segredo longo gerado por você, o MESMO cadastrado no webhook do painel do Asaas |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | conta Cloudinary do PulseRx (fotos da landing) |
| `APP_URL` | fica no próprio `docker-compose.prod.yml` (não é segredo): endereço dos links de senha/confirmação enviados por e-mail |
| `RESEND_API_KEY`, `EMAIL_FROM` | conta Resend do PulseRx. Domínio `pulserx.com.br` verificado (2026-09-30); `EMAIL_FROM` entre aspas simples por causa dos `<>` e espaços: `EMAIL_FROM='PulseRx <nao-responda@pulserx.com.br>'` |

Conferir sem mostrar valores: `grep -oE '^[A-Z_]+=' /opt/aevonfit/backend/.env`. Qualquer valor com `$` vai entre aspas simples.

## Passo a passo

1. **Antes:** PRs mergeados no `main`, CI verde, `security-analyst` e LGPD do lote.
2. **Backup do banco** (na VPS; um timestamp só, `docker cp` não aceita `*`):
   ```bash
   TS=$(date +%Y%m%d_%H%M%S)
   docker exec aevonfit-db pg_dump -U postgres -d aevonfit -F c -f /tmp/pre_deploy_$TS.dump
   docker cp aevonfit-db:/tmp/pre_deploy_$TS.dump /root/backups/aevonfit_pre_deploy_$TS.dump
   ```
3. **Código** (na máquina local, de um checkout LIMPO do `main` — nunca da pasta de trabalho):
   ```bash
   git fetch origin && git worktree add ../pulserx-back-deploy origin/main && cd ../pulserx-back-deploy
   # 3a. ENSAIO — rodar sozinho e LER as linhas "*deleting" antes de seguir (nenhuma deve ser .env, backup ou uploads)
   rsync -az --delete --exclude node_modules --exclude .git --exclude dist --exclude .env --exclude ".env.*" --exclude "*.env.production" \
     -e "ssh -i ~/.ssh/deploy_key" -n -i ./ root@77.37.43.188:/opt/aevonfit/backend/ | grep deleting
   # 3b. Só depois de ler o ensaio: o mesmo comando sem -n -i
   ```
   > **Armadilha (2026-09-30):** os `--exclude` vão **entre aspas, escritos direto no comando** — nunca guardados numa variável sem aspas.
   > Numa variável, o shell troca `.env.*` pelo arquivo que existir na pasta local (`.env.example`) e o rsync deixa de proteger o resto:
   > assim foi apagado o `.env.bak-20260930` da VPS (restaurado do backup do código). E o ensaio vai num comando separado, lido antes.
4. **Imagem nova** (na VPS): `cd /opt/aevonfit/backend && docker compose -f docker-compose.prod.yml config -q && docker compose -f docker-compose.prod.yml build api` (o `config -q` falha na hora se faltar chave)
5. **Migrations ANTES de trocar o container** (regra de ouro 8 — o container antigo segue atendendo; as migrations são aditivas):
   ```bash
   docker compose -f docker-compose.prod.yml run --rm api npx prisma migrate status
   docker compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy
   docker compose -f docker-compose.prod.yml run --rm api npx prisma migrate status   # "Database schema is up to date!"
   ```
6. **Troca:** `docker compose -f docker-compose.prod.yml up -d --no-deps api` e conferir os logs (`docker logs --tail 50 aevonfit-api`).
   O `--no-deps` evita recriar o `aevonfit-db` junto (sem ele, em 2026-09-30 o banco reiniciou por alguns segundos; os dados ficam no volume,
   mas conexões caem).
7. **Smoke:** a API responde (Swagger `/api/docs`), login de coach e de aluno, uma tela de cada.
8. **Frontend** depois da API, logo em seguida (o front antigo com a API nova pode quebrar telas que mudaram de contrato). Mesmo cuidado com o
   rsync (pasta `/opt/aevonfit/frontend`, com `--exclude .angular`), depois `docker compose -f docker-compose.prod.yml build && ... up -d`.
9. **Backup antes de cada deploy** (além do banco): `tar czf /root/backups/aevonfit_codigo_pre_deploy_$TS.tgz --exclude=node_modules
   --exclude=dist --exclude=.env .` nas duas pastas e `docker tag backend-api:latest backend-api:rollback-$TS` (idem `frontend-frontend`) —
   foi desse tar que o arquivo apagado por engano voltou.

## Nginx do host

- `/etc/nginx/sites-enabled/aevonfit.conf`, `location /api/` com **`client_max_body_size 21m`** (foto de até 5 MB, PDF de até 20 MB). Em
  2026-09-30 foi posto 12m primeiro e o PDF grande falhava — o limite do nginx tem de ser maior que o maior upload aceito pela API.
- Depois de mexer: `nginx -t && systemctl reload nginx`.

## Rollback

- Migration falhou no passo 5: nada foi trocado — o container antigo continua. Ver o erro, corrigir, e se o banco ficou pela metade
  restaurar o backup do passo 2 (`pg_restore --clean` no `aevonfit-db`).
- Código novo com problema depois do passo 6: as migrations são aditivas, o código antigo continua funcionando com o banco novo —
  voltar a imagem/código anterior e subir de novo.

## O que muda para quem usa (primeiro deploy com a LGPD)

- **Todo coach** vê o Termo do Coach no próximo acesso e só usa o painel depois de aceitar.
- **Todo aluno** aceita os termos atualizados e responde sobre dados de saúde no próximo acesso.
- Pulos com "Lesão/dor" ou observação gravados antes continuam como estão (decisão do dono: só somem se o aluno responder "não").
- Antes da primeira cobrança real: configurar o Asaas (chave, webhook), definir o % de cada coach e ligar o bloqueio por assinatura.
