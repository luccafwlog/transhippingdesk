# Deploy

> Hospedagem: **Firebase Hosting** (projeto `transhipping-desk`, target `transhipping-desk`, pasta publicada `dist`). CI/CD via **GitHub Actions** (CLI direta, sem action de terceiros). Nenhum push manual é necessário.

## Workflows

| Workflow | Gatilho | O que faz |
|---|---|---|
| `.github/workflows/ci.yml` | `pull_request` | `npm ci --legacy-peer-deps` → `lint` → `build` (tsc + vite) → `test`. Gate de qualidade do PR. |
| `.github/workflows/firebase-deploy.yml` | push em `main` | Build + deploy. |

### Deploy manual

```bash
npm run build
npx firebase-tools deploy --only hosting
```

## Secrets do repositório

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `FIREBASE_SERVICE_ACCOUNT_TRANSHIPPING_DESK`

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

As Edge Functions do Portal (`portal-login`, convite/ativação, recuperação,
troca de email e `notify-invoice-issued`) são deployadas separadamente via
Supabase CLI/console (não pelo CI de hosting). Variáveis de ambiente em
[setup/development.md](development.md#5-edge-functions-opcional-no-dev-local).
