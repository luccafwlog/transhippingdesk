# Deploy

> Hospedagem: **Firebase Hosting** (projeto `importmanager-bda3e`, target `transhippingdesk`, pasta publicada `dist`). CI/CD via **GitHub Actions**. Nenhum push manual é necessário.

## Workflows

| Workflow | Gatilho | O que faz |
|---|---|---|
| `.github/workflows/ci.yml` | `pull_request` | `npm ci --legacy-peer-deps` → `lint` → `build` (tsc + vite) → `test`. Gate de qualidade do PR. |
| `.github/workflows/auto-merge-prs.yml` | PR aberto/reaberto | **Merge automático** (squash) via API → checkout do SHA → build → **deploy** Firebase. |
| `.github/workflows/firebase-deploy.yml` | push direto em `main` | Build + deploy (cobre hotfixes). |

### Fluxo padrão (auto-merge)

Todo PR aberto/reaberto dispara `auto-merge-prs.yml`:

1. **Merge automático** (squash) via API do GitHub → gera o SHA final.
2. Checkout do SHA + setup Node 20.
3. `npm ci --legacy-peer-deps` + `npm run build`, injetando `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `VITE_APP_COMMIT_SHA` dos secrets.
4. Deploy para Firebase Hosting.

> `VITE_APP_COMMIT_SHA` expõe o SHA do deploy na aplicação (rastreabilidade).

### Deploy manual (emergência)

```bash
npm run build
npx firebase-tools deploy --only hosting
```

## Secrets do repositório

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `FIREBASE_SERVICE_ACCOUNT_IMPORTMANAGER_BDA3E`

## Migrations NÃO são aplicadas pelo CI

Aplique migrations manualmente no Supabase **antes** de fazer deploy de código que dependa delas. Ver [setup/development.md](development.md#3-banco-de-dados).

## Content-Security-Policy

A CSP é definida em `firebase.json`. Domínios externos só funcionam se estiverem em `connect-src`. Atualmente liberados:

```
default-src 'self'
script-src  'self'                       (sem unsafe-inline)
connect-src 'self' https://*.supabase.co wss://*.supabase.co
            https://olinda.bcb.gov.br https://api.resend.com
            https://*.ingest.us.sentry.io
frame-ancestors 'none' · object-src 'none' · base-uri 'self'
```

Ao adicionar uma integração externa nova, inclua o domínio aqui. Detalhes de segurança em [operations/seguranca.md](../operations/seguranca.md).

## Edge Functions

`provision-portal-user` e `notify-invoice-issued` são deployadas separadamente via Supabase CLI/console (não pelo CI de hosting). Variáveis de ambiente em [setup/development.md](development.md#5-edge-functions-opcional-no-dev-local).
