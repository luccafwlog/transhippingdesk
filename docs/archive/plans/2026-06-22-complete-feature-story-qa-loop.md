# Complete Feature Story QA Loop Implementation Plan

> **✅ Completed (2026-06-23).** All 223 stories Passed across the 11 modules; 62 defects fixed / 0 open; final gates green (`npm test` 729 pass/9 skip, `npm run lint`, `npm run docs:check`, `tsc -b && vite build`, `git diff --check`); disposable PostgreSQL replay 148/148. Follow-up findings live in [`2026-06-23-post-qa-improvements.md`](./2026-06-23-post-qa-improvements.md). The unchecked boxes below are historical roadmap detail, not pending work.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maintain one canonical workbook that inventories every user-visible feature, tests every code-derived user story, tracks defects, records focused fixes, and proves post-fix behavior.

**Architecture:** Seed stories from executable routes and the living module action catalogs, then reconcile each row against current pages, hooks, services, migrations, and tests. Use the workbook as the only status ledger. Test read-only and automated behavior first; run state-changing scenarios only in a confirmed controlled Supabase environment. Fix one verified defect at a time with a reproducing test, then rerun the affected story and the final repository gates.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, Supabase, browser runtime validation, `@oai/artifact-tool`, XLSX.

---

### Task 1: Establish the canonical inventory

**Files:**
- Read: `src/App.tsx`
- Read: `docs/modules/*.md`
- Read: `docs/RASTREABILIDADE.md`
- Create: `outputs/019eef6a-e93b-7bd0-b72f-3ac309ac810b/transhipping-desk-feature-audit.xlsx`

- [ ] Extract every action row from the living module catalogs.
- [ ] Reconcile all literal routes and redirects from `src/App.tsx`.
- [ ] Convert each action into a user story with preconditions and observable expected behavior.
- [ ] Add source paths, baseline evidence, test type, initial status, defect link, fix status, retest status, and notes.
- [ ] Verify workbook formulas, key ranges, and every rendered sheet.

### Task 2: Complete static and automated evidence

**Files:**
- Read: `src/pages/**`
- Read: `src/components/**`
- Read: `src/hooks/**`
- Read: `src/services/**`
- Read: `supabase/migrations/**`
- Test: existing focused Vitest suites

- [ ] For each story, confirm its current executable path and expected behavior.
- [ ] Link existing focused tests where they genuinely assert the behavior.
- [ ] Run the narrowest relevant suites and record command, result, and evidence.
- [ ] Mark unproved runtime behavior as not tested or blocked, never passed.

### Task 3: Execute user behavior scenarios

**Files:**
- Modify: canonical workbook only

- [ ] Classify the available environment as controlled, read-only, unavailable, or unknown without exposing secrets.
- [ ] Run public and read-only navigation scenarios.
- [ ] Run authenticated and state-changing scenarios only when authorized and controlled.
- [ ] Record each observed mismatch as a defect with reproduction, expected result, actual result, severity, and evidence.

### Task 4: Fix verified logistical and UX defects

**Files:**
- Modify: only files directly required by each verified defect
- Test: focused regression test for each defect
- Modify living documentation when routes, contracts, procedures, or architecture change

- [ ] Reproduce one defect with a failing focused test or deterministic runtime scenario.
- [ ] Implement the smallest correction.
- [ ] Run the focused check and update the defect row.
- [ ] Repeat until no verified in-scope logistical or UX defect remains.

### Task 5: Post-fix retest and completion

**Files:**
- Modify: canonical workbook

- [ ] Rerun every affected user story after its fix.
- [ ] Rerun all unaffected stories whose shared dependencies changed.
- [ ] Run `npm run docs:check`.
- [ ] Run `npm run lint`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.
- [ ] Confirm every story has a final evidence-backed status and every defect has a final disposition.

## Stop conditions

- **Complete:** every story has a final result; every verified logistical/UX defect is fixed or explicitly excluded with reason; post-fix retests and repository gates are recorded.
- **Blocked:** a story requires credentials, controlled data, an external service, or authority not available in the workspace.
- **Approval required:** destructive, production, financial, privacy-sensitive, or external-message actions are needed.
- **Stagnated:** repeated attempts produce no new evidence; record the blocker instead of looping.

