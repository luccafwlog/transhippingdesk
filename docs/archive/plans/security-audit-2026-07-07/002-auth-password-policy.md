# Plan 002: Raise the auth password floor and pin the signup posture

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/security-audit-2026-07-07/README.md`.
>
> **Drift check (run first)**: `git diff --stat a894c5d..HEAD -- supabase/config.toml src/pages/PortalResetPassword.tsx docs/adr`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `a894c5d`, 2026-07-07

## Why this matters

The project's whole authorization model (ADR 0004) treats "holds the
`authenticated` role" as a provisioned, trusted principal. Two version-
controlled settings undermine that assumption: the auth config allows
6-character passwords with no complexity class, and `enable_signup = true`.
The Portal reset screen asks for 8+ characters client-side, but the client is
UX-only by design — the server floor is what counts, and today it is weaker
than the UX. If the production project mirrors open signup, an attacker could
self-register, obtain `authenticated`, and reach any permissively-scoped
surface (this directly amplified the finding fixed in plan 001). This plan
raises the version-controlled floor, aligns the client, and documents the
production posture so it is checkable instead of assumed.

## Current state

- `supabase/config.toml` — the version-controlled Supabase config (local/dev
  template; production auth settings live in the Supabase dashboard). Today:
  - line 170: `enable_signup = true`
  - line 176: `minimum_password_length = 6`
  - line 179: `password_requirements = ""`
  - line 222: `secure_password_change = false`
- `src/pages/PortalResetPassword.tsx:62-65` — the only client-side strength
  check on the external customer Portal:

  ```ts
  if (password.length < 8) {
    setError('A senha deve ter no minimo 8 caracteres.')
    return
  }
  ```

- Portal accounts are provisioned by internal admins via the
  `provision-portal-user` Edge Function (Supabase Admin API — **not** affected
  by `enable_signup`). Internal users are created manually in the dashboard
  (`README.md` "Usuário interno"). No self-service signup UI exists in `src/`
  (verify: `grep -rn "signUp" src/` returns nothing).
- ADR conventions: decisions live in `docs/adr/NNNN-slug.md`, numbered
  sequentially (latest today: `0018`), indexed in `docs/adr/README.md`.
  Error copy in the Portal is pt-BR without accents in string literals (see
  the excerpt above — match that).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci --legacy-peer-deps` | exit 0 |
| Tests | `npm test` | all pass |
| Lint | `npm run lint` | exit 0 |
| Docs check | `npm run docs:check` | exit 0 |
| Build | `npm run build` | exit 0 |

## Scope

**In scope** (the only files you should modify/create):
- `supabase/config.toml` (auth password settings + signup flag)
- `src/pages/PortalResetPassword.tsx` (client validation message/rule)
- `docs/adr/0019-politica-de-senha-e-signup-fechado.md` (create) and
  `docs/adr/README.md` (index entry)
- `docs/plans/security-audit-2026-07-07/README.md` (status row)

**Out of scope** (do NOT touch):
- The Supabase **production dashboard** — changing it is an operator action;
  this plan only documents what must be set (see Step 4).
- `supabase/functions/provision-portal-user/` — the Admin API path already
  generates strong random passwords; no change needed.
- Any migration file.

## Git workflow

- Branch: use the branch the operator designates (or `advisor/002-auth-password-policy`).
- Commit message style: `fix(security): eleva piso de senha e fecha signup no config de auth`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Raise the config floor

In `supabase/config.toml`:
- set `minimum_password_length = 8`
- set `password_requirements = "lower_upper_letters_digits"`
- set `enable_signup = false` (accounts are provisioned via Admin API and
  dashboard; neither path is affected by this flag)
- set `secure_password_change = true`

**Verify**: `grep -n "minimum_password_length\|password_requirements\|enable_signup = \|secure_password_change" supabase/config.toml`
→ shows the four new values (note `enable_signup` also appears under
`[auth.sms]`/other blocks — only change the one in the main `[auth]` block,
line ~170).

### Step 2: Align the Portal client rule

In `src/pages/PortalResetPassword.tsx`, extend the existing check so it
matches the server policy: minimum 8 characters AND at least one lowercase
letter, one uppercase letter, and one digit. Keep the existing error-state
pattern (`setError(...)` + `return`) and pt-BR copy without accents, e.g.
`'A senha deve ter no minimo 8 caracteres, com letra maiuscula, minuscula e numero.'`

**Verify**: `npm run lint` → exit 0; `npm run build` → exit 0.

### Step 3: Record ADR 0019

Create `docs/adr/0019-politica-de-senha-e-signup-fechado.md` following the
structure of `docs/adr/0013-portal-auth-identificador-resolvido-e-excecao-anon.md`
(Status/Contexto/Decisão/Consequências, pt-BR). Decision content: password
floor is 8 + `lower_upper_letters_digits`, self-signup is disabled everywhere
(accounts are provisioned), and the production dashboard must mirror these
values. Add the entry to `docs/adr/README.md`.

**Verify**: `npm run docs:check` → exit 0.

### Step 4: Operator checklist (report, don't do)

In your completion report, include this manual checklist for the operator —
these are production-dashboard settings this repo cannot change:

1. Supabase Dashboard → Authentication → Sign In / Up: confirm
   **self-signup disabled**.
2. Authentication → Policies/Passwords: minimum length ≥ 8, requirements
   `lower_upper_letters_digits` (or stricter).
3. Confirm existing Portal users are unaffected (policy applies to new
   passwords only).

## Test plan

- No new automated test is required for the config values (they are consumed
  by the Supabase CLI, not the app). The client rule change is exercised by
  lint/build; if `src/pages/__tests__/` contains a PortalResetPassword test
  (check first: `ls src/pages/__tests__ 2>/dev/null | grep -i reset`), extend
  it with one weak-password case asserting the error message renders.
- Verification: `npm test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "minimum_password_length = 8" supabase/config.toml` → 1 match
- [ ] `grep -n 'password_requirements = "lower_upper_letters_digits"' supabase/config.toml` → 1 match
- [ ] Main `[auth]` block has `enable_signup = false`
- [ ] `src/pages/PortalResetPassword.tsx` enforces length ≥ 8 + composition
- [ ] `docs/adr/0019-…` exists and is indexed in `docs/adr/README.md`
- [ ] `npm run lint`, `npm test`, `npm run docs:check`, `npm run build` all exit 0
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `docs/plans/security-audit-2026-07-07/README.md` status row updated; operator checklist included in the report

## STOP conditions

Stop and report back (do not improvise) if:

- `grep -rn "signUp(" src/` returns any production call site — the
  `enable_signup = false` assumption would be wrong; report the call site.
- `supabase/config.toml` lines 170/176/179 don't match the "Current state"
  values (someone already changed the policy).
- Local Supabase tooling in this repo (seeds/scripts under `supabase/seeds/`,
  `scripts/design-audit/`) turns out to depend on public signup — report
  which script instead of relaxing the flag.

## Maintenance notes

- The real enforcement point is the **production dashboard**; the config.toml
  change prevents the weak posture from being re-seeded into new environments
  and makes the decision reviewable. The ADR is what makes the dashboard
  setting auditable later.
- Reviewer should scrutinize: that only the `[auth]`-block `enable_signup`
  changed (other `enable_signup` keys exist under provider sub-blocks), and
  that the client copy stays accent-free pt-BR like its neighbors.
- Deferred (intentionally out of scope): breached-password (HIBP) checking —
  Supabase offers it on paid tiers; revisit when plan pricing allows.
