# Deploy

> Hosting: **Vercel**, com um único projeto para a SPA Vite. Pull requests
> geram Preview Deployments e `main` gera o Production Deployment pela
> integração GitHub/Vercel. O Firebase permanece configurado apenas como
> rollback temporário até o cutover dos domínios.

## Workflows

| Integração | Gatilho | O que faz |
|---|---|---|
| `.github/workflows/ci.yml` | `pull_request` e push em `main` | `docs:check`, lint, build, bundle size e testes em shards. |
| Vercel + GitHub | pull request | Build e Preview Deployment. |
| Vercel + GitHub | push em `main` | Build e Production Deployment. |

Não há mais workflow de deploy Firebase no repositório. A integração Vercel é
configurada no projeto Vercel, não como uma segunda publicação no GitHub
Actions.

## Configuração do projeto Vercel

O contrato versionado está em [`vercel.json`](../../vercel.json):

- framework Vite;
- Node.js `24.x` em Vercel e no CI;
- instalação reproduzível com `npm ci --legacy-peer-deps`;
- comando `npm run build`;
- saída `dist`;
- `ignoreCommand` ignora commits sem alterações no frontend, dependências ou
  configuração de build;
- rewrite para `/index.html`, preservando refresh em qualquer rota React Router;
- headers de segurança equivalentes aos usados no Firebase;
- HTML sem cache e assets em `/assets/` com cache longo e `immutable`.

No projeto Vercel, configure o Root Directory como a raiz deste repositório e
deixe o Git Integration responsável por Preview/Production. Não configure
migrations, Edge Functions ou comandos de backend no build da Vercel.

O `ignoreCommand` só ignora um deployment quando o commit não altera arquivos
que participam do frontend ou do build. Se não houver SHA anterior disponível,
ou se o SHA não estiver presente no clone raso usado pela Vercel, o comando
continua o build por segurança. Alterações em `docs/` isoladamente não geram um
novo deployment.

## Variáveis do frontend

As únicas variáveis necessárias ao bundle são públicas por definição do Vite:

| Variável | Production | Preview | Development |
|---|---|---|---|
| `VITE_SUPABASE_URL` | URL do projeto Supabase de produção | URL da branch persistente `stagingtdesk` | valor do ambiente local |
| `VITE_SUPABASE_ANON_KEY` | chave pública `anon` correspondente | chave pública da `stagingtdesk` | chave pública do ambiente local |

`VITE_APP_COMMIT_SHA` é opcional: `vite.config.ts` injeta o commit Git atual
quando a variável não é fornecida, mantendo o release visível no Sentry e na
interface. Nunca configure `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` ou
outros segredos de Edge Functions como variáveis `VITE_*`.

As variáveis devem ser cadastradas no Vercel Project Settings para os ambientes
Production, Preview e Development conforme o ambiente escolhido. O CI do
GitHub mantém suas próprias variáveis públicas de build; isso não substitui a
configuração do projeto Vercel.

### Preview compartilhado `stagingtdesk`

O projeto Vercel `transhippingdesk` usa a branch persistente `stagingtdesk` como
ambiente compartilhado de Preview. A configuração operacional é:

- Supabase Production: `fgmkhbzhaeebrsizwccx`;
- Supabase Preview: `dkmkhwdoskuwrkxwojhv` (`stagingtdesk`);
- `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` do Preview apontam para esse
  mesmo projeto, em escopo **Preview**;
- Production mantém as credenciais do projeto principal.

Assim, qualquer branch ou Pull Request que gerar Preview no Vercel usa o mesmo
schema, Auth, Storage e dados de validação da `stagingtdesk`. Não se deve
substituir essa configuração por uma variável específica de cada branch nem
ativar o auto-branching do Supabase para esse fluxo: isso faria cada Preview
apontar para um projeto diferente. A chave usada no Vercel é sempre pública;
service role e demais segredos permanecem fora do bundle.

## Domínios e cutover sem downtime

O mesmo projeto Vercel deve receber:

- `https://transhippingdesk.com.br` — aplicação interna;
- `https://portal.transhippingdesk.com.br` — Portal do Cliente.

O `PORTAL_URL` das Edge Functions continua sendo
`https://portal.transhippingdesk.com.br`, e `APP_URL` continua sendo
`https://transhippingdesk.com.br`. Nenhum deles deve ser trocado por um
domínio `.vercel.app`.

Sequência operacional:

1. criar/vincular o projeto Vercel e configurar as variáveis;
2. gerar um Preview/Production Deployment e testar o domínio `.vercel.app`;
3. validar login interno, Portal, refresh de sessão, rotas profundas, Supabase,
   Realtime, PTAX, Sentry, CSP, assets e Edge Functions;
4. adicionar os dois domínios ao projeto Vercel e usar os registros exibidos
   por `vercel domains inspect`;
5. trocar somente os registros web no provedor DNS, preservando MX, SPF, DKIM,
   DMARC, ImprovMX, Resend e demais registros de email;
6. manter o Firebase publicado até DNS, SSL, aplicação, Portal, Supabase,
   emails e Sentry estarem estáveis.

O Firebase não deve ser apagado durante o cutover. Para rollback, restaure os
registros web anteriores e mantenha `firebase.json` e `.firebaserc` até a
estabilidade pós-migração ser comprovada.

## Content-Security-Policy

A CSP é definida em `vercel.json`. As origens efetivamente usadas pelo browser
são:

```text
default-src 'self'
script-src  'self'
connect-src 'self' https://*.supabase.co wss://*.supabase.co
            https://olinda.bcb.gov.br https://*.ingest.us.sentry.io
font-src    'self' https://fonts.gstatic.com
```

`api.resend.com` não é acessado pelo browser: Resend continua sendo chamado
somente pelas Supabase Edge Functions e por isso não precisa estar no
`connect-src`. Não há `unsafe-eval`; o `unsafe-inline` existente é limitado a
`style-src`, conforme o contrato atual da aplicação.

## Analytics e Speed Insights

Web Analytics e Speed Insights são carregados globalmente em produção pelos
componentes oficiais da Vercel. Antes do envio, query strings são removidas e
segmentos dinâmicos de CNPJ, B/L, viagem e cliente são normalizados para evitar
que identificadores operacionais apareçam na telemetria. As métricas continuam
agrupáveis por tela, sem expor o registro acessado.

## CORS das Edge Functions

As origens de produção permanecem na allowlist compartilhada em
`supabase/functions/_shared/cors.ts`. Os domínios Firebase padrão continuam
temporariamente para rollback.

Preview URLs não são liberadas por wildcard. Para testar uma URL Preview que
invoca Edge Functions do browser, configure no ambiente das Edge Functions do
Supabase:

```text
VERCEL_PREVIEW_ORIGINS=https://<url-preview-exata>.vercel.app
```

Múltiplas URLs podem ser separadas por vírgula. O parser aceita somente URLs
HTTPS exatas, sem caminho e sem `*`. A variável não é necessária para o
Production Deployment nos domínios próprios.

## Edge Functions, Resend e migrations

Edge Functions continuam sendo publicadas separadamente no Supabase CLI/Console
e continuam usando `PORTAL_URL`, `APP_URL`, `RESEND_API_KEY` e demais segredos
server-side. Resend não é migrado para Vercel Functions.

Migrations continuam sendo aplicadas no Supabase, em ordem e antes do deploy de
código que dependa delas. As migrations
`351_reconcile_branch_schema_drift.sql`,
`352_reconcile_remaining_runtime_drift.sql` e
`354_reconcile_import_batches_timestamp.sql` reassertam, de forma idempotente,
os elementos de schema necessários para que a produção e a `stagingtdesk`
permaneçam alinhadas mesmo quando uma execução histórica deixou a versão
registrada sem o efeito correspondente. A migration 352 remove resíduos do
antigo bloqueio `overdue`, repõe o índice de CE Mercante e preserva dados ao
recusar a conversão de `import_batches.created_at` quando os valores legados
divergirem de `uploaded_at`. A migration 354 consulta o catálogo antes de
referenciar a coluna opcional, cria a coluna quando ela está ausente e converge
branches persistentes que já registraram a 352 antes dessa proteção. A migration
355 corrige, de forma controlada e idempotente, o nome histórico remoto da versão
169 para que o rebase use o arquivo correto (`169_demurrage...`) e não tente
reaplicar a policy da migration 170; migrations aplicadas não devem ser reescritas
fora de uma migration explícita de reconciliação. A Vercel nunca executa migrations
implicitamente.

## Firebase rollback

Mantidos temporariamente:

- `firebase.json` — configuração de hosting e headers/fallback legados;
- `.firebaserc` — identificação do projeto Firebase.

Removido:

- `.github/workflows/firebase-deploy.yml` — publicação automática no Firebase.

Não existe dependência `firebase-tools` no `package.json`/lockfile. A remoção
definitiva dos arquivos Firebase só deve ocorrer depois do cutover, da
propagação DNS e da janela de rollback acordada.
