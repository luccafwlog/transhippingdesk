# Ledger Faturamento Phase 4b Implementation Plan

> Execute task-by-task. Steps use checkbox (`- [ ]`). Execute only the next unmarked block, verify, mark it, commit small.

**Goal:** Route local-charge invoice payments through the transactional ledger RPC `register_ledger_invoice_payment`, so that paying a **consolidated** invoice settles its receivables and covers the individuals, and paying an **individual** settles its receivable and makes any open consolidated obsolete. This closes the Phase 3 gap ("consolidated invoices must be paid via the ledger").

**Decisions:**
1. **Routing rule (safe coexistence):** a payment goes through `register_ledger_invoice_payment` when the invoice is a local-charge ledger document — `invoice_type ∈ {individual, consolidated}` — **and** has no prior legacy payment (`total_paid_brl == 0`). Otherwise (granite, or an invoice already partially paid through the legacy flow before this cutover) it keeps using the legacy `register_invoice_payment`. This avoids double-counting receivable balances for invoices that were mid-payment at cutover.
2. **Full settlement only for the ledger path** (per spec: partial-per-receivable is out of scope). For ledger-routed invoices the amount is the invoice's open `balance_brl`; the amount field is locked and the RPC validates `amount == open receivable balance`.
3. Granite and Demurrage payment flows are unchanged.

**Architecture:** The payment modal in `Faturamento.tsx` calls `useRegisterInvoicePayment` (legacy). We add `useRegisterLedgerInvoicePayment` (already exists from Phase 2) and branch in `handleRegisterPayment` based on the selected invoice's `invoice_type`/`total_paid_brl` (available from `detailQuery.data.invoice`, which is `TO_JSONB(invoices.*)`). The ledger hook's invalidation is extended to refresh the open invoice detail.

**Tech Stack:** React/TypeScript, TanStack Query. No migration.

---

## Scope Boundary

In scope: payment routing in the invoice payment modal, full-settlement UX for ledger invoices, ledger-hook invalidation of the invoice detail.

Out of scope: PIX reconciliation cutover (4c), portal/report balances (4d), partial payments on ledger invoices, Demurrage, granite payment changes.

## File Structure

- Modify `src/hooks/useBillingLedger.ts` — invalidate the invoice detail after a ledger payment.
- Modify `src/pages/Faturamento.tsx` — branch the payment handler; lock/prefill the amount for ledger invoices.

---

### Task 1: Route Payments Through the Ledger

**Files:**
- Modify: `src/hooks/useBillingLedger.ts`
- Modify: `src/pages/Faturamento.tsx`

- [x] **Step 1: Extend ledger invalidation to refresh the invoice detail**

In `useBillingLedger.ts`, in `useLedgerInvalidation`, also invalidate the invoice detail and financial alerts so the open detail panel updates after a ledger payment:

```ts
    qc.invalidateQueries({ queryKey: ['invoice-detail'] })
    qc.invalidateQueries({ queryKey: ['financial-alerts'] })
```

- [x] **Step 2: Import and instantiate the ledger payment mutation in `Faturamento.tsx`**

Add `useRegisterLedgerInvoicePayment` to the `../hooks/useBillingLedger` import and instantiate:

```ts
const registerLedgerPaymentMutation = useRegisterLedgerInvoicePayment()
```

- [x] **Step 3: Add a helper + branch in `handleRegisterPayment`**

Compute whether the selected invoice is ledger-payable from `detailQuery.data.invoice`, and branch:

```ts
  const detailInvoice = detailQuery.data?.invoice ?? null
  const isLedgerPayable =
    !!detailInvoice &&
    (detailInvoice.invoice_type === 'individual' || detailInvoice.invoice_type === 'consolidated') &&
    Number(detailInvoice.total_paid_brl ?? 0) === 0
```

In `handleRegisterPayment`, when `isLedgerPayable`, call the ledger mutation with the full balance and skip the typed amount; otherwise keep the legacy call:

```ts
      if (isLedgerPayable) {
        await registerLedgerPaymentMutation.mutateAsync({
          invoiceId: selectedInvoiceId,
          amountBrl: Number(detailInvoice?.balance_brl ?? detailInvoice?.total_brl ?? 0),
          method: paymentMethod,
          paidAt: paymentDate ? new Date(`${paymentDate}T12:00:00`).toISOString() : null,
          source: 'manual',
          notes: paymentNotes.trim() || null,
        })
      } else {
        await registerPaymentMutation.mutateAsync({
          invoiceId: selectedInvoiceId,
          amountBrl: parsedAmount,
          paymentMethod,
          paidAt: paymentDate ? new Date(`${paymentDate}T12:00:00`).toISOString() : null,
          notes: paymentNotes.trim() || null,
          actorId: user?.id ?? null,
        })
      }
```

Note: keep the `parsedAmount` validation for the legacy branch; for the ledger branch the amount comes from the balance. Guard so an empty amount doesn't block the ledger path.

- [x] **Step 4: Lock + prefill the amount for ledger invoices in the payment modal**

When the open invoice is ledger-payable, prefill `paymentAmount` with the balance and render the amount input read-only with a hint ("Baixa integral via ledger"). Use an effect keyed on `selectedInvoiceId`/`detailInvoice` to set the amount, and pass `readOnly` + a hint to the amount `Field` when `isLedgerPayable`. Also disable the legacy "valor inválido" error path for the ledger branch.

- [x] **Step 5: Verify build, lint, tests**

```bash
npm run build
npm run lint
npm test
```

Expected: build passes; no new lint errors; tests pass.

- [x] **Step 6: Commit**

```bash
git add src/hooks/useBillingLedger.ts src/pages/Faturamento.tsx
git commit -m "Route local invoice payments through the ledger"
```

---

## Follow-Up Plans

### Phase 4c: PIX Reconciliation by TXID Only

**Goal:** Route local-charge PIX reconciliation through `reconcile_invoice_payment_by_txid` and remove automatic CNPJ+valor fallback matching.

**Scope Boundary:** Only the PIX reconciliation service/page behavior for local-charge ledger invoices. Demurrage remains outside the ledger rollout and is not migrated to `bl_receivables` in this phase.

- [x] **Step 1: Add service tests for TXID-only matching and ledger confirmation**

Add tests around `matchUnifiedPixTransactions` and `confirmUnifiedPixReconciliation` proving that:

- a local invoice is not matched by CNPJ+valor when the transaction TXID does not match the invoice number;
- a local TXID match is confirmed through `reconcile_invoice_payment_by_txid`, not the legacy `register_invoice_payment`.

- [x] **Step 2: Remove local CNPJ+valor fallback from `src/services/reconciliacao.ts`**

Keep TXID matching by normalized invoice/document number. Do not build or consume a CNPJ+valor candidate map for automatic reconciliation.

- [x] **Step 3: Confirm local PIX matches via `reconcile_invoice_payment_by_txid`**

For local invoice matches, call the ledger reconciliation service with transaction TXID, amount and paid date. Do not manually update `invoices.pix_txid` after the RPC, because the RPC owns that state transition.

- [x] **Step 4: Simplify the reconciliation page badge/copy for TXID-only matches**

Remove the CNPJ match badge path from the reconciliation table so the UI no longer suggests automatic CNPJ matching.

- [x] **Step 5: Verify build, lint, tests**

```bash
npm run build
npm run lint
npm test
```

- [x] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-05-29-ledger-faturamento-phase4b.md src/services/reconciliacao.ts src/pages/Reconciliacao.tsx src/services/__tests__/reconciliacao.test.ts
git commit -m "Reconcile local PIX payments by TXID"
```

### Phase 4d: Portal and Reports from Receivables

**Goal:** Read local-charge open balances for portal and reporting surfaces from `bl_receivables`, so invoices are documents and B/L receivables remain the financial source of truth.

**Scope Boundary:** Do not implement until Phase 4c is verified and a new execution pass starts.

- [x] **Step 1: Identify portal/report balance queries currently reading invoice balances**
- [x] **Step 2: Add tests for balances derived from `bl_receivables`**
- [x] **Step 3: Route portal balances through receivable-backed service queries/RPCs**
- [x] **Step 4: Route report balances through receivable-backed service queries/RPCs**
- [x] **Step 5: Verify build, lint, tests**
- [x] **Step 6: Commit**
