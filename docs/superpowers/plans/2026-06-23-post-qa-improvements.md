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
- [ ] Done

### Task 2 — Add `.gitattributes` to normalize line endings 🧹
**Problem:** the repo has no `.gitattributes` and `core.autocrlf=true` checks `.sql`/`.ts` out as CRLF on Windows, which already caused one false test failure (fixed by normalizing `\r\n` in `containerDateAuditMigration.test.ts`). Without a policy this recurs.

**Action:** add a `.gitattributes` with at least:
```
* text=auto eol=lf
*.sql text eol=lf
```
then renormalize (`git add --renormalize .`) and confirm the suite still passes.
**Acceptance:** fresh checkout has LF in `.sql`/`.ts`; migration-content tests pass without the normalization crutch.
- [ ] Done

---

## P1 — shallow coverage to deepen (or improve the behavior)

### Task 3 — Deepen the voyage quick-import test ⚡
**Problem:** `src/components/shared/__tests__/VoyageImportActions.behavior.test.tsx` (US-223) only asserts that the import buttons render — it does not prove the modal opens with the voyage id locked or that the importer is wired.
**Action:** add a test that clicking an action opens its importer modal scoped to the given `voyageId`; OR explicitly document the limit in the workbook note.
**Acceptance:** the story's evidence reflects real coverage of the voyage-scoped import, not just button presence.
- [ ] Done

### Task 4 — Cover the Granite "import with pending" path ⚡
**Problem:** US-079 ("aceitar ou rejeitar pendentes") is currently evidenced by the *pending alert* in `Granite.behavior.test.tsx`, not by actually importing with unresolved B/Ls.
**Action:** add a test that confirms importing a manifest that still has pending (unreconciled) B/Ls calls `importGraniteManifest` and that those B/Ls land without billing (the `pendingCount` path), and that the success toast reports the pendency.
**Acceptance:** the accept-with-pending flow is exercised end-to-end (mocked), not inferred from the warning banner.
- [ ] Done

### Task 5 — Remove the fragile `beforeEach(mockReset)` footgun 🧹
**Problem:** `src/services/__tests__/alertsTransitions.test.ts:18` (and any siblings) use `beforeEach(() => fromMock.mockReset())`. The arrow implicitly **returns** the mock, which Vitest treats as a cleanup hook and calls post-test (`from(undefined)`). It passes today by luck; it bit us once in `adminObservability.test.ts`.
**Action:** convert to a block body `beforeEach(() => { fromMock.mockReset() })` everywhere this pattern appears.
**Acceptance:** `grep -rn "beforeEach(() => fromMock.mockReset())" src` returns nothing.
- [ ] Done

---

## P2 — strategic / outside the code

### Task 6 — Deploy the new migrations to a controlled Supabase 🗄️
**Problem:** the atomic-write fixes (`save_granite_bl_review`, `import_breakbulk_manifest_transactional`, `set_import_batch_ce_master_atomic`, `import_vazios_transactional`, `save_bl_demurrage_config`, etc.) only take effect once their migrations are applied. They were validated on a disposable PostgreSQL 17 (148/148, 0 failed) but not on the live project.
**Action:** apply `supabase/migrations/` to a staging Supabase, smoke-test the Granite review / demurrage config / breakbulk-import flows, then promote.
**Acceptance:** the new RPCs exist on the target project; the dependent UI flows succeed against it.
- [ ] Done

### Task 7 — Version a summary of the canonical workbook 🧹
**Problem:** the audit ledger (`outputs/.../transhipping-desk-feature-audit.xlsx` + `build-feature-audit.mjs`) is intentionally **untracked**, so the repo has no committed record of the 223-story / 62-defect outcome.
**Action:** generate a Markdown summary (module x passed/total, defect list, run log) and commit it under `docs/`, or decide to track the builder script.
**Acceptance:** the QA-loop result is discoverable from the repo, not only from the local machine.
- [ ] Done

### Task 8 — UX review of "passing but thin" behaviors ⚡
**Problem:** many stories pass because the tests *characterize current behavior* — but "current behavior" is not always good UX. The tests now make change safe.
**Action:** do a dedicated pass listing stories whose behavior, though tested, should still improve (e.g. weak empty/error states, missing confirmations, silent truncation). Turn each into its own scoped task here.
**Acceptance:** a reviewed shortlist of genuine UX upgrades, each with a reproducing expectation, ready to implement behind the test net.
- [ ] Done

---

## Notes
- Items marked ⚡ change behavior the moment the branch is deployed; 🗄️ need the migrations live; 🧹 are internal only.
- Every change must keep the full suite green — that is the whole point of the safety net built by the QA loop.
