# Segurança

> A fronteira de autorização vive no **banco** (RLS + RPCs `SECURITY DEFINER`). Checagens no cliente são apenas UX.

---

## RLS-first

- **RLS ativo em todas as tabelas.** Acesso segmentado por role via helpers `is_admin()`, `is_active_user()`, `current_user_role()` (ADR 0004).
- **Tabelas financeiras:** leitura por usuário ativo, escrita restrita a admin.
- A lógica financeira sensível (criar invoice, numerar, consolidar, PIX) roda em **RPCs `SECURITY DEFINER`** transacionais — o cliente não escreve direto nessas tabelas.
- **Default-deny em funções** (ADR 0011): o EXECUTE para `anon` foi revogado; novas funções não recebem acesso anônimo por padrão.
- **Helpers de revisão privilegiados:** `compute_bl_review_pendencies` lê `customer_portal_accounts`, relação administrativa protegida por RLS. Por isso roda como `SECURITY DEFINER` com `search_path` fixo e sem `EXECUTE` direto para `PUBLIC`, `anon` ou `authenticated`; somente RPCs/triggers autorizados o invocam.

> Checagens no front (`can()`, `isAdmin`, `roleHasPermission`) servem só para esconder UI. Nunca são a fronteira real.

## Roles internas

`administrativo` · `financeiro` · `operacoes` · `documentacao`, em `user_profiles` (`role`, `active`). Geridas em `/admin/usuarios`. Ver [Admin Usuários](../modules/operacao-suporte.md#admin-usuários).

## Duas fronteiras de autenticação

| Fronteira | Hook | Mecanismo |
|---|---|---|
| **Interna** | `src/hooks/useAuth.tsx` | Supabase Auth + perfil em `user_profiles`; timeout de inatividade de **8 horas**; role → permissões. |
| **Portal** | `src/hooks/usePortalAuth.tsx` | Supabase Auth. Login por **CNPJ (14 dígitos) OU email** resolvido via RPC `portal_resolve_login`. |

> **Portal login:** o ADR 0001 originalmente definiu email-only e remoção do CNPJ. Isso foi **superado** — o login por CNPJ foi reintroduzido (migrations `…fase1_login_cnpj` e `…harden_portal_resolve_login`). A verdade vigente está em [Portal do Cliente](../modules/portal-cliente.md) e no [CONTEXT.md](../../CONTEXT.md) (termo *Login de Portal*).

## Rate limiting

- **Provisão de portal** (`provision-portal-user`): 20/hora por usuário, persistido em banco (`provision_rate_limit_log`, RPC `check_provision_rate_limit`).
- **Login/resolução de portal:** tentativas registradas em `portal_login_attempts` / `portal_login_resolution_attempts`; limites em `portal_rate_limits` (RPC `check_portal_rate_limit`).

## Invariante de provisionamento do portal

Uma conta de `customer_portal_accounts` só pode ficar ativa quando possui `auth_user_id`. Os fluxos internos gravam a conta inativa, chamam a Edge Function e ativam apenas após confirmação; `set_customer_portal_account_active` rejeita ativação sem vínculo Auth. A fila de revisão não consulta essa tabela por join direto: consome a pendência canônica calculada no banco.

## Edge Functions

- **`provision-portal-user`** — cria/atualiza usuário Supabase Auth do portal. Exige caller admin ativo; rate-limited; CORS restrito a `APP_URL`.
- **`notify-invoice-issued`** — disparada por Database Webhook quando `invoices.status → 'issued'`. Autenticação por bearer service-role (comparação *timing-safe*); re-busca a fatura no banco; **HTML escapado** antes do envio via Resend.

## Headers HTTP / CSP

Definidos em `firebase.json`:

- `X-Frame-Options: DENY` · `X-Content-Type-Options: nosniff` · `Referrer-Policy`
- **CSP** sem `unsafe-inline` em scripts; `connect-src` restrito a Supabase, `olinda.bcb.gov.br`, `api.resend.com`, Sentry. Ver [Deploy](../setup/deploy.md#content-security-policy).

## Outras defesas

- **Upload guard:** `assertUploadSize` (`src/lib/fileGuard.ts`) limita tamanho antes de `XLSX.read` (mitiga a vulnerabilidade conhecida do `xlsx`).
- **Injeção em filtros PostgREST:** input de usuário em `.or()/.ilike()` é escapado (`escapeFilterTerm` / `sanitizeLikeTerm`, `src/lib/utils.ts`).
- **Injeção de fórmula em planilhas:** exports passam pelo sanitizador de `src/services/exports.ts`.
- **Segredos de servidor** ficam **apenas** em env vars de Edge Functions, nunca no bundle do cliente.

## Riscos de segurança monitorados

- Dependência `xlsx` (SheetJS) com vulnerabilidade conhecida sem correção no npm — mitigada por limite de tamanho e acesso restrito a usuários autenticados. Ver [ROADMAP](../ROADMAP.md).
- Snapshots de auditoria de segurança ficam em [archive/](../archive/README.md).
