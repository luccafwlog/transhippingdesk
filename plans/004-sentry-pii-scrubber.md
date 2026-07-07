# Plan 004: Add a Sentry `beforeSend` scrubber so DB errors can't ship PII

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat a894c5d..HEAD -- src/lib/telemetry.ts src/lib/__tests__`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `a894c5d`, 2026-07-07

## Why this matters

`reportBestEffortFailure` and `reportCaughtException` forward raw
Supabase/PostgREST error objects (plus arbitrary `meta`) to Sentry.
Postgres error messages routinely embed row values — a unique-constraint
violation on a customer document or email echoes the offending value into the
message. `Sentry.init` sets `sendDefaultPii: false`, but that only suppresses
Sentry's auto-collected PII (IP, user context), not payload contents. Result:
customer CNPJ/CPF and emails can end up retained in a third-party error
tracker. A `beforeSend` scrubber closes the gap at the single choke point.

## Current state

- `src/lib/telemetry.ts` — the only Sentry integration point (all reporting
  helpers live here; the DSN at line 9 is public by design — leave it).

  ```ts
  // src/lib/telemetry.ts:16-22
  Sentry.init({
    dsn: SENTRY_DSN,
    release: (import.meta.env.VITE_APP_COMMIT_SHA as string | undefined) || undefined,
    // Sem replay/tracing: só captura de erros, mantendo payloads mínimos.
    sendDefaultPii: false,
  })
  ```

  ```ts
  // src/lib/telemetry.ts:47-51
  Sentry.captureException(error, {
    tags: { context, kind: 'best-effort' },
    extra: meta,
  })
  ```

- Representative call sites (do NOT modify them — the fix is central):
  `src/services/billing.ts:137`, `src/services/operationalEvents.ts:39`,
  `src/components/ErrorBoundary.tsx:28`.
- Test conventions: unit tests live in `src/lib/__tests__/*.test.ts`
  (Vitest, `describe`/`it`/`expect`; see `src/lib/__tests__/errors.test.ts`
  as the structural pattern). Comments in this file are pt-BR — match.
- Domain formats to scrub (Brazilian):
  - CNPJ: `NN.NNN.NNN/NNNN-NN` and 14 contiguous digits
  - CPF: `NNN.NNN.NNN-NN` and 11 contiguous digits
  - Email: standard `local@domain` shape

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci --legacy-peer-deps` | exit 0 |
| Focused test | `npm test -- telemetry` | all pass |
| Tests | `npm test` | all pass |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |

## Scope

**In scope** (the only files you should modify/create):
- `src/lib/telemetry.ts`
- `src/lib/__tests__/telemetry.test.ts` (create)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):
- Any `reportBestEffortFailure`/`reportCaughtException` call site — the fix is
  centralized on purpose.
- The DSN constant (public by design, documented at `telemetry.ts:6-9`).
- Adding Sentry replay/tracing — explicitly excluded by the existing comment.

## Git workflow

- Branch: use the branch the operator designates (or `advisor/004-sentry-pii-scrubber`).
- Commit message style: `fix(security): beforeSend do Sentry redige CNPJ/CPF/email`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Implement an exported scrub helper

In `src/lib/telemetry.ts`, add an exported pure function (exported so it is
unit-testable without initializing Sentry):

```ts
// Redige padroes de PII (CNPJ, CPF, email) em qualquer string do evento.
export function scrubPii(text: string): string
```

Behavior: replace, in order, (1) formatted CNPJ, (2) formatted CPF,
(3) emails, (4) contiguous 14-digit runs, (5) contiguous 11-digit runs, each
with a fixed token like `[cnpj]`, `[cpf]`, `[email]`, `[digits14]`,
`[digits11]`. Order matters: formatted patterns before bare-digit patterns.
Use `replace(/…/g, …)` with regexes defined as module constants.

Also add a recursive `scrubEventValue(value: unknown): unknown` (bounded
depth, e.g. 4) that applies `scrubPii` to strings inside plain
objects/arrays, used for `extra`.

**Verify**: `npm run lint` → exit 0.

### Step 2: Wire `beforeSend`

In `initTelemetry`'s `Sentry.init`, add a `beforeSend(event)` that:

- maps over `event.exception?.values`, scrubbing each `value` (the message)
  with `scrubPii`;
- scrubs `event.message` if present;
- replaces `event.extra` with `scrubEventValue(event.extra)` when set;
- scrubs `event.breadcrumbs[].message` when present;
- returns the event (never `null` — we redact, not drop).

Keep the existing init options untouched. Add a brief pt-BR comment stating
why (DB errors echo row values; `sendDefaultPii:false` doesn't cover payload
contents).

**Verify**: `npm run build` → exit 0.

### Step 3: Unit tests

Create `src/lib/__tests__/telemetry.test.ts` (model on
`src/lib/__tests__/errors.test.ts`), covering `scrubPii`/`scrubEventValue`:

1. formatted CNPJ (`12.345.678/0001-95`) → `[cnpj]`
2. formatted CPF (`123.456.789-09`) → `[cpf]`
3. email inside a Postgres-style message
   (`duplicate key value violates unique constraint … Key (email)=(a@b.com) already exists`)
   → contains `[email]`, not the address
4. bare 14-digit and 11-digit runs → `[digits14]` / `[digits11]`
5. non-PII text passes through unchanged (e.g. an error message with a UUID
   and a 5-digit number)
6. `scrubEventValue` scrubs nested `{ meta: { note: '<cpf here>' } }` and
   leaves numbers/booleans/null untouched

**Verify**: `npm test -- telemetry` → all new tests pass.

## Test plan

See Step 3 (6 cases). Full-suite verification: `npm test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "beforeSend" src/lib/telemetry.ts` → ≥1 match inside `Sentry.init`
- [ ] `src/lib/__tests__/telemetry.test.ts` exists; `npm test -- telemetry` passes
- [ ] `npm run lint`, `npm test`, `npm run build` all exit 0
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `src/lib/telemetry.ts` no longer matches the "Current state" excerpts
  (e.g. a `beforeSend` already exists — reconcile instead of duplicating).
- The installed `@sentry/react` types reject the `beforeSend` signature above
  after one honest fix attempt — report the type error verbatim.
- You are tempted to scrub at call sites or change `normalizeError` semantics
  — that's out of scope; the console output intentionally keeps full detail
  for local debugging.

## Maintenance notes

- False-positive risk: any legitimate 11/14-digit identifier (e.g. some
  carrier references) will be redacted in Sentry messages. That is the
  accepted trade-off; if it hampers debugging, tighten the bare-digit regexes
  with boundary checks rather than removing them.
- If Sentry replay or tracing is ever enabled (currently excluded by
  design), the scrubber must be extended to those payloads
  (`beforeSendTransaction`, replay masking).
- Reviewer should scrutinize: regex ordering (formatted before bare digits)
  and that `beforeSend` returns the event object (returning `null` would
  silently drop error reports).
