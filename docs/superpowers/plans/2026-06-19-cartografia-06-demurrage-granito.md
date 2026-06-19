# Demurrage and Granite Cartography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trace demurrage tracking/rates/invoice behavior and the independent Granite import/charge/invoice pipeline.

**Architecture:** Keep the two persistence models separate. `demurrage.md` documents container-event-based charges and frozen ROE invoices; `granito.md` documents the COSCO spreadsheet domain and its own B/L/charge tables, linking both to shared billing and Portal surfaces.

**Tech Stack:** React, TanStack Query, Supabase, Banco Central PTAX, XLSX, printable React documents, Markdown, Mermaid, Vitest.

---

## Files

- Modify: `docs/modules/demurrage.md`
- Modify: `docs/modules/granito.md`

Do not modify product code or migrations.

### Task 1: Expand Demurrage Tracking and Invoice Cartography

**Files:**

- Modify: `docs/modules/demurrage.md`
- Read: `src/pages/Demurrage.tsx`
- Read: `src/pages/DemurrageRates.tsx`
- Read: `src/components/demurrage/InvoiceDocument.tsx`
- Read: `src/components/shared/InvoiceDocumentKit.tsx`
- Read: `src/services/demurrage/demurrageContainers.ts`
- Read: `src/services/demurrage/demurrageInvoices.ts`
- Read: `src/services/demurrage/demurrageRates.ts`
- Read: `src/services/demurrage/demurrageKpis.ts`
- Read: `src/hooks/useExchangeRates.ts`
- Read: `src/lib/pix.ts`
- Test: `src/services/demurrage/__tests__/calculateDemurrage.test.ts`
- Test: `src/services/__tests__/demurrageKpis.test.ts`

- [ ] **Step 1: Apply shared headings and route subsections**

Under `Anatomia das telas`, create:

```markdown
### `/demurrage`
### `/demurrage/taxas`
```

Describe tracking, invoice list/detail, edit-date modal, discount/dispute surfaces, printable document, and rate management.

- [ ] **Step 2: Catalog tracking actions**

Include:

- filter/group containers;
- load KPIs;
- edit discharge date;
- edit/clear return date;
- derive free-time/demurrage status;
- create invoice for one B/L.

- [ ] **Step 3: Catalog invoice actions**

Include:

- load/filter invoices;
- open invoice detail;
- issue invoice and freeze ROE/BRL;
- unissue invoice;
- mark paid manually;
- unmark paid;
- cancel invoice;
- apply/remove discount fields;
- open/update dispute;
- print invoice.

- [ ] **Step 4: Catalog rate actions**

Include:

- list rates;
- create/update rate;
- activate/deactivate rate;
- delete rate.

- [ ] **Step 5: Document data/FX invariants**

Record:

- precedence `B/L override > demurrage_rates > STATIC_RATE_GROUPS`;
- discharge/return order constraint;
- frozen ROE and source values;
- display exchange rates are distinct from issue-time ROE;
- localStorage fallback implications;
- demurrage payment is not the local-charge ledger;
- current insert-time discharge trigger limitation.

- [ ] **Step 6: Run focused tests**

```powershell
npx vitest run src/services/demurrage/__tests__/calculateDemurrage.test.ts src/services/__tests__/demurrageKpis.test.ts
```

Expected: exit `0`.

Only calculation/KPI assertions receive `Teste`; page mutations remain `Código` until runtime validation.

### Task 2: Trace Demurrage Database and Portal Contracts

**Files:**

- Modify: `docs/modules/demurrage.md`
- Read: `supabase/migrations/20260610094207_confirm_demurrage_pix_matches_batch.sql`
- Read: `supabase/migrations/20260612161000_confirm_unified_pix_matches.sql`
- Read: `supabase/migrations/20260613170000_reverse_invoice_payment.sql`
- Read: `supabase/migrations/20260614180000_require_justification_on_payment_reversal.sql`
- Read: `supabase/migrations/20260615220000_portal_ce_mercante_gate.sql`

- [ ] **Step 1: Add an invoice lifecycle diagram**

Show:

```text
container dates
→ calculation
→ draft invoice/items
→ issue/freeze ROE
→ issued
→ paid by manual or PIX / cancelled
→ reversal when authorized
```

- [ ] **Step 2: Document API boundaries**

Identify:

- direct table writes in `demurrageInvoices.ts`;
- batch PIX RPC;
- unified reconciliation wrapper;
- Portal list/detail RPCs;
- reversal RPC and justification/admin requirement;
- where value validation occurs.

- [ ] **Step 3: Preserve evidence calibration**

Keep the base-RPC value-validation concern as `Suspeita` unless runtime or direct-call validation proves unsafe behavior. Explain that the supported UI path uses the unified wrapper.

### Task 3: Expand Granite Import, Charge, and Invoice Cartography

**Files:**

- Modify: `docs/modules/granito.md`
- Read: `src/pages/Granite.tsx`
- Read: `src/pages/GraniteRates.tsx`
- Read: `src/components/shared/VoyageImportActions.tsx`
- Read: `src/services/graniteImport.ts`
- Read: `src/services/graniteCharges.ts`
- Read: `src/services/billing.ts`
- Read: `supabase/migrations/034_granite_module.sql`
- Read: `supabase/migrations/039_granite_invoiceable_view.sql`
- Read: `supabase/migrations/051_granite_empty_array_guard.sql`
- Read: `supabase/migrations/20260528134131_fix_granite_invoice_cancel_reissue.sql`
- Read: `supabase/migrations/20260523120000_taxas_locais_granito.sql`
- Test: `src/services/__tests__/importCore.test.ts`
- Test: `src/services/__tests__/uploadLimits.test.ts`
- Test: `src/services/__tests__/billing.test.ts`

- [ ] **Step 1: Apply shared headings and route subsections**

Under `Anatomia das telas`, create:

```markdown
### `/granito`
### `/granito/taxas`
```

- [ ] **Step 2: Catalog Granite actions**

Include:

- select voyage/import entry point;
- parse COSCO workbook;
- preview row reconciliation/errors;
- allow/reject pending customer rows;
- persist manifest and Granite B/Ls;
- filter/list Granite B/Ls;
- calculate charges;
- auto-issue or manually issue invoice when eligible;
- navigate/open linked invoice if available.

- [ ] **Step 3: Catalog rate actions**

Include:

- list rates;
- create/update rate;
- activate/deactivate;
- delete.

- [ ] **Step 4: Document separate ownership**

State clearly:

- `granite_bls` is not `bls`;
- `granite_bl_charges` is a snapshot;
- `invoice_granite_bls` is the invoice link;
- Granite calculation jumps to `ready_for_billing` in the practical path;
- cancel/reissue returns eligible B/Ls to `ready_for_billing`;
- local-charge `cargo_mode='granito'` support does not merge Granite persistence.

- [ ] **Step 5: Record test limitations**

Run:

```powershell
npx vitest run src/services/__tests__/importCore.test.ts src/services/__tests__/uploadLimits.test.ts src/services/__tests__/billing.test.ts
```

Expected: exit `0`.

Document that no dedicated `graniteImport` or `graniteCharges` test file exists. Do not label Granite-specific parsing/calculation as covered merely because shared import or billing tests pass.

### Task 4: Verify and Commit

**Files:**

- Modify: `docs/modules/demurrage.md`
- Modify: `docs/modules/granito.md`

- [ ] **Step 1: Check headings/routes**

```powershell
rg -n "^## (Propósito e escopo|Anatomia das telas|Catálogo de ações|Estado e dados|Fluxos e invariantes|Testes e validação|Notas e divergências)$" docs/modules/demurrage.md docs/modules/granito.md
rg -n '### `/(demurrage|granito)' docs/modules/demurrage.md docs/modules/granito.md
```

Expected: seven headings per file and all four routes documented.

- [ ] **Step 2: Run docs/whitespace checks**

```powershell
npm run docs:check
git diff --check
```

Expected: no checker failures for these files.

- [ ] **Step 3: Commit**

```powershell
git add -- docs/modules/demurrage.md docs/modules/granito.md
git commit -m "docs: map demurrage and granite"
```

