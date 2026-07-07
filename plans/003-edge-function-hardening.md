# Plan 003: Harden Edge Function auth secrets, error responses, and config declarations

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat a894c5d..HEAD -- supabase/functions supabase/config.toml`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW (code) / MED (operational cutover — see Maintenance notes)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `a894c5d`, 2026-07-07

## Why this matters

Three hardening gaps in `supabase/functions/`, none currently exploitable but
all cheap to close (covers audit findings SEC-EF-01, SEC-EF-02, SEC-EF-03,
SEC-EF-04):

1. The webhook (`notify-invoice-issued`) and cron (`recalc-demurrage-ptax`)
   functions authenticate callers by comparing the bearer token to
   `SUPABASE_SERVICE_ROLE_KEY` itself. The most powerful credential in the
   project is thereby stored in webhook/scheduler config and transmitted on
   every invocation as a mere auth token; rotating it silently breaks both
   integrations.
2. `notify-invoice-issued` reads the key with `!` and no empty-check — if the
   env var were ever unset, the expected header degrades to the literal
   `Bearer undefined`, and the auth check fails **open** (its sibling
   `recalc-demurrage-ptax` already guards this).
3. All three functions return internal error details verbatim to callers
   (`err.message`, upstream Resend/BCB response bodies, Postgres error text),
   and only one of the three functions is declared in `supabase/config.toml`,
   so `verify_jwt`/deploy posture for the other two is not version-controlled.

## Current state

- `supabase/functions/notify-invoice-issued/index.ts` — DB-webhook-triggered
  email sender (Resend). Auth today (lines 78–91):

  ```ts
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  // …
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!timingSafeEqual(authHeader, `Bearer ${serviceRoleKey}`)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, … })
  }
  ```

  Error path (lines ~226–241): a failed Resend call throws
  `new Error(\`Resend API error: ${errText}\`)` and the catch returns
  `{ error: message }` to the caller (it already `console.error`s it).
  The header comment (lines 1–16) documents the webhook config, including
  `Secret Header: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` — update
  it when the secret changes.

- `supabase/functions/recalc-demurrage-ptax/index.ts` — cron-triggered PTAX
  recalc. Auth today (lines 61–69) — note it already has the fail-closed
  empty-secret guard; keep that shape:

  ```ts
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const auth = req.headers.get('authorization') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!serviceRoleKey || !timingSafeEqual(bearer, serviceRoleKey)) { … 401 … }
  ```

  Error paths (lines ~70–95) return `detail: String(error)` (BCB failure,
  status 502) and `detail: error.message` (RPC failure, status 500) to the
  caller; both already `console.error` the full detail.

- `supabase/functions/provision-portal-user/index.ts` — admin-invoked
  provisioning. Caller auth is correct (JWT + role check) — do not change it.
  Its catch (lines 203–208) returns raw `err.message` to the caller:

  ```ts
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return new Response(JSON.stringify({ error: message }), { status: 500, … })
  }
  ```

  Note: earlier in this function, deliberate validation errors are returned
  with specific 4xx messages — those are intentional API responses, NOT in
  scope. Only the final catch-all changes.

- `supabase/config.toml:384-385` — only one function declared:

  ```toml
  [functions.provision-portal-user]
  verify_jwt = true
  ```

  The comment above it says functions are declared here to be deployed by
  Supabase's Git integration.

- Each function is a self-contained `index.ts` (no shared utils dir). Comments
  are pt-BR; match that.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck/build (functions are Deno; the repo's tsc does not cover them) | `npx tsc --noEmit -p tsconfig.json 2>/dev/null; npm run build` | exit 0 (SPA unaffected) |
| Lint | `npm run lint` | exit 0 (functions dir is not linted by ESLint config — verify no regression elsewhere) |
| Tests | `npm test` | all pass |
| Docs check | `npm run docs:check` | exit 0 |

There is no local Deno test harness for functions in this repo; verification
is by careful diff + the done-criteria greps.

## Scope

**In scope** (the only files you should modify):
- `supabase/functions/notify-invoice-issued/index.ts`
- `supabase/functions/recalc-demurrage-ptax/index.ts`
- `supabase/functions/provision-portal-user/index.ts` (final catch block only)
- `supabase/config.toml` (add two `[functions.*]` blocks)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):
- `provision-portal-user` caller-auth, CORS, rate-limit, or password logic —
  audited as correct.
- The Supabase dashboard webhook/cron configuration — operator action
  (see Step 5 checklist).
- Any client code in `src/`.

## Git workflow

- Branch: use the branch the operator designates (or `advisor/003-edge-function-hardening`).
- Commit message style: `fix(security): segredo dedicado e erros genericos nas edge functions`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Dedicated secret for `notify-invoice-issued`

In `supabase/functions/notify-invoice-issued/index.ts`:

1. Replace the auth block so it reads a dedicated secret with fallback to the
   service-role key (fallback keeps the current webhook config working until
   the operator cuts over):

   ```ts
   const webhookSecret =
     Deno.env.get('NOTIFY_WEBHOOK_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
   const authHeader = req.headers.get('Authorization') ?? ''
   const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
   if (!webhookSecret || !timingSafeEqual(bearer, webhookSecret)) {
     // … existing 401 response unchanged …
   }
   ```

   This simultaneously fixes the fail-open `!` (empty secret now rejects) and
   normalizes the compare to the token (not the whole header), matching
   `recalc-demurrage-ptax`.
2. Keep `SUPABASE_SERVICE_ROLE_KEY` usage for the `createClient` admin call —
   that is its legitimate purpose.
3. Update the header comment (lines 1–16): webhook Secret Header becomes
   `Authorization: Bearer <NOTIFY_WEBHOOK_SECRET>`, and add
   `NOTIFY_WEBHOOK_SECRET` to the env-vars list.

**Verify**: `grep -n "NOTIFY_WEBHOOK_SECRET" supabase/functions/notify-invoice-issued/index.ts` → ≥2 matches (comment + code); `grep -n 'SUPABASE_SERVICE_ROLE_KEY.)!' supabase/functions/notify-invoice-issued/index.ts` → 0 matches in the auth path (the `createClient` line may still use the key from a checked variable).

### Step 2: Dedicated secret for `recalc-demurrage-ptax`

Same pattern: read `Deno.env.get('RECALC_CRON_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''`
into the variable used by the existing guard (keep the existing
fail-closed `if (!secret || !timingSafeEqual(...))` shape). Keep the service
role key for `createClient`. Update the header comment (line ~19) to document
`RECALC_CRON_SECRET`.

**Verify**: `grep -n "RECALC_CRON_SECRET" supabase/functions/recalc-demurrage-ptax/index.ts` → ≥2 matches.

### Step 3: Generic error responses

- `notify-invoice-issued` catch: keep `console.error('notify-invoice-issued error:', message)`
  (full detail server-side), but return `{ error: 'internal_error' }` to the
  caller.
- `recalc-demurrage-ptax`: keep the `console.error(...)` lines; change the two
  response bodies to `{ error: 'ptax_unavailable' }` (502) and
  `{ error: 'recalc_failed' }` (500) — drop the `detail` field.
- `provision-portal-user` final catch: keep/add
  `console.error('provision-portal-user error:', err)` and return a static
  `{ error: 'internal_error' }` with status 500. Do NOT touch the earlier
  intentional 4xx validation responses.

**Verify**: `grep -n "detail:" supabase/functions/recalc-demurrage-ptax/index.ts` → 0 matches; `grep -n "err.message\|errText" supabase/functions/*/index.ts` → no match inside a `Response` body (throwing/logging with detail is fine).

### Step 4: Declare all functions in `config.toml`

Below the existing `[functions.provision-portal-user]` block, add (with a
short pt-BR comment each, mirroring the existing one):

```toml
[functions.notify-invoice-issued]
verify_jwt = true

[functions.recalc-demurrage-ptax]
verify_jwt = true
```

**Verify**: `grep -c "^\[functions\." supabase/config.toml` → 3.

### Step 5: Operator cutover checklist (report, don't do)

Include in your completion report:

1. Generate two high-entropy secrets (≥32 random bytes each); set
   `NOTIFY_WEBHOOK_SECRET` and `RECALC_CRON_SECRET` as Edge Function secrets
   in the Supabase dashboard.
2. Update the Database Webhook (invoices → issued) header to
   `Authorization: Bearer <NOTIFY_WEBHOOK_SECRET>` and the cron scheduler's
   header to `Bearer <RECALC_CRON_SECRET>`.
3. After both cutovers are confirmed working, the service-role-key fallback in
   Steps 1–2 can be removed in a follow-up; if the service-role key was ever
   pasted into webhook UI or logs, rotate it.

## Test plan

- No Deno test harness exists in this repo for functions; the verification is
  the grep-based done criteria plus the SPA gates (`npm test`, `npm run build`)
  to prove nothing else regressed. If the executor's environment has `deno`
  available, `deno check supabase/functions/*/index.ts` is a worthwhile extra
  gate (expected: exit 0) — optional, not required.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] Step 1–4 greps all pass as specified
- [ ] `grep -n "Bearer undefined" supabase/functions -r` → 0 matches (sanity)
- [ ] `npm run lint`, `npm test`, `npm run docs:check`, `npm run build` all exit 0
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated; operator cutover checklist in report

## STOP conditions

Stop and report back (do not improvise) if:

- The auth blocks don't match the "Current state" excerpts (drift).
- You find any additional call site that parses the error `detail`/`message`
  fields from these functions' responses (search `src/` for the function
  names) — removing detail would break it; report the consumer.
- The lint config starts covering `supabase/functions/` and errors on Deno
  globals — report rather than reconfiguring ESLint.

## Maintenance notes

- The dual-read fallback (`NEW_SECRET ?? SERVICE_ROLE_KEY`) is deliberate so
  the deploy is not coupled to the dashboard cutover. Track the follow-up to
  remove the fallback once the operator confirms cutover (that removal is the
  moment the finding is fully closed).
- Reviewer should scrutinize: the timing-safe compare is still applied to the
  full secret; the 401 paths return before any body parsing; header comments
  match the new env vars (they are the de-facto ops runbook).
- Interaction: ADR 0004 names these functions as service-role validators —
  no ADR change needed (the boundary is unchanged; only the secret material
  is decoupled).
