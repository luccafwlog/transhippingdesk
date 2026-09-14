# B/L Documental rail implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved B/L detail design with two independent rails: keep the Operational rail unchanged and replace the Financial rail with a Documental rail whose four cards explain the actionable gates for customer, local charges, CE Mercante, and invoice.

**Architecture:** Keep domain derivation in `src/services/blRails.ts`, pass the Documental projection into `BlRailsPipeline`, and keep `BlDetalhe` as the composition boundary. Use the existing server-side billing functions and invoice-link tables as authorities. Add migration `045_bl_documental_gates.sql` for universal CE enforcement at readiness/emission link boundaries, while retaining the existing Portal release helper as the CE authority for Portal visibility. Derive the header count from blocking core cards and treat Demurrage as an optional auxiliary indicator.

**Tech Stack:** React 19, TypeScript, React Router, TanStack Query, Tailwind-style utility classes, Vitest/Testing Library, Supabase PostgreSQL migrations and SQL contract tests.

---

## Task 1: Establish the Documental rail contract with failing unit tests

**Files:** `src/services/__tests__/blRails.test.ts`, `src/services/blRails.ts`

- [x] Replace the current financial-rail expectations with tests for exactly four core cards in this order: `Cliente`, `Taxas Locais`, `CE Mercante`, `Fatura`.
- [x] Add tests that map an unlinked customer, unresolved reconciliation, and a resolved customer to the `Cliente` card without exposing the word “Revisão”.
- [x] Add tests that distinguish only `Não calculado`, `Calculado`, `Isento`, and a reasoned `Bloqueado` for local charges; do not expose automatic/manual origin.
- [x] Add tests proving a missing CE is `blocked` for both `container` and `carga_solta`, with detail stating that it blocks emission and Portal.
- [x] Add tests for invoice states `draft`, `issued`, `partially_paid`, `paid`, `covered`, `cancelled`, and `obsolete`, ensuring no detail contains `vencida` or a due date.
- [x] Add tests for individual versus consolidated invoice presentation and ensure no separate Payment card is produced.
- [x] Add tests that count only blocking core cards in the Documental summary and that `pickNextAction` ignores optional Demurrage.
- [x] Run `npx vitest run src/services/__tests__/blRails.test.ts`; confirm the new assertions fail against the current implementation before changing production code.
- [x] Implement `buildDocumentalRail`, the summary projection, invoice-status normalization, and the next-action rule in `src/services/blRails.ts`; retain an intentional compatibility export only if an existing caller still requires it.
- [x] Re-run the focused test until it passes and run `npx tsc --noEmit` or the repository typecheck after the service shape stabilizes.

## Task 2: Render the approved two-rail interface

**Files:** `src/components/bl/BlRailsPipeline.tsx`, `src/components/bl/__tests__/BlRailsPipeline.test.tsx`, `src/pages/BlDetalhe.tsx`, `src/components/bl/BlReviewContextPanel.tsx`, `src/components/bl/__tests__/BlReviewContextPanel.test.tsx`

- [x] Write failing component tests for the `Documental` heading, `Sem pendências`/singular/plural summary, visible card state labels, and absence of `Financeiro`, `Revisão & Cliente`, and `Pagamento` in the pipeline.
- [x] Add an accessibility assertion that the state is available to assistive technology instead of being conveyed only by the colored dot.
- [x] Update `BlRailsPipeline` to receive `documental` and its summary, render the unchanged Operational rail, and show a concise “Próxima ação” linked to the first core blocker.
- [x] Update `BlDetalhe` to build and pass the Documental rail, carry invoice type/consolidation metadata, and stop mounting the standalone manual-review context panel as the primary status surface.
- [x] If the legacy context panel remains reachable for the review workflow, rename its user-facing copy to “Pendências documentais” and keep its correction link; add tests proving it does not present “Revisão” as the state of the B/L.
- [x] Re-run the focused component tests and typecheck.

## Task 3: Enforce the CE Mercante rule for every billing mode

**Files:** `src/services/__tests__/reviewBillingAutomation.test.ts`, `src/services/reviewBillingAutomation.ts`, `supabase/migrations/045_bl_documental_gates.sql`, `src/services/__tests__/blDocumentalGatesMigration.test.ts`

- [x] Add a failing automation test for `carga_solta` proving a missing CE blocks emission after a valid local-charge calculation, and a test proving adding CE allows the CE-triggered auto-billing path for `carga_solta`.
- [x] Add failing SQL-contract assertions that the new migration patches `mark_bl_ready_for_billing`, guards individual invoice linkage/emission, guards consolidated receivable linkage/emission, and preserves `SET search_path TO 'public', 'pg_temp'` plus explicit function ACLs.
- [x] Update `tryAutoIssueInvoice` to apply the CE gate universally and update `maybeAutoBillAfterCeMercante` to accept `carga_solta` as well as `container`/legacy empty mode.
- [x] Create `045_bl_documental_gates.sql` as an additive migration after active migration 044. Keep existing function signatures. Add a security-definer CE assertion at the final billing boundaries so direct/manual and consolidated paths cannot issue a B/L without CE, including the `invoice_receivable_links` path. Do not introduce due dates or change the Portal’s existing universal CE helper.
- [x] Add a focused SQL trigger/function contract test covering both `invoice_bls` and `invoice_receivable_links`; use a runtime local-Postgres test only if the repository’s controlled integration environment is available.
- [x] Run `npx vitest run src/services/__tests__/reviewBillingAutomation.test.ts src/services/__tests__/blDocumentalGatesMigration.test.ts` and typecheck.

## Task 4: Surface consolidated invoices in the B/L rail

**Files:** `src/services/__tests__/billing.test.ts` or a focused billing-link test, `src/services/billing.ts`, `src/services/__tests__/blRails.test.ts`

- [x] Add a failing service test showing that `listInvoiceLinksByBls` reads both direct `invoice_bls` rows and consolidated `invoice_receivable_links` rows, including `invoice_type`.
- [x] Extend `InvoiceLinkInfo` and the query/mapping to preserve invoice type and source while keeping permission errors best-effort as today.
- [x] Sort links deterministically by newest invoice id and let the Documental rail append `Individual` or `Consolidada` to the invoice detail.
- [x] Re-run the focused billing and rail tests.

## Task 5: Align documentation and canonical data wording

**Files:** `docs/spec/2026-09-14-bl-trilhos-documental-design.md`, `docs/spec/README.md`, `docs/modules/faturamento.md`, `docs/RASTREABILIDADE.md`, `docs/CHANGELOG.md`, `docs/plans/README.md`, `docs/archive/plans/2026-09-14-bl-trilhos-documental.md`, `docs/archive/specs/2026-09-14-bl-trilhos-documental-design.md`

- [x] Update the design document status from proposal to implemented/verified only after code and checks substantiate it.
- [x] Update the living billing/module trace to say that CE Mercante is required for container and loose cargo before invoice issuance, that consolidated links are surfaced, and that no overdue/due-date state is a product rule.
- [x] Add the approved spec and active plan to their living indexes while work is in progress.
- [x] After all tasks are complete, move the plan and originating spec to the archive in the same change, remove the active-plan/spec rows, and add a concise changelog entry with the migration number and test evidence.
- [x] Run `npm run docs:check` and `git diff --check`.

## Task 6: Verify, review, commit, push, and open the PR

**Files:** repository-wide verification; no additional product scope

- [x] Run focused tests for rails, pipeline, automation, billing links, and migration contracts.
- [x] Run `npm run typecheck`, `npm run lint`, `npm run build`, and the complete `npm test` suite.
- [x] Inspect `git diff`, verify every acceptance criterion from the approved design, and run the repository’s available accessibility/contrast checks when applicable.
- [x] Use `requesting-code-review` for an independent review of the final diff; fix all critical/important findings before closeout.
- [x] Use `finishing-a-development-branch` for the PR workflow, commit the focused implementation on `codex/bl-documental-rail`, push it to `origin`, and create a PR against `main` with summary, migration behavior, and the exact verification commands.
- [x] After opening the PR, monitor CI only until all checks finish, fix/push any failure, then report the PR URL and final CI state.
