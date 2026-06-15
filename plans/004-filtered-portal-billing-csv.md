# Plan 004: Make portal billing CSV exports respect active filters

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If a STOP condition occurs, stop and report; do not improvise.
>
> **Drift check (run first)**: `git diff --stat 1224998..HEAD -- src/pages/PortalBilling.tsx src/pages/__tests__ src/lib/csv.ts`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `1224998`, 2026-06-15

## Why this matters

The Portal billing page lets customers filter invoices by status, vessel,
B/L, POD, and date. The "Exportar CSV" action currently exports all local-fee
invoices from the query result, ignoring the active filters and the active tab.
That creates a mismatch between what the customer is viewing and the file they
download, which is especially risky for finance workflows.

## Current state

- `src/pages/PortalBilling.tsx:116` computes `filteredInvoices`.
- `src/pages/PortalBilling.tsx:129` computes `filteredDemurrage`.
- `src/pages/PortalBilling.tsx:142` defines `handleExportCsv()`.
- `src/pages/PortalBilling.tsx:144` builds CSV rows from `(invoices ?? [])`, not `filteredInvoices`.
- `src/pages/PortalBilling.tsx:183-185` renders one `Exportar CSV` button in the page header, shared by both tabs.
- There is currently no `PortalBilling` component test under `src/pages/__tests__`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Focused tests | `npm test -- src/pages/__tests__/PortalBilling.test.tsx` | file passes |
| Full tests | `npm test` | all non-skipped tests pass |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/pages/PortalBilling.tsx`
- `src/pages/__tests__/PortalBilling.test.tsx` (create if absent)

**Out of scope**:
- `src/lib/csv.ts` unless mocking proves impossible. Prefer mocking `downloadCsv` in the test.
- Server-side filtering or RPC changes.
- Redesigning the billing page.

## Git workflow

- Branch: `codex/004-filtered-portal-billing-csv`
- Commit message example: `fix(portal): export filtered billing csv`.

## Steps

### Step 1: Add a component regression test

Create `src/pages/__tests__/PortalBilling.test.tsx` using the same jsdom style as `PortalOperacao.test.tsx`.

Mock:

- `usePortalAuth`.
- Billing hooks from `src/hooks/usePortalBilling`.
- `downloadCsv` from `src/lib/csv`.
- Toast if needed.

Test case:

- Provide at least two local invoices, one matching a B/L filter and one not.
- Type a B/L filter.
- Click `Exportar CSV`.
- Assert `downloadCsv` receives rows only for the filtered invoice.

If adding demurrage export support in this plan, add a second test that switches to the Demurrage tab and asserts demurrage rows are exported. If not, keep the export button disabled or local-only while on the demurrage tab; do not leave it silently exporting the wrong dataset.

**Verify**: focused test fails before implementation because unfiltered rows are exported.

### Step 2: Fix export behavior

In `PortalBilling.tsx`, change `handleExportCsv()` so it uses the currently active tab and filtered data:

- On `tab === 'local'`, export `filteredInvoices`.
- On `tab === 'demurrage'`, either export `filteredDemurrage` with demurrage-specific headers or hide/disable the header export action for that tab.

Prefer implementing demurrage export because the page already presents both tabs as peer invoice lists.

**Verify**: `npm test -- src/pages/__tests__/PortalBilling.test.tsx` passes.

### Step 3: Run full gates

**Verify**:
- `npm test` -> all non-skipped tests pass.
- `npm run lint` -> exit 0.
- `npm run build` -> exit 0.

## Test plan

- New `PortalBilling` component test for local filtered export.
- Optional but recommended: demurrage tab export test.
- Existing Portal operation/layout tests continue to pass.

## Done criteria

- [ ] CSV export matches the visible filtered local invoice list.
- [ ] Demurrage tab no longer silently exports unfiltered local invoices.
- [ ] New focused test passes and full gates pass.
- [ ] `plans/README.md` row 004 updated.

## STOP conditions

- The desired behavior is unclear between "export all customer invoices" and "export visible filtered results"; stop and ask rather than guessing.
- The test requires broad refactoring of `PortalBilling.tsx`.

## Maintenance notes

If server-side pagination is later added, revisit export semantics. "Visible page" and "all filtered results" are different product choices.
