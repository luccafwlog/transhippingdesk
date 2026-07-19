# Task 4B — Demurrage decomposition report

## Scope delivered

Decomposed only `src/pages/Demurrage.tsx`. The page remains the owner of route
composition, search/tab/modal state, TanStack Query calls, mutations,
confirmation, toast feedback, cache invalidation and service calls. No service,
schema, migration, route, public contract or unrelated page was changed.

## Files changed

- Modified `src/pages/Demurrage.tsx` — composition and screen state only.
- Added `src/components/demurrage/DemurrageContainersTab.tsx` — containers
  search/table presentation and page callbacks.
- Added `src/components/demurrage/DemurrageInvoicesTab.tsx` — invoice-status
  table presentation and page callbacks.
- Added `src/components/demurrage/DemurrageCustomersTab.tsx` — customer summary
  accordion presentation and page callbacks.
- Added `src/components/demurrage/PtaxModal.tsx` — manual PTAX input/parsing
  flow; the page still runs the mutation and toast feedback.
- Added `src/components/demurrage/PaymentModal.tsx` — manual payment form; the
  page still resolves ROE and runs the payment mutation.
- Added `src/components/demurrage/DiscountModal.tsx` and `DisputeModal.tsx` —
  controlled form presentation; validation and mutations remain in the page.
- Added `src/components/demurrage/CustomerReportModal.tsx` — report print
  wrapper around the existing `CustomerSummaryReport`.
- Added `src/components/demurrage/__tests__/PaymentModal.behavior.test.tsx` —
  regression check for payment ID/date submission.
- Updated `docs/RASTREABILIDADE.md` and `docs/modules/demurrage.md` to map the
  page, tab components and named modal flows using **Código**/**Teste** labels.

## Extraction rationale

The existing demurrage services already own all correlated access and domain
rules (`demurrageContainers`, `demurrageInvoices`, `demurrageKpis`,
`demurragePresentation` and form schemas). Moving them would broaden the change
without improving the new UI boundaries. Each extracted component receives data
and callbacks from the page, keeping state transitions, mutations, errors,
accessibility attributes and styling unchanged at the route owner.

## Test cycle and verification

| Command | Result |
|---|---|
| `npm test -- src/components/demurrage/__tests__ src/services/demurrage/__tests__` | Baseline: 11 files, 46 tests passed. |
| `npm test -- src/components/demurrage/__tests__/PaymentModal.behavior.test.tsx` | Red: failed as expected because `../PaymentModal` did not exist. |
| `npm test -- src/components/demurrage/__tests__/PaymentModal.behavior.test.tsx` | Green: 1 file, 1 test passed after the component was added. |
| `npm run typecheck` | Passed (`tsc -b`). |
| `npm run docs:check` | Passed: 181 Markdown files, 39 routes and ADR index coverage verified. |
| `npm run lint` | Passed (`eslint .`). |
| `npm test` | Passed: 265 files / 1,097 tests passed; 1 file / 9 tests skipped. |
| `npm run build` | Passed (`tsc -b && vite build`). |
| `git diff --check` | Passed with no whitespace errors. |

## Line counts and self-review

- `src/pages/Demurrage.tsx`: 978 lines before; 446 lines after (532-line,
  54.4% reduction; below the 1,000-line target).
- New focused components: Containers 140, Invoices 118, Customers 79,
  Discount 72, Dispute 61, PTAX 51, Payment 35, Customer Report 23 lines.
- Self-review confirmed the page retains the existing query keys, `staleTime`,
  query enablement, mutations, confirmation, invalidations, toast copy,
  document printing, input validation and route behavior. `git diff --check`
  reported no whitespace issues.

## Concerns

No known functional concerns. The validation is automated/unit/build coverage;
no live browser or Supabase runtime scenario was executed in this task.
