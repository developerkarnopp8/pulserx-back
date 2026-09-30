# Deploy de produção — PulseRx (backend)

> Só com a autorização do dono ("Podemos subir"). Produção ainda roda com os nomes antigos: pasta `/opt/aevonfit/backend`,
> containers `aevonfit-api` / `aevonfit-db`, banco `aevonfit` (a migração de nomes da VPS é uma etapa própria, não misturar).
> O backend chega na VPS por **rsync** (a pasta não tem `.git`).

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
   RSYNC='rsync -az --delete --exclude node_modules --exclude .git --exclude dist --exclude .env --exclude ".env.*" --exclude "*.env.production"'
   eval $RSYNC -n -i ./ root@77.37.43.188:/opt/aevonfit/backend/   # ler as linhas *deleting antes
   eval $RSYNC ./ root@77.37.43.188:/opt/aevonfit/backend/
   ```
4. **Imagem nova** (na VPS): `cd /opt/aevonfit/backend && docker compose -f docker-compose.prod.yml build api`
5. **Migrations ANTES de trocar o container** (regra de ouro 8 — o container antigo segue atendendo; as migrations são aditivas):
   ```bash
   docker compose -f docker-compose.prod.yml run --rm api npx prisma migrate status
   docker compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy
   docker compose -f docker-compose.prod.yml run --rm api npx prisma migrate status   # "Database schema is up to date!"
   ```
6. **Troca:** `docker compose -f docker-compose.prod.yml up -d api` e conferir os logs (`docker logs --tail 50 aevonfit-api`).
7. **Smoke:** a API responde (Swagger `/api/docs`), login de coach e de aluno, uma tela de cada.
8. **Frontend** depois da API (mesmo cuidado com o rsync, pasta `/opt/aevonfit/frontend`).

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
