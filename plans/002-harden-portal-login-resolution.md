# Plan 002: Harden anonymous portal login resolution

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If a STOP condition occurs, stop and report; do not improvise.
>
> **Drift check (run first)**: `git diff --stat 1224998..HEAD -- src/hooks/usePortalAuth.tsx src/pages/PortalForgotPassword.tsx src/services/portalBilling.ts supabase/migrations src/services/__tests__`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `1224998`, 2026-06-15

## Why this matters

The Portal supports login by CNPJ/CPF by resolving the document to a Supabase
Auth email before calling `signInWithPassword`. That RPC must be callable before
authentication, but the current implementation returns the portal email to an
anonymous caller. This makes active portal-account discovery and email exposure
possible through devtools or direct RPC calls, especially for public CNPJ values.

## Current state

- Frontend call sites:
  - `src/services/portalBilling.ts:158` calls `portal_resolve_login`.
  - `src/hooks/usePortalAuth.tsx` calls `portalResolveLogin()` before `signInWithPassword` when the login has 11 or 14 digits.
  - `src/pages/PortalForgotPassword.tsx` also calls `portalResolveLogin()` before sending the recovery email.
- SQL implementation:
  - `supabase/migrations/20260615000002_portal_fase1_login_cnpj.sql:28` creates `public.portal_resolve_login(p_login TEXT)`.
  - The function selects `a.portal_email` and returns it at lines 56, 67, and 81.
  - `supabase/migrations/20260615145427_portal_fixes_post_pr227.sql:19` grants EXECUTE to `anon`.
- Existing migration-test style:
  - `src/services/__tests__/portalCreateConsolidationJsonbMigration.test.ts` reads a migration file and asserts key SQL fragments.
  - Follow that pattern for any new migration test.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Focused tests | `npm test -- src/services/__tests__` | all service/migration tests pass |
| Full tests | `npm test` | all non-skipped tests pass |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/hooks/usePortalAuth.tsx`
- `src/pages/PortalForgotPassword.tsx`
- `src/services/portalBilling.ts`
- A new Supabase migration under `supabase/migrations/`
- A focused migration test under `src/services/__tests__/`

**Out of scope**:
- Replacing Supabase Auth.
- Changing the visible login UX.
- Logging or writing any real customer email/document values.
- Broad auth refactors for the internal app.

## Git workflow

- Branch: `codex/002-harden-portal-login-resolution`
- Commit message example: `fix(security): harden portal login alias resolution`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Decide the minimal hardening shape

Prefer the smallest change that preserves CNPJ/CPF login:

- Keep `portal_resolve_login` callable by `anon`, because the frontend needs it before Supabase Auth.
- Add abuse resistance and reduce enumeration value:
  - Add a dedicated anonymous resolution attempt table, e.g. `portal_login_resolution_attempts`, with normalized login, attempted_at, and a bounded retention policy.
  - Rate limit by normalized login value and a coarse window before doing the account lookup. If you can safely use request metadata for IP in this Supabase project, include it; if not, do not invent a fake IP source.
  - Return generic errors for not-found/disabled cases so the UI cannot distinguish active accounts.

**Verify**: new migration contains a bounded rate-limit helper and generic not-found errors; no secret or customer data is hardcoded.

### Step 2: Update frontend error handling to avoid exposing resolution details

In `src/hooks/usePortalAuth.tsx` and `src/pages/PortalForgotPassword.tsx`, make CNPJ/CPF resolution failures map to the same generic messages already used for login/recovery.

Do not show raw SQL/RPC error messages for anonymous resolution failures. Preserve the specific `P0429` message where the backend returns a rate-limit code.

**Verify**: `rg -n "portalResolveLogin|P0429|Credenciais|Se o CNPJ" src/hooks/usePortalAuth.tsx src/pages/PortalForgotPassword.tsx` shows resolution errors are handled generically.

### Step 3: Add migration tests

Create a test modeled after `src/services/__tests__/portalCreateConsolidationJsonbMigration.test.ts` that asserts the new migration:

- Replaces or wraps `portal_resolve_login`.
- Keeps `GRANT EXECUTE ... TO anon` only for the resolver.
- Contains a rate-limit table/helper or equivalent bounded attempt check.
- Does not expose different not-found messages for CNPJ vs email.

**Verify**: `npm test -- src/services/__tests__/portalResolveLogin` or the exact new test file passes.

### Step 4: Run full gates

**Verify**:
- `npm test` -> all non-skipped tests pass.
- `npm run lint` -> exit 0.
- `npm run build` -> exit 0.

## Test plan

- New migration test for the hardening migration.
- Add or adjust a frontend unit test only if one already exists for portal auth/recovery; otherwise keep this plan focused on migration tests and full build coverage.

## Done criteria

- [ ] Anonymous resolver still supports CNPJ/CPF login.
- [ ] Not-found/disabled resolver failures are generic.
- [ ] Resolver has bounded abuse resistance.
- [ ] `npm test`, `npm run lint`, and `npm run build` pass.
- [ ] `plans/README.md` row 002 updated.

## STOP conditions

- You cannot implement meaningful rate limiting without weakening login or storing sensitive values in plaintext.
- Supabase/Postgres request metadata is needed but unavailable and normalized-login limiting is judged insufficient by the reviewer.
- The fix requires replacing the auth flow with an Edge Function or custom password verification.

## Maintenance notes

This is defense-in-depth around an intentional feature. Reviewers should focus on whether the resolver still enables CNPJ login while making account enumeration materially harder.
