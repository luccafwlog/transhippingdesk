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
| **Portal** | `src/hooks/usePortalAuth.tsx` | Supabase Auth. Login exclusivo por CNPJ normalizado via Edge Function `portal-login`. |

> **Portal login:** o navegador envia apenas CNPJ e senha para `portal-login`; a identidade técnica e o email técnico permanecem no servidor. As Edge Functions do Portal chamadas pelo navegador compartilham uma allowlist de origens em `supabase/functions/_shared/cors.ts` (`transhippingdesk.com.br`, `portal.transhippingdesk.com.br`, `transhippingdesk.web.app`, `firebaseapp.com` e localhost de dev); `withCors` trata o preflight e injeta os headers em toda resposta.

## Rate limiting

- **Provisão de portal**: convites e recuperação usam tokens opacos de uso único, com expiração e hash persistido; o login e a recuperação aplicam rate limit por CNPJ.
- **Login/resolução de portal:** tentativas registradas em `portal_login_attempts` / `portal_login_resolution_attempts`; limites em `portal_rate_limits` (RPC `check_portal_rate_limit`).

## Invariante de provisionamento do portal

Uma conta de `customer_portal_accounts` só pode ficar ativa quando possui `auth_user_id`. A identidade é criada na ativação do convite; suspensão revoga sessões e devolve a conta à análise. A fila de revisão não usa a prontidão do Portal como bloqueio financeiro.

As RPCs `SECURITY DEFINER` de provisionamento (`portal_set_exception`, `portal_return_to_analysis`, `portal_provisioning_backfill`, `portal_provisioning_preflight`, `portal_admin_change_cnpj`, `portal_cancel_invite`, `portal_assisted_email_change`) autorizam em duas camadas: EXECUTE concedido só a `authenticated`/`service_role` (o herdado do `PUBLIC` foi revogado na migration `192`) e guarda NULL-safe sobre `_portal_actor_role()`, negando role indefinido — inclusive clientes do Portal, que também são role `authenticated`. Correção da falha *fail-open* encontrada em teste de isolamento por CNPJ (2026-07-14): a comparação com role NULL não disparava o `permission denied`, e o `REVOKE ... FROM anon` original não removia o EXECUTE do `PUBLIC`.

## Edge Functions

- **Convite/ativação e recuperação** — criam a identidade técnica somente na ativação do convite, sem expor email técnico ou senha ao operador; suspensão revoga as sessões do usuário.
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
