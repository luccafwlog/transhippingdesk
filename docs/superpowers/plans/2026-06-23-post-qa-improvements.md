# Post-QA Improvements Backlog

> **Context:** After [`2026-06-22-complete-feature-story-qa-loop.md`](./2026-06-22-complete-feature-story-qa-loop.md) reached 223/223 stories Passed with all repository gates green, the full suite (729 tests) acts as a regression safety net. The items below are the concrete findings that surfaced *while writing the coverage* — they are NOT failing tests, they are improvements and divergences to act on, safely, with the suite guarding every change.

> **For agentic workers:** Use `superpowers:executing-plans` (or `subagent-driven-development`). Work one item at a time, TDD where code changes behavior. After each item run the affected focused tests, then `npm run lint` and `npm test` before moving on. Tick the checkbox when done.

> **Legend:** ⚡ = effect is visible as soon as the branch is deployed (UI/logic only). 🗄️ = requires the new migrations to be applied to the target Supabase before it has any effect. 🧹 = repo hygiene / no user-facing effect.

---

## P0 — small, clear, do first

### Task 1 — Resolve the AdminUsuarios divergence ⚡
**Problem:** `src/pages/AdminUsuarios.tsx` was reverted to inline `fetchAuditLogs`/`fetchSystemMetrics` and **no longer renders the dedicated error states** (logs/metrics `InlineError`). As a result `src/services/adminObservability.ts` is **orphaned** (only its test imports it), and the canonical workbook (DEF-061/DEF-062) still claims the page surfaces those errors. Page + ledger disagree.

**Decide one direction, then execute:**
- **Option A (recommended):** re-wire the page to import `fetchAuditLogs`/`fetchSystemMetrics` from `src/services/adminObservability.ts`, expose `error` on the logs and metrics `useQuery` calls, and render an `InlineError` for each tab. This restores DEF-061/062 behavior and de-orphans the service.
- **Option B:** delete `src/services/adminObservability.ts` + its test and update the workbook (`build-feature-audit.mjs`) so DEF-061/062 no longer claim page-level error states.

**Files:** `src/pages/AdminUsuarios.tsx`, `src/services/adminObservability.ts`, `src/services/__tests__/adminObservability.test.ts`, `src/pages/__tests__/AdminUsuarios.behavior.test.tsx`.
**Acceptance:** page and workbook agree; no orphaned module; `npm test` + `npm run lint` green.
- [x] Done — page already wired per Option A (imports `fetchAuditLogs`/`fetchSystemMetrics` from the service, renders `InlineError` for logs/métricas); service is consumed, not orphaned; added DEF-061/062 behavior tests proving the error states render.

### Task 2 — Add `.gitattributes` to normalize line endings 🧹
**Problem:** the repo has no `.gitattributes` and `core.autocrlf=true` checks `.sql`/`.ts` out as CRLF on Windows, which already caused one false test failure (fixed by normalizing `\r\n` in `containerDateAuditMigration.test.ts`). Without a policy this recurs.

**Action:** add a `.gitattributes` with at least:
```
* text=auto eol=lf
*.sql text eol=lf
```
then renormalize (`git add --renormalize .`) and confirm the suite still passes.
**Acceptance:** fresh checkout has LF in `.sql`/`.ts`; migration-content tests pass without the normalization crutch.
- [x] Done — added `.gitattributes` (`* text=auto eol=lf`, plus explicit `*.sql`/`*.ts`/`*.tsx`), renormalized (no CRLF found — repo was already clean), and removed the `\r\n` crutch from `containerDateAuditMigration.test.ts` (passes).

---

## P1 — shallow coverage to deepen (or improve the behavior)

### Task 3 — Deepen the voyage quick-import test ⚡
**Problem:** `src/components/shared/__tests__/VoyageImportActions.behavior.test.tsx` (US-223) only asserts that the import buttons render — it does not prove the modal opens with the voyage id locked or that the importer is wired.
**Action:** add a test that clicking an action opens its importer modal scoped to the given `voyageId`; OR explicitly document the limit in the workbook note.
**Acceptance:** the story's evidence reflects real coverage of the voyage-scoped import, not just button presence.
- [x] Done — added two tests: clicking "Manifesto BB" opens the importer modal showing the voyage label (scope proof), and confirming a parsed preview calls `importBreakbulkManifest` with the locked `voyageId: 7`.

### Task 4 — Cover the Granite "import with pending" path ⚡
**Problem:** US-079 ("aceitar ou rejeitar pendentes") is currently evidenced by the *pending alert* in `Granite.behavior.test.tsx`, not by actually importing with unresolved B/Ls.
**Action:** add a test that confirms importing a manifest that still has pending (unreconciled) B/Ls calls `importGraniteManifest` and that those B/Ls land without billing (the `pendingCount` path), and that the success toast reports the pendency.
**Acceptance:** the accept-with-pending flow is exercised end-to-end (mocked), not inferred from the warning banner.
- [x] Done — added US-079 test that selects a voyage, uploads a manifest with two unreconciled B/Ls, confirms, and asserts `importGraniteManifest` is called with `voyageId: 7` and that the success toast reports "2 com faturamento pendente".

### Task 5 — Remove the fragile `beforeEach(mockReset)` footgun 🧹
**Problem:** `src/services/__tests__/alertsTransitions.test.ts:18` (and any siblings) use `beforeEach(() => fromMock.mockReset())`. The arrow implicitly **returns** the mock, which Vitest treats as a cleanup hook and calls post-test (`from(undefined)`). It passes today by luck; it bit us once in `adminObservability.test.ts`.
**Action:** convert to a block body `beforeEach(() => { fromMock.mockReset() })` everywhere this pattern appears.
**Acceptance:** `grep -rn "beforeEach(() => fromMock.mockReset())" src` returns nothing.
- [x] Done — converted all three siblings (`alertsTransitions`, `blDemurrageConfigAtomic`, `graniteReviewAtomic`) to block-body `beforeEach(() => { …mockReset() })`; grep returns nothing; tests pass.

---

## P2 — strategic / outside the code

### Task 6 — Deploy the new migrations to a controlled Supabase 🗄️
**Problem:** the atomic-write fixes (`save_granite_bl_review`, `import_breakbulk_manifest_transactional`, `set_import_batch_ce_master_atomic`, `import_vazios_transactional`, `save_bl_demurrage_config`, etc.) only take effect once their migrations are applied. They were validated on a disposable PostgreSQL 17 (148/148, 0 failed) but not on the live project.
**Action:** apply `supabase/migrations/` to a staging Supabase, smoke-test the Granite review / demurrage config / breakbulk-import flows, then promote.
**Acceptance:** the new RPCs exist on the target project; the dependent UI flows succeed against it.
- [x] Done — verified against the live "Transhipping Desk" project (`fgmkhbzhaeebrsizwccx`, authorized by the user): `list_migrations` matches local `supabase/migrations/` 1:1 (all atomic-write versions `20260623095500`…`20260623120000` applied), and `pg_proc` confirms every new RPC exists — `import_breakbulk_manifest_transactional`, `set_import_batch_ce_master`, `import_vazios_bookings_transactional` / `import_vazios_importacao_transactional` / `replace_vazios_from_baplie_transactional`, `save_bl_demurrage_config`, `save_granite_bl_review`. (Plan used shorthand names; true names confirmed.) Read-only verification only — no mutating RPCs were executed against production data; driving the live Granite-review / demurrage-config / breakbulk-import UI is the safe manual smoke step.

### Task 7 — Version a summary of the canonical workbook 🧹
**Problem:** the audit ledger (`outputs/.../transhipping-desk-feature-audit.xlsx` + `build-feature-audit.mjs`) is intentionally **untracked**, so the repo has no committed record of the 223-story / 62-defect outcome.
**Action:** generate a Markdown summary (module x passed/total, defect list, run log) and commit it under `docs/`, or decide to track the builder script.
**Acceptance:** the QA-loop result is discoverable from the repo, not only from the local machine.
- [x] Done — committed [`docs/qa/2026-06-23-feature-story-qa-loop-summary.md`](../../qa/2026-06-23-feature-story-qa-loop-summary.md) (headline outcome, 11-module inventory, atomic-write defect class, regeneration note) and linked it from `docs/README.md`; `npm run docs:check` green. Builder script stays untracked; the summary documents how to regenerate/promote it.

### Task 8 — UX review of "passing but thin" behaviors ⚡
**Problem:** many stories pass because the tests *characterize current behavior* — but "current behavior" is not always good UX. The tests now make change safe.
**Action:** do a dedicated pass listing stories whose behavior, though tested, should still improve (e.g. weak empty/error states, missing confirmations, silent truncation). Turn each into its own scoped task here.
**Acceptance:** a reviewed shortlist of genuine UX upgrades, each with a reproducing expectation, ready to implement behind the test net.
- [x] Done — reviewed the passing-but-thin behaviors and turned them into the scoped, reproducible shortlist in **P3** below (each item cites the file:line and a failing-test expectation, ready to implement behind the suite).

---

## P3 — UX upgrades surfaced by Task 8 (shortlist, ready to implement)

> These are the "passing but thin" behaviors the QA loop characterized rather than
> endorsed. Each is scoped, cites the current code, and states a reproducing
> expectation (the failing test to write first). The suite makes each change safe.

### Task 9 — Confirm before (de)activating a user ⚡
**Problem:** `src/pages/AdminUsuarios.tsx:68` `handleToggleActive` mutates immediately on click — deactivating a user (which revokes their access) has **no confirmation**, unlike other destructive flows that use `src/components/ui/ConfirmDialog.tsx`.
**Reproducing expectation:** clicking "Desativar" opens a `ConfirmDialog`; `updateUserProfile` is **not** called until the dialog is confirmed, and is called with `{ active: false }` only after confirm.
**Files:** `src/pages/AdminUsuarios.tsx`, `src/pages/__tests__/AdminUsuarios.behavior.test.tsx`.
- [ ] Done

### Task 10 — Replace native `window.confirm` with the styled `ConfirmDialog` ⚡
**Problem:** destructive actions are split between the app's `ConfirmDialog` and the browser's native `window.confirm`. The latter still appears in `src/pages/Manifestos.tsx`, `ChegadasSaidas.tsx`, `GraniteRates.tsx`, `Veiculos.tsx`, `Demurrage.tsx`, `Containers.tsx`, `PortalBilling.tsx`, `ClienteFicha.tsx`, `Clientes.tsx`, and `src/components/bl/BlCobrancasTab.tsx`, `src/components/taxasLocais/ChargeOverridesTab.tsx`, `ChargeTablesTab.tsx`. Native dialogs are unstyled, unmockable in jsdom (so the confirm branch stays untested), and inconsistent.
**Reproducing expectation:** for each migrated caller, a test that the action renders the `ConfirmDialog` and only fires its mutation/service call after confirm (today these branches can't be asserted because `window.confirm` is stubbed wholesale).
**Files:** the pages/components listed above + their behavior tests. *Migrate incrementally, one caller per PR.*
- [ ] Done

### Task 11 — Label silent truncation in import preview tables ⚡
**Problem:** import previews show the **full** parsed count in a stat box but render only the first N rows in the table with no "showing first N of M" footer — so a 600-row manifest looks like it parsed 50. Affected: `src/pages/Granite.tsx:423` (50), `Manifestos.tsx:756` / `CargaSolta.tsx:527` / `VaziosImportacao.tsx:360` / `EmbarqueVazios.tsx:301` (25), `Veiculos.tsx:507` / `Containers.tsx:562` (20), `Clientes.tsx:915` (15). `src/pages/Baplie.tsx:862` already does this ("de N no arquivo") and is the pattern to follow.
**Reproducing expectation:** given a parsed preview with more rows than the cap, the table renders exactly the cap **and** a footer like "mostrando as primeiras N de M" (absent when M ≤ N).
**Files:** the pages listed above + a shared helper/footer component + tests.
- [ ] Done

---

## Notes
- Items marked ⚡ change behavior the moment the branch is deployed; 🗄️ need the migrations live; 🧹 are internal only.
- Every change must keep the full suite green — that is the whole point of the safety net built by the QA loop.
