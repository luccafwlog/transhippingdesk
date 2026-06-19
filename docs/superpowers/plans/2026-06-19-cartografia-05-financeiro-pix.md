# Local Charges, Billing, Ledger, and PIX Cartography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce end-to-end technical cartography for local-charge configuration, calculation, invoice lifecycle, receivables ledger, refunds, payment reconciliation, and reversals.

**Architecture:** `taxas-locais.md` owns pricing inputs and charge state transitions; `faturamento.md` owns invoice/ledger lifecycle; `reconciliacao-pix.md` owns bank-file matching and payment dispatch. Cross-link shared RPCs instead of duplicating their full rules.

**Tech Stack:** React, TanStack Query, Supabase RPCs/triggers, PIX BRCode, XLSX, Markdown, Mermaid, Vitest.

---

## Files

- Modify: `docs/modules/taxas-locais.md`
- Modify: `docs/modules/faturamento.md`
- Modify: `docs/modules/reconciliacao-pix.md`

Do not modify product code or migrations.

### Task 1: Expand Local Charge Configuration and Calculation

**Files:**

- Modify: `docs/modules/taxas-locais.md`
- Read: `src/pages/TaxasLocais.tsx`
- Read: `src/pages/taxasLocaisHelpers.ts`
- Read: `src/components/taxasLocais/ChargeTablesTab.tsx`
- Read: `src/components/taxasLocais/ChargeOverridesTab.tsx`
- Read: `src/components/taxasLocais/chargeForms.ts`
- Read: `src/hooks/useLocalCharges.ts`
- Read: `src/services/charges/chargeTableService.ts`
- Read: `src/services/charges/chargeRateService.ts`
- Read: `src/services/charges/chargeOperationsService.ts`
- Read: `src/services/charges/chargeReconciliationService.ts`
- Read: `src/services/financialValidation.ts`
- Test: `src/pages/__tests__/TaxasLocais.test.ts`
- Test: `src/pages/__tests__/taxasLocaisHelpers.test.ts`
- Test: `src/services/__tests__/localCharges.test.ts`
- Test: `src/services/__tests__/financialValidation.test.ts`

- [ ] **Step 1: Apply shared headings**

Under `Anatomia das telas`, document the tables and overrides tabs separately.

- [ ] **Step 2: Catalog configuration actions**

Include:

- filter/list charge tables;
- create/edit table;
- activate/deactivate table;
- add/edit/delete table item;
- filter/list overrides;
- search customer/item;
- create/edit/delete override.

- [ ] **Step 3: Catalog operational charge actions**

Although triggered from review, B/L detail, and billing validation, document the service-owned actions:

- calculate one B/L;
- recalculate one B/L;
- calculate/recalculate selected B/Ls;
- add/update/delete manual B/L charge;
- mark charges reviewed;
- mark ready for billing;
- approve/reject customer reconciliation.

- [ ] **Step 4: Record exact cache families**

List all `queryKeys.charges`, `queryKeys.bls.localChargeLines`, `manualChargeItems`, `billingRuns`, and `reconciliation.queue` families and the invalidations attached to each mutation.

- [ ] **Step 5: Run focused tests**

```powershell
npx vitest run src/pages/__tests__/TaxasLocais.test.ts src/pages/__tests__/taxasLocaisHelpers.test.ts src/services/__tests__/localCharges.test.ts src/services/__tests__/financialValidation.test.ts
```

Expected: exit `0`.

### Task 2: Map Billing Page and Invoice Actions

**Files:**

- Modify: `docs/modules/faturamento.md`
- Read: `src/pages/Faturamento.tsx`
- Read: `src/pages/faturamentoInvoiceStatus.ts`
- Read: `src/pages/faturamentoLedgerPayment.ts`
- Read: `src/components/billing/InvoicesTable.tsx`
- Read: `src/components/billing/InvoiceFiltersBar.tsx`
- Read: `src/components/billing/InvoiceDetailModal.tsx`
- Read: `src/components/billing/InvoiceDocumentLocal.tsx`
- Read: `src/components/billing/ValidacaoTab.tsx`
- Read: `src/components/billing/PendenciasFaturamentoTab.tsx`
- Read: `src/components/billing/PendenciasTable.tsx`
- Read: `src/components/billing/ConsolidatedInvoiceModal.tsx`
- Read: `src/components/billing/ManualChargeFormFields.tsx`
- Read: `src/components/billing/FinancialAlertsPanel.tsx`
- Read: `src/components/billing/DemurrageInvoicesSection.tsx`
- Read: `src/components/billing/ReconciliationHistoryTable.tsx`
- Read: `src/components/shared/InvoiceDocumentKit.tsx`
- Read: `src/components/shared/invoiceFormat.ts`
- Read: `src/hooks/useBilling.ts`
- Read: `src/hooks/useBillingLedger.ts`
- Read: `src/services/billing.ts`
- Read: `src/services/billingLedger.ts`
- Test: `src/pages/__tests__/Faturamento.test.ts`
- Test: `src/pages/__tests__/faturamentoInvoiceStatus.test.ts`
- Test: `src/services/__tests__/billing.test.ts`
- Test: `src/services/__tests__/billingHelpers.test.ts`
- Test: `src/services/__tests__/billingLedger.test.ts`
- Test: `src/components/billing/__tests__/ConsolidatedInvoiceModal.test.tsx`
- Test: `src/components/billing/__tests__/ConsolidatedInvoiceSelection.test.ts`
- Test: `src/components/billing/__tests__/ManualChargeFormFields.test.tsx`
- Test: `src/components/billing/__tests__/PendenciasTable.test.tsx`

- [ ] **Step 1: Apply shared headings and anatomy**

Under `/faturamento`, describe:

- invoice list;
- validation tab;
- billing pendencies;
- consolidated invoice modal;
- invoice detail/payment/refund/cancel modal;
- demurrage section;
- reconciliation history;
- printable document.

- [ ] **Step 2: Catalog invoice actions**

Include:

- filter/list/open invoice;
- load invoice detail and consolidated breakdown;
- mark overdue on page load;
- recalculate/review/ready selected B/Ls;
- issue individual invoice;
- create consolidated invoice;
- register legacy payment;
- register ledger payment;
- add/delete manual invoice charge;
- cancel invoice;
- settle refund;
- print invoice.

- [ ] **Step 3: Document dual payment paths**

Add a Mermaid decision flow showing:

```text
invoice opened
→ isLedgerInvoicePayable
→ ledger payment or legacy payment
→ receivable/invoice/B/L updates
→ possible refund
→ cache invalidations
```

Explain `covered`, `obsolete`, partial payment, and source-of-truth boundaries.

- [ ] **Step 4: Run focused billing tests**

```powershell
npx vitest run src/pages/__tests__/Faturamento.test.ts src/pages/__tests__/faturamentoInvoiceStatus.test.ts src/services/__tests__/billing.test.ts src/services/__tests__/billingHelpers.test.ts src/services/__tests__/billingLedger.test.ts src/components/billing/__tests__/ConsolidatedInvoiceModal.test.tsx src/components/billing/__tests__/ConsolidatedInvoiceSelection.test.ts src/components/billing/__tests__/ManualChargeFormFields.test.tsx src/components/billing/__tests__/PendenciasTable.test.tsx
```

Expected: exit `0`.

### Task 3: Trace Ledger and Invoice Database Contracts

**Files:**

- Modify: `docs/modules/faturamento.md`
- Read: `supabase/migrations/20260612154000_create_invoice_from_bls_with_ledger.sql`
- Read: `supabase/migrations/20260612160000_mark_ready_and_invoice_atomic.sql`
- Read: `supabase/migrations/20260612162000_register_ledger_partial_payments.sql`
- Read: `supabase/migrations/20260614160000_pix_exact_and_manual_overpayment_refunds.sql`
- Read: `supabase/migrations/20260614170000_settle_invoice_refunds.sql`
- Read: `supabase/migrations/20260618163840_guard_invoiceable_ready_state.sql`
- Test: `src/services/__tests__/ledgerIndividualRpcMigration.test.ts`
- Test: `src/services/__tests__/ledgerPartialPaymentsMigration.test.ts`
- Test: `src/services/__tests__/ledgerSettlementGuardsMigration.test.ts`
- Test: `src/services/__tests__/pixExactAndRefundsMigration.test.ts`
- Test: `src/services/__tests__/settleInvoiceRefundsMigration.test.ts`
- Test: `src/services/__tests__/guardInvoiceableReadyStateMigration.test.ts`
- Test: `src/services/__tests__/guardManualChargesMigration.test.ts`

- [ ] **Step 1: Add an ownership table**

Map:

```text
invoices
invoice_bls
invoice_receivable_links
bl_receivables
ledger_settlements
payments
invoice_refunds
invoice_lifecycle_events
```

For each, state what it owns and what it does not own.

- [ ] **Step 2: Add transaction boundaries**

Document which RPC performs each atomic transition and which UI/service call invokes it.

- [ ] **Step 3: Run SQL contract tests**

```powershell
npx vitest run src/services/__tests__/ledgerIndividualRpcMigration.test.ts src/services/__tests__/ledgerPartialPaymentsMigration.test.ts src/services/__tests__/ledgerSettlementGuardsMigration.test.ts src/services/__tests__/pixExactAndRefundsMigration.test.ts src/services/__tests__/settleInvoiceRefundsMigration.test.ts src/services/__tests__/guardInvoiceableReadyStateMigration.test.ts src/services/__tests__/guardManualChargesMigration.test.ts
```

Expected: exit `0`.

Label all of these as `Teste de contrato SQL`.

### Task 4: Expand PIX Matching, Confirmation, History, and Reversal

**Files:**

- Modify: `docs/modules/reconciliacao-pix.md`
- Read: `src/pages/Reconciliacao.tsx`
- Read: `src/components/billing/ReconciliationHistoryTable.tsx`
- Read: `src/services/reconciliacao.ts`
- Read: `src/services/demurrage/demurrageKpis.ts`
- Read: `src/lib/pix.ts`
- Read: `supabase/migrations/20260612161000_confirm_unified_pix_matches.sql`
- Read: `supabase/migrations/20260614180000_require_justification_on_payment_reversal.sql`
- Test: `src/services/__tests__/reconciliacao.test.ts`
- Test: `src/lib/__tests__/pix.test.ts`
- Test: `src/services/__tests__/ledgerPixPayloadMigration.test.ts`
- Test: `src/services/__tests__/ledgerPixSettlementTxidMigration.test.ts`
- Test: `src/services/__tests__/reversalBlsFinancialStatusMigration.test.ts`
- Test: `src/services/__tests__/reversalJustificationMigration.test.ts`

- [ ] **Step 1: Apply shared headings**

Describe upload/match, result review, confirmation, history, export, detail, and reversal surfaces.

- [ ] **Step 2: Catalog actions**

Include:

- select/upload PIX workbook;
- parse bank rows;
- match local and demurrage documents;
- classify unmatched/ambiguous/value mismatch;
- confirm only non-ambiguous matches;
- show per-source/per-item result;
- view invoice detail from history;
- filter/export history;
- reverse local payment;
- reverse demurrage payment.

- [ ] **Step 3: Document trust boundaries**

Keep or refine current divergences:

- frontend ambiguity filtering versus RPC behavior;
- local exact value versus demurrage tolerance;
- same TXID across domains;
- denormalized TXID storage;
- ledger versus direct demurrage settlement.

Use `Suspeita` where current code evidence does not prove exploitability or runtime failure.

- [ ] **Step 4: Run focused PIX tests**

```powershell
npx vitest run src/services/__tests__/reconciliacao.test.ts src/lib/__tests__/pix.test.ts src/services/__tests__/ledgerPixPayloadMigration.test.ts src/services/__tests__/ledgerPixSettlementTxidMigration.test.ts src/services/__tests__/reversalBlsFinancialStatusMigration.test.ts src/services/__tests__/reversalJustificationMigration.test.ts
```

Expected: exit `0`.

### Task 5: Verify and Commit

**Files:**

- Modify: `docs/modules/taxas-locais.md`
- Modify: `docs/modules/faturamento.md`
- Modify: `docs/modules/reconciliacao-pix.md`

- [ ] **Step 1: Check shared headings**

```powershell
rg -n "^## (Propósito e escopo|Anatomia das telas|Catálogo de ações|Estado e dados|Fluxos e invariantes|Testes e validação|Notas e divergências)$" docs/modules/taxas-locais.md docs/modules/faturamento.md docs/modules/reconciliacao-pix.md
```

Expected: seven headings in each file.

- [ ] **Step 2: Run docs/whitespace checks**

```powershell
npm run docs:check
git diff --check
```

Expected: no checker failures for these three files.

- [ ] **Step 3: Commit**

```powershell
git add -- docs/modules/taxas-locais.md docs/modules/faturamento.md docs/modules/reconciliacao-pix.md
git commit -m "docs: map local charges billing ledger and pix"
```
