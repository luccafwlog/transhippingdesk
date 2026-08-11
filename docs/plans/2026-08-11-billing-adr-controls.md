# Billing and ADR Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the missing production controls for setting an invoice due date and marking an omitted-voyage B/L as COD.

**Architecture:** Add a guarded invoice due-date update service/RPC and an admin-only control in the invoice detail modal. Make the existing B/L transshipment card render whenever a voyage omission exists, defaulting an unassigned B/L to transshipment so the existing COD mutation becomes reachable.

**Tech Stack:** React, TypeScript, TanStack Query, Supabase RPC/RLS, Vitest.

---

### Task 1: Lock the missing UI behaviors with regression tests

**Files:**
- Modify: `src/components/bl/__tests__/BlVisaoGeralTab.test.tsx`
- Modify: `src/components/billing/__tests__/InvoiceDetailModal.test.tsx` (or the nearest existing invoice-detail test file)

- [ ] Add a B/L overview test proving an omission with no existing disposition renders `Transbordo / COD` and `Marcar COD`.
- [ ] Add an invoice-detail test proving an open invoice exposes a due-date field and save action.
- [ ] Run the focused tests and verify they fail for the missing behavior.

### Task 2: Make COD reachable from the B/L overview

**Files:**
- Modify: `src/components/bl/BlVisaoGeralTab.tsx`
- Modify: `src/pages/BlDetalhe.tsx` only if the default disposition needs to be passed at the page boundary

- [ ] Derive `effectiveDisposition = disposition ?? 'transshipment'` when an omission exists.
- [ ] Render `BlTransshipmentCard` whenever `omission` exists, passing the effective disposition and existing mutation callbacks.
- [ ] Preserve the current restore behavior for an already persisted COD disposition.
- [ ] Run the B/L overview and transshipment hook tests.

### Task 3: Add guarded due-date editing for invoices

**Files:**
- Create: `supabase/migrations/20260811120000_update_invoice_due_date.sql`
- Modify: `src/services/billing.ts`
- Modify: `src/hooks/useBilling.ts`
- Modify: `src/components/billing/InvoiceDetailModal.tsx`
- Modify: `src/types/database.ts` if generated RPC typing requires it
- Add or modify: `src/services/__tests__/billing.test.ts`

- [ ] Add an authenticated, active-user RPC that updates `invoices.due_date` only for an open individual/consolidated invoice, records the actor, and rejects invalid dates.
- [ ] Add the typed service and mutation with query invalidation for invoice detail, invoice lists, financial alerts, and operation counts.
- [ ] Add an admin-only date input and save button to the invoice detail modal, initialized from the current due date.
- [ ] After saving, call the existing overdue detector so a past date transitions the invoice to `overdue` through the established workflow.
- [ ] Run the billing service and invoice-detail tests.

### Task 4: Full verification

**Files:**
- No additional files.

- [ ] Run focused B/L, billing, and migration-contract tests.
- [ ] Run `npm run docs:check`, lint, build, and `git diff --check`.
- [ ] Inspect `git diff` and report exactly which gates passed.
