# Final fix-wave report

Date: 2026-07-19

Branch: `codex/code-quality-audit-remediation`

Worktree: `/private/tmp/transhipping-desk-code-quality-remediation`

## Status

Complete. The final-review fix list was implemented without migration, schema,
route, package, lockfile, or intended production-flow changes.

## Implemented fixes

- Added parent-level Testing Library coverage for `Clientes` using real page
  composition and mocks at hook/service boundaries. The suite exercises create,
  parsed-base import, dependency-checked bulk delete, sort, row menu copy,
  mutation/service payloads, cache invalidation, navigation, selection clearing,
  and modal close/reset behavior.
- Added parent-level Testing Library coverage for `Demurrage` using real page
  composition and mocks at service boundaries. The suite exercises invoice
  generation, customer expansion and report printing, manual PTAX, invoice
  detail, discount, dispute, payment, cancellation, and payment reversal,
  including payloads, close/reset state, and query invalidations.
- Replaced `PreviewBox` label-derived KPI styling with an explicit optional
  `tone` prop. The neutral default is `navy`; all Veiculos KPI call sites now
  declare their intended tones.
- Added stable disclosure panel IDs plus `aria-expanded` and `aria-controls` to
  Demurrage customer and Taxas Locais charge-table disclosures. Visible and
  keyboard behavior is unchanged.
- Expanded `/taxas-locais` traceability with `ChargeTablesTab.tsx`,
  `ChargeTableFormCard.tsx`, `ChargeTableItemFormCard.tsx`, and
  `ChargeTablesList.tsx`.
- Checked every remediation-plan task/gate, moved the completed plan to
  `docs/archive/plans/`, removed the active index row, updated the archive
  index, and recorded the delivery in `docs/CHANGELOG.md`. The audit snapshot
  was not edited.

## Verification evidence

### Baseline

`npm test -- src/components/ui/PreviewBox.test.tsx src/components/taxasLocais/__tests__/TaxasLocais.behavior.test.tsx src/components/demurrage/__tests__/PaymentModal.behavior.test.tsx src/pages/__tests__/Clientes.portal-entry.test.tsx`

- Exit 0: 4 test files passed, 8 tests passed.

### Focused red/green work

`npm test -- src/pages/__tests__/Clientes.behavior.test.tsx src/pages/__tests__/Demurrage.behavior.test.tsx`

- Initial run exposed test-harness mismatches (ambiguous button names,
  unsupported jest-dom matchers, and the existing `{ invoice, items }` service
  response shape). Tests were corrected without production changes.

`npm test -- src/pages/__tests__/Clientes.behavior.test.tsx src/pages/__tests__/Demurrage.behavior.test.tsx src/components/ui/PreviewBox.test.tsx src/components/taxasLocais/__tests__/TaxasLocais.behavior.test.tsx`

- Red evidence: neutral `PreviewBox` styling and both disclosure ARIA contracts
  failed because the requested behavior was absent.
- Green evidence after the minimal production changes: exit 0, 4 test files
  passed, 15 tests passed.

### Required final gates

`npm run docs:check`

- Exit 0: documentation checks passed for 190 Markdown files, 39 routes, and
  ADR index coverage.

`npm run lint`

- Exit 0: ESLint completed with no errors or warnings.

`npm test`

- Exit 0: 268 test files passed, 1 skipped; 1,109 tests passed, 9 skipped.

`npm run build`

- Exit 0: `tsc -b` and Vite production build completed; 2,517 modules
  transformed.

`git diff --check`

- Exit 0 with no whitespace errors. `git diff --cached --check` and
  `git diff HEAD --check` also exited 0 because the lifecycle move was staged by
  `git mv` during verification.

## Self-review

- Re-read the complete fix-wave diff and both new page suites.
- Confirmed page tests interact through rendered controls and assert final
  service/mutation payloads rather than only child callback invocation.
- Confirmed `PreviewBox` preserves the previous Veiculos colors through
  explicit props and remains neutral for unspecified callers.
- Confirmed disclosure IDs are stable per persisted numeric ID and only the
  expanded panel is rendered, matching prior visible behavior.
- Confirmed plan archival/index/changelog changes are limited to the prescribed
  lifecycle and the historical audit remains untouched.

## Concerns

No blocking concerns. The automated tests use jsdom and mocked external data
boundaries; no browser smoke was run for responsive layout, table overflow, or
modal focus beyond the existing automated coverage.
