# Task 3 — Service giant-function refactors

## Scope and files

- `src/services/billing.ts`
- `src/services/voyageSummaries.ts`
- `.superpowers/sdd/task-3-report.md`

No route, database schema, RPC contract, or exported function signature changed.

## Extraction rationale

### `listInvoiceDetails`

The exported function is now the ordered orchestration of its existing RPC,
Granite fallback, consolidated-ledger hydration, and PIX backfill. Pure helpers
own the deterministic work for payload normalization, Granite B/L mapping,
consolidated voyage-id extraction/map construction, consolidated B/L mapping,
breakdown grouping, item reconstruction, and PIX eligibility. The Supabase
queries remain in the same order and retain their existing error/fallback
semantics.

### `buildVoyageTimeline`

The exported function now composes pure event builders grouped by source/event
type: import and CE coverage, Baplie/divergence, schedule changes, completion,
audited voyage events, and reconciliation resolutions. Event IDs, titles,
details, timestamps, ordering tie-breaks, and actor formatting remain in the
same order and use the same values as before.

## Verification

Baseline before refactoring:

```sh
npx vitest run \
  src/services/__tests__/graniteInvoiceDetail.test.ts \
  src/services/__tests__/billing.test.ts \
  src/services/__tests__/billingHelpers.test.ts \
  src/services/__tests__/billingLedger.test.ts \
  src/services/__tests__/billingCancelInvoice.test.ts \
  src/services/__tests__/billingCancelPrivilegesMigration.test.ts \
  src/services/__tests__/billingCoreWrapperPrivilegesMigration.test.ts \
  src/services/__tests__/voyageSummaries.omitted.test.ts \
  src/services/__tests__/voyageSummaries.proximaEscala.test.ts \
  src/services/__tests__/voyageTimeline.test.ts \
  src/pages/__tests__/viagensHelpers.test.ts \
  src/pages/__tests__/voyageTimeline.behavior.test.ts
```

Result: 12 test files passed; 117 tests passed.

After refactoring:

```sh
npm run typecheck
npm run lint -- src/services/billing.ts src/services/voyageSummaries.ts
npx vitest run \
  src/services/__tests__/graniteInvoiceDetail.test.ts \
  src/services/__tests__/billing.test.ts \
  src/services/__tests__/billingHelpers.test.ts \
  src/services/__tests__/billingLedger.test.ts \
  src/services/__tests__/billingCancelInvoice.test.ts \
  src/services/__tests__/billingCancelPrivilegesMigration.test.ts \
  src/services/__tests__/billingCoreWrapperPrivilegesMigration.test.ts \
  src/services/__tests__/voyageSummaries.omitted.test.ts \
  src/services/__tests__/voyageSummaries.proximaEscala.test.ts \
  src/services/__tests__/voyageTimeline.test.ts \
  src/pages/__tests__/viagensHelpers.test.ts \
  src/pages/__tests__/voyageTimeline.behavior.test.ts
```

Results: typecheck passed; targeted lint passed; 12 test files and 117 tests
passed.

Completion checks:

```sh
npm run docs:check && npm run lint && npm test && npm run build
```

Results: documentation check passed (175 Markdown files, 39 routes, ADR index
coverage); full lint passed; 264 test files and 1,095 tests passed (one file
and nine tests skipped); production build passed.

## Self-review and concerns

`git diff --check` passed. The diff was reviewed for query sequence, fallback
conditions, event ordering, and public API preservation. No concerns identified.

## Fix — Important Slice 3 review finding

Restored `buildCeCoverageTimeline` to the original positive eligibility
condition (`total > 0` and `filled >= total`), so non-comparable numeric inputs
such as `NaN` do not emit a coverage event. Added a focused regression test in
`src/services/__tests__/voyageTimeline.test.ts`.

Verification:

```sh
npx vitest run src/services/__tests__/voyageTimeline.test.ts -t "não emite cobertura"
```

Result before the fix: failed as expected (1 failed, 3 skipped), proving the
regression test detected the inverse-guard behavior.

```sh
npx vitest run src/services/__tests__/voyageTimeline.test.ts
npx vitest run src/services/__tests__/graniteInvoiceDetail.test.ts src/services/__tests__/billing.test.ts src/services/__tests__/billingHelpers.test.ts src/services/__tests__/billingLedger.test.ts src/services/__tests__/billingCancelInvoice.test.ts src/services/__tests__/billingCancelPrivilegesMigration.test.ts src/services/__tests__/billingCoreWrapperPrivilegesMigration.test.ts src/services/__tests__/voyageSummaries.omitted.test.ts src/services/__tests__/voyageSummaries.proximaEscala.test.ts src/services/__tests__/voyageTimeline.test.ts src/pages/__tests__/viagensHelpers.test.ts src/pages/__tests__/voyageTimeline.behavior.test.ts
npm run typecheck
npm run lint -- src/services/voyageSummaries.ts src/services/__tests__/voyageTimeline.test.ts
git diff --check
```

Results: focused timeline test passed (1 file, 4 tests); targeted suite passed
(12 files, 118 tests); typecheck passed; targeted lint passed; and diff check
passed.

Self-review: only the coverage guard, its focused regression test, and this
report section changed. No unrelated refactor behavior was modified.
