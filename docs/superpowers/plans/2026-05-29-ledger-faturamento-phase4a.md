# Ledger Faturamento Phase 4a Implementation Plan

> Execute task-by-task. Steps use checkbox (`- [ ]`). Execute only the next unmarked block, verify, mark it, commit small. Phase 4 ships as a sequence of small PRs; this is **4a** (foundation). 4b (payment via ledger), 4c (TXID reconciliation), 4d (portal/report balances) are separate plans.

**Goal:** Make the ledger the automatic source of truth on the issuance side. When a B/L becomes `ready_for_billing`, auto-emit its individual invoice and wire it into the ledger (receivable + active link). Every invoice creation path — automatic and the existing manual `create_invoice_from_bls` — registers the receivable + link, so payments/reconciliation (4b/4c) and portal/report reads (4d) have reliable data.

**Decisions (confirmed with user):**
1. **Auto-emit the individual invoice** when a B/L reaches `ready_for_billing` (per spec): create the document (issued), the receivable, and the active link. PIX payload is generated lazily by the existing `listInvoiceDetails` path (no TS PIX call needed in the DB).
2. **Sequence of small PRs.** This plan is 4a only.

**Architecture / how it hooks in:**
- A B/L reaches `ready_for_billing` via `mark_bl_ready_for_billing` (RPC) or the `trg_promote_calculated_bl_ready` BEFORE-trigger. There is no existing auto-emission.
- New AFTER trigger `trg_emit_invoice_on_bl_ready` on `bls` (INSERT OR UPDATE OF charge_status) emits a single-B/L invoice via the existing `create_invoice_from_bls_core` (SECURITY DEFINER, no internal auth guard — callable from a definer trigger), then calls `link_invoice_to_ledger`.
- The emission is wrapped in a `BEGIN/EXCEPTION` subblock so a failed emission (e.g. exempt-only B/L with no BRL line) **never rolls back** the B/L's transition to ready; the failure is logged to `audit_logs`.
- It is **forward-only**: it fires on the transition into `ready_for_billing`, not retroactively for B/Ls already ready. It is **idempotent**: it skips B/Ls that already have an active/paid invoice, and `create_invoice_from_bls_core` itself rejects duplicates.
- `link_invoice_to_ledger(invoice_id)` is the single source of truth for mirroring an invoice's `invoice_bls` into `bl_receivables` + `invoice_receivable_links`, and stamping `invoice_type`. Both the trigger and the manual TS path call it.

**Operational consequence (documented in PR):** with auto-emit on, B/Ls are invoiced the moment they become ready, so the manual "Nova Invoice" modal becomes an edge-case tool (it will reject already-invoiced B/Ls). The ledger consolidated modal (Phase 3) remains the way to group open balances.

**Tech Stack:** Supabase/Postgres migration + trigger, TypeScript service, Vitest opt-in integration test.

---

## Scope Boundary

In scope: `link_invoice_to_ledger` RPC, auto-emit trigger, manual-path wiring, types, opt-in test.

Out of scope: routing payments through the ledger (4b), PIX reconciliation cutover (4c), portal/report balance reads (4d), Demurrage, a retroactive mass-emission backfill for the pre-existing `ready_for_billing` backlog (operators can emit those via the existing manual modal; a guarded catch-up RPC can be added later if wanted).

## File Structure

- Create `supabase/migrations/20260529120000_ledger_auto_emit_phase4a.sql`
- Modify `src/types/database.ts` — `link_invoice_to_ledger` signature.
- Modify `src/services/billing.ts` — call `link_invoice_to_ledger` after manual creation.
- Modify `src/integration/supabase.integration.test.ts` — opt-in test.

---

### Task 1: `link_invoice_to_ledger` RPC

**Files:**
- Create: `supabase/migrations/20260529120000_ledger_auto_emit_phase4a.sql`

- [x] **Step 1: Create the migration with `link_invoice_to_ledger`**

```sql
-- Phase 4a: auto-emit individual invoices on ready_for_billing and wire the ledger.
-- link_invoice_to_ledger mirrors an invoice's invoice_bls into bl_receivables +
-- invoice_receivable_links. Idempotent; single source of truth for both the
-- auto-emit trigger and the manual create path.

CREATE OR REPLACE FUNCTION public.link_invoice_to_ledger(p_invoice_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_id BIGINT;
  v_bl_count INTEGER;
BEGIN
  SELECT customer_id INTO v_customer_id FROM public.invoices WHERE id = p_invoice_id;
  IF v_customer_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_bl_count FROM public.invoice_bls WHERE invoice_id = p_invoice_id;
  IF v_bl_count = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.bl_receivables (
    bl_id, customer_id, source, original_amount_brl, settled_amount_brl, balance_brl, status,
    voyage_id, cargo_mode, pol, pod, updated_at
  )
  SELECT
    b.id, v_customer_id, 'local_charges',
    COALESCE(ib.subtotal_brl, 0), 0, COALESCE(ib.subtotal_brl, 0),
    CASE WHEN COALESCE(ib.subtotal_brl, 0) <= 0 THEN 'void' ELSE 'open' END,
    b.voyage_id, b.cargo_mode, b.pol, b.pod, now()
  FROM public.invoice_bls ib
  JOIN public.bls b ON b.id = ib.bl_id
  WHERE ib.invoice_id = p_invoice_id
  ON CONFLICT (source, bl_id) DO UPDATE SET
    customer_id = EXCLUDED.customer_id,
    original_amount_brl = EXCLUDED.original_amount_brl,
    balance_brl = GREATEST(EXCLUDED.original_amount_brl - bl_receivables.settled_amount_brl, 0),
    status = CASE
      WHEN EXCLUDED.original_amount_brl <= 0 THEN 'void'
      WHEN bl_receivables.settled_amount_brl >= EXCLUDED.original_amount_brl THEN 'settled'
      WHEN bl_receivables.settled_amount_brl > 0 THEN 'partially_settled'
      ELSE 'open'
    END,
    voyage_id = EXCLUDED.voyage_id, cargo_mode = EXCLUDED.cargo_mode,
    pol = EXCLUDED.pol, pod = EXCLUDED.pod, updated_at = now();

  INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id, subtotal_brl, status, bl_snapshot)
  SELECT
    p_invoice_id, br.id, ib.bl_id, COALESCE(ib.subtotal_brl, 0), 'active',
    jsonb_build_object('bl_id', b.id, 'voyage_id', b.voyage_id, 'cargo_mode', b.cargo_mode, 'pol', b.pol, 'pod', b.pod)
  FROM public.invoice_bls ib
  JOIN public.bls b ON b.id = ib.bl_id
  JOIN public.bl_receivables br ON br.source = 'local_charges' AND br.bl_id = ib.bl_id
  WHERE ib.invoice_id = p_invoice_id
  ON CONFLICT (invoice_id, receivable_id) DO NOTHING;

  UPDATE public.invoices
  SET invoice_type = CASE WHEN v_bl_count > 1 THEN 'consolidated' ELSE 'individual' END
  WHERE id = p_invoice_id AND invoice_type = 'individual';
END;
$$;

REVOKE ALL ON FUNCTION public.link_invoice_to_ledger(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_invoice_to_ledger(BIGINT) TO authenticated;
```

- [x] **Step 2: Verify build**

```bash
npm run build
```

Expected: passes (no TS change yet).

- [x] **Step 3: Commit**

```bash
git add supabase/migrations/20260529120000_ledger_auto_emit_phase4a.sql
git commit -m "Add link_invoice_to_ledger RPC"
```

---

### Task 2: Auto-Emit Trigger

**Files:**
- Modify: `supabase/migrations/20260529120000_ledger_auto_emit_phase4a.sql`

- [ ] **Step 1: Append the trigger function and trigger**

```sql
CREATE OR REPLACE FUNCTION public.emit_invoice_on_bl_ready()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
  v_invoice_id BIGINT;
BEGIN
  IF NEW.charge_status = 'ready_for_billing'
     AND (TG_OP = 'INSERT' OR OLD.charge_status IS DISTINCT FROM 'ready_for_billing')
     AND NEW.customer_id IS NOT NULL
     AND COALESCE(NEW.financial_status, 'pending') = 'pending'
     AND NOT EXISTS (
       SELECT 1
       FROM public.invoice_bls ib
       JOIN public.invoices i ON i.id = ib.invoice_id
       WHERE ib.bl_id = NEW.id
         AND COALESCE(i.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue', 'paid')
     )
  THEN
    BEGIN
      v_result := public.create_invoice_from_bls_core(
        ARRAY[NEW.id], NEW.customer_id, NULL,
        'Emissao automatica ao ficar pronto para faturamento',
        true, NULL, 'system_auto', NULL
      );
      v_invoice_id := (v_result->>'invoice_id')::BIGINT;
      IF v_invoice_id IS NOT NULL THEN
        PERFORM public.link_invoice_to_ledger(v_invoice_id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Never block the B/L transition; record the failure for follow-up.
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
      VALUES ('bl', NEW.id, 'auto_invoice_failed', NULL, SQLERRM, NULL, now(), 'Falha na emissao automatica de invoice individual');
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_emit_invoice_on_bl_ready ON public.bls;
CREATE TRIGGER trg_emit_invoice_on_bl_ready
AFTER INSERT OR UPDATE OF charge_status ON public.bls
FOR EACH ROW
EXECUTE FUNCTION public.emit_invoice_on_bl_ready();
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260529120000_ledger_auto_emit_phase4a.sql
git commit -m "Auto-emit individual invoice on ready_for_billing"
```

---

### Task 3: Wire Manual Path + Types + Test

**Files:**
- Modify: `src/types/database.ts`
- Modify: `src/services/billing.ts`
- Modify: `src/integration/supabase.integration.test.ts`

- [ ] **Step 1: Add `link_invoice_to_ledger` signature to `src/types/database.ts`**

Under `Database['public']['Functions']`:

```ts
      link_invoice_to_ledger: {
        Args: { p_invoice_id: number }
        Returns: undefined
      }
```

- [ ] **Step 2: Call `link_invoice_to_ledger` after manual creation in `src/services/billing.ts`**

In `createInvoiceFromBls`, after `persistPixPayload(invoiceId)`:

```ts
  if (invoiceId) {
    await persistPixPayload(invoiceId)
    await supabase.rpc('link_invoice_to_ledger', { p_invoice_id: invoiceId })
  }
```

- [ ] **Step 3: Add opt-in integration test**

In `src/integration/supabase.integration.test.ts`, inside `describeIntegration`, after the phase 2 test:

```ts
  billingFlowTest('ledger phase 4a links an invoice into the ledger', async () => {
    const invoices = await client
      .from('invoices')
      .select('id')
      .order('id', { ascending: false })
      .limit(1)
    expect(invoices.error).toBeNull()
    const invoiceId = Number(invoices.data?.[0]?.id ?? 0)
    if (!invoiceId) return

    const link = await client.rpc('link_invoice_to_ledger', { p_invoice_id: invoiceId })
    expect(link.error).toBeNull()

    const links = await client
      .from('invoice_receivable_links')
      .select('invoice_id, status')
      .eq('invoice_id', invoiceId)
    expect(links.error).toBeNull()
  })
```

- [ ] **Step 4: Verify build, lint, tests**

```bash
npm run build
npm run lint
npm test
```

Expected: build passes; lint has no new errors; tests pass (integration skipped).

- [ ] **Step 5: Self-review — migration touches neither Demurrage nor CNPJ/valor reconciliation**

```bash
rg -n "demurrage|cnpj|cpf" supabase/migrations/20260529120000_ledger_auto_emit_phase4a.sql
```

Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add src/types/database.ts src/services/billing.ts src/integration/supabase.integration.test.ts
git commit -m "Wire manual invoice path into the ledger"
```

---

## Follow-Up Plans

- Phase 4b: route consolidated + individual payments through `register_ledger_invoice_payment` (invoice-list pay action and any payment UI).
- Phase 4c: PIX reconciliation via `reconcile_invoice_payment_by_txid`, dropping the CNPJ+valor fallback.
- Phase 4d: portal + reports balances read from `bl_receivables`.
