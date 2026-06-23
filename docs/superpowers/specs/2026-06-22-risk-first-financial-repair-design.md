# Risk-First Financial Repair Design

**Approved:** 2026-06-22

## Goal

Repair the highest-risk user-story failures first, preserving the documented
financial gates and making multi-write financial transitions atomic.

## Batch order

1. Granite invoice readiness and cargo-mode routing.
2. Audited Demurrage payment reversal.
3. Atomic Demurrage invoice creation.
4. Atomic batch readiness and invoice creation.

## Design

### Granite

- Calculating Granite charges must not call invoice creation while the B/L is
  merely `calculated`.
- Automatic issue must promote the Granite B/L to `ready_for_billing` before
  calling `create_invoice_from_granite_bls`.
- Manual issue in Validation must route `cargo_mode = granito` to the Granite
  invoice RPC and every other cargo mode to the local-charge ledger RPC.

### Demurrage reversal

- `/demurrage` must use the same admin-only, justification-required
  `reverse_demurrage_payment` RPC as `/reconciliacao`.
- Reversal clears payment date, PIX TXID, and the extract-conciliation flag and
  records the supplied justification in `audit_logs`.

### Atomic creation

- Demurrage invoice header and item snapshots must be created by one RPC.
- Batch local billing must not leave successfully promoted B/Ls without their
  intended invoice when invoice creation fails.

## Security and rollout

- Privileged RPCs validate an authenticated active admin.
- Functions use a controlled `search_path`; `PUBLIC` and `anon` execution are
  revoked.
- New frontend code depending on a migration must deploy only after that
  migration is applied.
- Live database verification remains blocked until a disposable linked
  Supabase environment is available; focused SQL contract tests are required
  locally meanwhile.

## Verification

Each repair starts with a focused failing test. After it passes, affected user
stories are retested, the canonical workbook is regenerated, and the final
project gates are `docs:check`, lint, full tests, and build.
