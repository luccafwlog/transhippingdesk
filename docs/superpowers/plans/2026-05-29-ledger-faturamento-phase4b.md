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

- Phase 4c: PIX reconciliation via `reconcile_invoice_payment_by_txid`, dropping the CNPJ+valor fallback.
- Phase 4d: portal + reports balances from `bl_receivables`.
