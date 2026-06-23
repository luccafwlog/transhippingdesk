# Risk-First Financial Repairs Implementation Plan

## 1. Granite workflow

- Add failing tests for calculate → ready → invoice ordering.
- Add failing tests for cargo-mode invoice routing.
- Implement the minimum workflow service and wire both callers to it.
- Run focused Granite and billing tests.

## 2. Demurrage reversal

- Add a failing service/UI test requiring a non-empty justification.
- Route `/demurrage` through `reverse_demurrage_payment`.
- Add a failing migration contract test for clearing
  `conciliated_by_extract`, then add the migration.
- Run focused Demurrage and reconciliation tests.

## 3. Atomic Demurrage creation

- Characterize both invoice-creation entry points.
- Add a failing RPC contract/service test.
- Add one transactional RPC and replace separate header/item writes.
- Run focused calculation, creation, and migration tests.

## 4. Atomic batch billing

- Add a failing test reproducing promote-then-invoice failure.
- Add the smallest grouped transactional RPC compatible with consolidated
  customer invoices.
- Replace the split batch flow and run focused billing tests.

## 5. Retest and ledger

- Run every affected automated user story.
- Exercise available browser stories.
- Regenerate the canonical spreadsheet with fix and retest evidence.
- Run `npm run docs:check`, `npm run lint`, `npm test`, `npm run build`, and
  `git diff --check`.
