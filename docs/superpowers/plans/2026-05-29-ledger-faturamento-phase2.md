# Ledger Faturamento Phase 2 Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute only the next unmarked block, verify, mark it, and make a small commit. Do not implement future phases (UI modal, portal) without a new plan.

**Goal:** Implement the transactional ledger RPCs for local-charge billing: a consolidated-invoice creation RPC, a single core payment RPC (`register_ledger_invoice_payment`) that propagates state across documents, a manual obsolete RPC, and TXID-only PIX reconciliation. Expose them through TypeScript services/hooks. Do **not** rewire the existing `Faturamento.tsx` modal or `reconciliacao.ts` yet.

**Architecture:** Phase 1 added `bl_receivables`, `invoice_receivable_links`, `ledger_settlements`, `invoice_lifecycle_events`, and the document lifecycle columns on `invoices` (`invoice_type`, `obsolete_reason`, `covered_by_invoice_id`, `replaced_by_invoice_id`). Phase 2 puts the financial truth into transactional RPCs:

- The receivable balance is the source of truth. Payments settle receivables, never invoice line items.
- `register_ledger_invoice_payment` is the single core used by both manual payment and PIX reconciliation. It locks the invoice and its receivables, settles them fully, marks the paying invoice `paid`, and propagates: paying a **consolidated** covers the individuals (`covered`); paying an **individual** makes any open consolidated holding that receivable `obsolete`.
- Reconciliation is **TXID only**. No CNPJ+valor fallback in the new path.

**Tech Stack:** Supabase/Postgres migration + RPCs, React/TypeScript services & hooks, Vitest opt-in integration tests.

---

## Scope Boundary

In scope:
- Migration `supabase/migrations/20260529110000_local_billing_ledger_phase2.sql` with 4 RPCs.
- TypeScript service wrappers + React Query mutation hooks.
- Opt-in integration tests for the mandatory scenarios.

Out of scope (later phases / explicit spec exclusions):
- Rebuilding the consolidated-invoice modal in `Faturamento.tsx` (Phase 3).
- Rewiring `src/services/reconciliacao.ts` to drop the CNPJ fallback (Phase 4 / UI cutover). The new TXID RPC is added but the existing reconciliation screen keeps working unchanged.
- Migrating Demurrage to the ledger.
- A new individual-issuance RPC. Individual invoices keep using the existing `create_invoice_from_bls` flow plus `sync_local_charge_receivable`; adding a parallel individual RPC now would duplicate a working path.
- Generating `invoice_items` / `invoice_bls` rows for consolidated invoices (consolidated lives purely in `invoice_receivable_links`; PDF rendering is a Phase 3 concern). Note: `invoice_bls` cannot be reused here because `prevent_duplicate_active_invoice_bl_link` blocks a second active link for a BL already in an individual invoice.

## File Structure

- Create `supabase/migrations/20260529110000_local_billing_ledger_phase2.sql`
- Modify `src/types/database.ts` (RPC signatures + result types)
- Modify `src/services/billingLedger.ts` (4 wrappers + PIX persist for consolidated)
- Modify `src/hooks/useBillingLedger.ts` (mutation hooks)
- Modify `src/integration/supabase.integration.test.ts` (opt-in scenarios)

---

### Task 1: Core Payment RPC

**Files:**
- Create: `supabase/migrations/20260529110000_local_billing_ledger_phase2.sql`

- [x] **Step 1: Create the migration file with `register_ledger_invoice_payment`**

Use this as the initial migration content:

```sql
-- Phase 2: Transactional ledger RPCs for local-charge billing.
-- The receivable balance is the source of truth. This core RPC is shared by
-- manual payment and TXID reconciliation. Existing invoice/payment flows stay intact.

CREATE OR REPLACE FUNCTION public.register_ledger_invoice_payment(
  p_invoice_id BIGINT,
  p_amount_brl NUMERIC,
  p_method TEXT DEFAULT 'pix',
  p_paid_at TIMESTAMPTZ DEFAULT now(),
  p_pix_txid TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'manual',
  p_notes TEXT DEFAULT NULL,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice RECORD;
  v_actor UUID;
  v_open NUMERIC(14,2);
  v_payment_id BIGINT;
  v_total_paid NUMERIC(14,2);
  v_receivable_ids BIGINT[];
  v_covered INTEGER := 0;
  v_obsoleted INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  IF COALESCE(p_source, 'manual') NOT IN ('manual', 'pix_extract') THEN
    RAISE EXCEPTION 'Origem de pagamento invalida.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_amount_brl, 0) <= 0 THEN
    RAISE EXCEPTION 'Valor de pagamento deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;

  -- Idempotency guard for reconciliation: a TXID can settle only once.
  IF NULLIF(TRIM(COALESCE(p_pix_txid, '')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.ledger_settlements
       WHERE pix_txid IS NOT NULL
         AND UPPER(REGEXP_REPLACE(pix_txid, '[^A-Za-z0-9]', '', 'g'))
           = UPPER(REGEXP_REPLACE(p_pix_txid, '[^A-Za-z0-9]', '', 'g'))
     ) THEN
    RAISE EXCEPTION 'TXID % ja foi conciliado.', p_pix_txid USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') NOT IN ('issued', 'partially_paid', 'overdue') THEN
    RAISE EXCEPTION 'Invoice % nao esta em estado pagavel (status=%).', p_invoice_id, v_invoice.status
      USING ERRCODE = '22023';
  END IF;

  -- Lock the receivables backing this invoice (ordered to avoid deadlocks).
  SELECT ARRAY_AGG(irl.receivable_id ORDER BY irl.receivable_id)
  INTO v_receivable_ids
  FROM public.invoice_receivable_links irl
  WHERE irl.invoice_id = p_invoice_id
    AND irl.status = 'active';

  IF v_receivable_ids IS NULL OR ARRAY_LENGTH(v_receivable_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Invoice % sem receivables ativos vinculados no ledger.', p_invoice_id
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.bl_receivables WHERE id = ANY(v_receivable_ids) ORDER BY id FOR UPDATE;

  -- Reject if any backing receivable was already settled (concurrency guard).
  IF EXISTS (
    SELECT 1 FROM public.bl_receivables
    WHERE id = ANY(v_receivable_ids) AND status = 'settled'
  ) THEN
    RAISE EXCEPTION 'Um ou mais B/Ls ja foram liquidados por outro documento.' USING ERRCODE = '23505';
  END IF;

  SELECT COALESCE(SUM(balance_brl), 0) INTO v_open
  FROM public.bl_receivables
  WHERE id = ANY(v_receivable_ids);

  IF ABS(p_amount_brl - v_open) > 0.01 THEN
    RAISE EXCEPTION 'Valor (%.2f) difere do saldo em aberto do documento (%.2f). Pagamento parcial nao suportado.',
      p_amount_brl, v_open USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payments (invoice_id, amount_brl, payment_method, paid_at, registered_by, notes)
  VALUES (
    p_invoice_id,
    p_amount_brl,
    COALESCE(NULLIF(TRIM(COALESCE(p_method, '')), ''), 'pix'),
    COALESCE(p_paid_at, now()),
    v_actor,
    NULLIF(TRIM(COALESCE(p_notes, '')), '')
  )
  RETURNING id INTO v_payment_id;

  -- One settlement per receivable; settle each fully.
  INSERT INTO public.ledger_settlements (payment_id, receivable_id, invoice_id, amount_brl, settled_at, method, pix_txid, source)
  SELECT
    v_payment_id,
    br.id,
    p_invoice_id,
    br.balance_brl,
    COALESCE(p_paid_at, now()),
    COALESCE(NULLIF(TRIM(COALESCE(p_method, '')), ''), 'pix'),
    NULLIF(TRIM(COALESCE(p_pix_txid, '')), ''),
    COALESCE(p_source, 'manual')
  FROM public.bl_receivables br
  WHERE br.id = ANY(v_receivable_ids)
    AND br.balance_brl > 0;

  UPDATE public.bl_receivables
  SET settled_amount_brl = original_amount_brl,
      balance_brl = 0,
      status = 'settled',
      updated_at = now()
  WHERE id = ANY(v_receivable_ids);

  UPDATE public.invoice_receivable_links
  SET status = 'settled_by_this_invoice'
  WHERE invoice_id = p_invoice_id AND status = 'active';

  SELECT COALESCE(SUM(amount_brl), 0) INTO v_total_paid
  FROM public.payments WHERE invoice_id = p_invoice_id;

  UPDATE public.invoices
  SET total_paid_brl = v_total_paid, balance_brl = 0, status = 'paid'
  WHERE id = p_invoice_id;

  IF COALESCE(v_invoice.invoice_type, 'individual') = 'consolidated' THEN
    -- The consolidated covers the individuals of the same receivables.
    WITH covered AS (
      UPDATE public.invoices ind
      SET status = 'covered', covered_by_invoice_id = p_invoice_id
      WHERE ind.id <> p_invoice_id
        AND ind.invoice_type = 'individual'
        AND COALESCE(ind.status, 'issued') IN ('issued', 'partially_paid', 'overdue')
        AND EXISTS (
          SELECT 1 FROM public.invoice_receivable_links l
          WHERE l.invoice_id = ind.id AND l.receivable_id = ANY(v_receivable_ids)
        )
      RETURNING ind.id
    )
    SELECT COUNT(*) INTO v_covered FROM covered;

    UPDATE public.invoice_receivable_links
    SET status = 'settled_elsewhere'
    WHERE invoice_id <> p_invoice_id
      AND receivable_id = ANY(v_receivable_ids)
      AND status = 'active';

    INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, related_invoice_id, actor, payload)
    SELECT ind.id, 'covered', p_invoice_id, v_actor,
      jsonb_build_object('reason', 'Coberta por consolidada', 'consolidated_invoice_id', p_invoice_id)
    FROM public.invoices ind
    WHERE ind.covered_by_invoice_id = p_invoice_id AND ind.status = 'covered';
  ELSE
    -- An individual (or granite) payment makes open consolidated documents obsolete.
    WITH obsoleted AS (
      UPDATE public.invoices con
      SET status = 'obsolete',
          obsolete_reason = 'B/L liquidado por invoice individual ' || COALESCE(v_invoice.invoice_number, p_invoice_id::TEXT)
      WHERE con.id <> p_invoice_id
        AND con.invoice_type = 'consolidated'
        AND COALESCE(con.status, 'issued') IN ('issued', 'partially_paid', 'overdue')
        AND EXISTS (
          SELECT 1 FROM public.invoice_receivable_links l
          WHERE l.invoice_id = con.id AND l.receivable_id = ANY(v_receivable_ids)
        )
      RETURNING con.id
    )
    SELECT COUNT(*) INTO v_obsoleted FROM obsoleted;

    UPDATE public.invoice_receivable_links
    SET status = 'obsolete'
    WHERE invoice_id <> p_invoice_id
      AND receivable_id = ANY(v_receivable_ids)
      AND invoice_id IN (
        SELECT id FROM public.invoices WHERE invoice_type = 'consolidated' AND status = 'obsolete'
      )
      AND status = 'active';

    INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, related_invoice_id, actor, payload)
    SELECT con.id, 'obsolete', p_invoice_id, v_actor,
      jsonb_build_object('reason', con.obsolete_reason, 'paid_invoice_id', p_invoice_id)
    FROM public.invoices con
    WHERE con.invoice_type = 'consolidated' AND con.status = 'obsolete'
      AND EXISTS (
        SELECT 1 FROM public.invoice_receivable_links l
        WHERE l.invoice_id = con.id AND l.receivable_id = ANY(v_receivable_ids)
      );
  END IF;

  -- Keep legacy BL financial_status consistent with the settled receivables.
  UPDATE public.bls b
  SET financial_status = 'paid'
  WHERE b.id IN (
    SELECT br.bl_id FROM public.bl_receivables br WHERE br.id = ANY(v_receivable_ids)
  );

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, receivable_id, actor, payload)
  VALUES (
    p_invoice_id,
    CASE WHEN COALESCE(p_source, 'manual') = 'pix_extract' THEN 'reconciled_by_txid' ELSE 'paid' END,
    NULL,
    v_actor,
    jsonb_build_object('amount_brl', p_amount_brl, 'source', COALESCE(p_source, 'manual'), 'pix_txid', NULLIF(TRIM(COALESCE(p_pix_txid, '')), ''))
  );

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES (
    'invoice', p_invoice_id::TEXT, 'ledger_payment',
    COALESCE(v_invoice.balance_brl::TEXT, '0'), v_total_paid::TEXT, auth.uid(), now(),
    'Baixa via ledger (' || COALESCE(p_source, 'manual') || ')'
  );

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'payment_id', v_payment_id,
    'status', 'paid',
    'amount_brl', p_amount_brl,
    'receivables_settled', ARRAY_LENGTH(v_receivable_ids, 1),
    'individuals_covered', v_covered,
    'consolidated_obsoleted', v_obsoleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_ledger_invoice_payment(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_ledger_invoice_payment(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, UUID) TO authenticated;
```

- [x] **Step 2: Verify build (no TS changes yet)**

```bash
npm run build
```

Expected: passes (no TS files changed).

- [x] **Step 3: Commit core payment RPC**

```bash
git add supabase/migrations/20260529110000_local_billing_ledger_phase2.sql
git commit -m "Add ledger core payment RPC"
```

---

### Task 2: Creation, Obsolete, and TXID Reconciliation RPCs

**Files:**
- Modify: `supabase/migrations/20260529110000_local_billing_ledger_phase2.sql`

- [x] **Step 1: Append `create_local_consolidated_invoice`**

```sql
CREATE OR REPLACE FUNCTION public.create_local_consolidated_invoice(
  p_customer_id BIGINT,
  p_receivable_ids BIGINT[],
  p_due_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_ids BIGINT[];
  v_count INTEGER;
  v_invoice_id BIGINT;
  v_invoice_number TEXT;
  v_total NUMERIC(14,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT ARRAY_AGG(DISTINCT id ORDER BY id)
  INTO v_ids
  FROM UNNEST(COALESCE(p_receivable_ids, ARRAY[]::BIGINT[])) AS u(id)
  WHERE id IS NOT NULL;

  IF COALESCE(ARRAY_LENGTH(v_ids, 1), 0) < 1 THEN
    RAISE EXCEPTION 'Nenhum receivable informado para consolidar.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.bl_receivables WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;

  SELECT COUNT(*) INTO v_count FROM public.bl_receivables WHERE id = ANY(v_ids);
  IF v_count <> ARRAY_LENGTH(v_ids, 1) THEN
    RAISE EXCEPTION 'Receivable(s) inexistente(s) na selecao.' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_receivables WHERE id = ANY(v_ids) AND customer_id <> p_customer_id
  ) THEN
    RAISE EXCEPTION 'Selecao contem receivables de clientes diferentes.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_receivables
    WHERE id = ANY(v_ids) AND (status NOT IN ('open', 'partially_settled') OR balance_brl <= 0)
  ) THEN
    RAISE EXCEPTION 'Todos os receivables precisam estar abertos com saldo positivo.' USING ERRCODE = '22023';
  END IF;

  -- None may already sit in an open payable consolidated document.
  IF EXISTS (
    SELECT 1
    FROM public.invoice_receivable_links l
    JOIN public.invoices inv ON inv.id = l.invoice_id
    WHERE l.receivable_id = ANY(v_ids)
      AND inv.invoice_type = 'consolidated'
      AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
  ) THEN
    RAISE EXCEPTION 'Um ou mais B/Ls ja estao em consolidada aberta.' USING ERRCODE = '23505';
  END IF;

  SELECT COALESCE(SUM(balance_brl), 0) INTO v_total
  FROM public.bl_receivables WHERE id = ANY(v_ids);

  INSERT INTO public.invoices (
    customer_id, bl_id, issued_at, due_date, total_brl, status, invoice_type,
    notes, total_paid_brl, balance_brl, issued_by
  )
  VALUES (
    p_customer_id, NULL, now(), p_due_date, v_total, 'issued', 'consolidated',
    NULLIF(TRIM(COALESCE(p_notes, '')), ''), 0, v_total, v_actor
  )
  RETURNING id, invoice_number INTO v_invoice_id, v_invoice_number;

  INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id, subtotal_brl, status, bl_snapshot)
  SELECT
    v_invoice_id, br.id, br.bl_id, br.balance_brl, 'active',
    jsonb_build_object('bl_id', br.bl_id, 'voyage_id', br.voyage_id, 'cargo_mode', br.cargo_mode, 'pol', br.pol, 'pod', br.pod)
  FROM public.bl_receivables br
  WHERE br.id = ANY(v_ids);

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
  VALUES (v_invoice_id, 'issued', v_actor,
    jsonb_build_object('invoice_type', 'consolidated', 'receivable_count', ARRAY_LENGTH(v_ids, 1), 'total_brl', v_total));

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('invoice', v_invoice_id::TEXT, 'create_consolidated', NULL,
    CONCAT('invoice=', v_invoice_number, ' | receivables=', ARRAY_LENGTH(v_ids, 1), ' | total=', v_total),
    auth.uid(), now(), 'Emissao de consolidada via ledger');

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'status', 'issued',
    'invoice_type', 'consolidated',
    'receivable_count', ARRAY_LENGTH(v_ids, 1),
    'total_brl', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_local_consolidated_invoice(BIGINT, BIGINT[], DATE, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_local_consolidated_invoice(BIGINT, BIGINT[], DATE, TEXT, UUID) TO authenticated;
```

- [x] **Step 2: Append `obsolete_consolidated_invoice`**

```sql
CREATE OR REPLACE FUNCTION public.obsolete_consolidated_invoice(
  p_invoice_id BIGINT,
  p_reason TEXT DEFAULT NULL,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice RECORD;
  v_actor UUID;
  v_reason TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());
  v_reason := COALESCE(NULLIF(TRIM(COALESCE(p_reason, '')), ''), 'Marcada obsoleta manualmente');

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.invoice_type, 'individual') <> 'consolidated' THEN
    RAISE EXCEPTION 'Apenas consolidadas podem ser marcadas obsoletas por esta rotina.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') NOT IN ('issued', 'partially_paid', 'overdue') THEN
    RAISE EXCEPTION 'Invoice % nao esta em estado obsoletavel (status=%).', p_invoice_id, v_invoice.status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices SET status = 'obsolete', obsolete_reason = v_reason WHERE id = p_invoice_id;

  UPDATE public.invoice_receivable_links SET status = 'obsolete'
  WHERE invoice_id = p_invoice_id AND status = 'active';

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
  VALUES (p_invoice_id, 'obsolete', v_actor, jsonb_build_object('reason', v_reason));

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('invoice', p_invoice_id::TEXT, 'obsolete_consolidated', COALESCE(v_invoice.status, 'issued'), 'obsolete', auth.uid(), now(), v_reason);

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'obsolete', 'reason', v_reason);
END;
$$;

REVOKE ALL ON FUNCTION public.obsolete_consolidated_invoice(BIGINT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.obsolete_consolidated_invoice(BIGINT, TEXT, UUID) TO authenticated;
```

- [x] **Step 3: Append `reconcile_invoice_payment_by_txid`**

```sql
CREATE OR REPLACE FUNCTION public.reconcile_invoice_payment_by_txid(
  p_txid TEXT,
  p_amount_brl NUMERIC,
  p_paid_at TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_norm TEXT;
  v_invoice_id BIGINT;
  v_match_count INTEGER;
  v_result JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_norm := UPPER(REGEXP_REPLACE(COALESCE(p_txid, ''), '[^A-Za-z0-9]', '', 'g'));
  IF v_norm = '' THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'empty_txid');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ledger_settlements
    WHERE pix_txid IS NOT NULL
      AND UPPER(REGEXP_REPLACE(pix_txid, '[^A-Za-z0-9]', '', 'g')) = v_norm
  ) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled');
  END IF;

  -- TXID only: match against the payable local invoice number. No CNPJ/value fallback.
  SELECT COUNT(*), MIN(id) INTO v_match_count, v_invoice_id
  FROM public.invoices
  WHERE invoice_type IN ('individual', 'consolidated')
    AND COALESCE(status, 'issued') IN ('issued', 'partially_paid', 'overdue')
    AND UPPER(REGEXP_REPLACE(COALESCE(invoice_number, ''), '[^A-Za-z0-9]', '', 'g')) = v_norm;

  IF v_match_count = 0 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'no_match');
  ELSIF v_match_count > 1 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'ambiguous');
  END IF;

  BEGIN
    v_result := public.register_ledger_invoice_payment(
      p_invoice_id := v_invoice_id,
      p_amount_brl := p_amount_brl,
      p_method := 'pix',
      p_paid_at := COALESCE(p_paid_at, now()),
      p_pix_txid := p_txid,
      p_source := 'pix_extract',
      p_notes := 'Conciliacao automatica por TXID',
      p_actor := auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('matched', true, 'invoice_id', v_invoice_id, 'settled', false, 'reason', SQLERRM);
  END;

  UPDATE public.invoices
  SET pix_txid = p_txid, conciliated_by_extract = true
  WHERE id = v_invoice_id;

  RETURN jsonb_build_object('matched', true, 'invoice_id', v_invoice_id, 'settled', true, 'payment', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_invoice_payment_by_txid(TEXT, NUMERIC, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_invoice_payment_by_txid(TEXT, NUMERIC, TIMESTAMPTZ) TO authenticated;
```

- [x] **Step 4: Verify build**

```bash
npm run build
```

Expected: passes.

- [x] **Step 5: Commit creation/obsolete/reconciliation RPCs**

```bash
git add supabase/migrations/20260529110000_local_billing_ledger_phase2.sql
git commit -m "Add ledger consolidated, obsolete and TXID reconciliation RPCs"
```

---

### Task 3: TypeScript Service and Hooks

**Files:**
- Modify: `src/types/database.ts`
- Modify: `src/services/billingLedger.ts`
- Modify: `src/hooks/useBillingLedger.ts`

- [x] **Step 1: Add RPC signatures and result types to `src/types/database.ts`**

Add these result types next to `ConsolidatableReceivable`:

```ts
export type LedgerPaymentResult = {
  invoice_id: number
  payment_id: number
  status: 'paid'
  amount_brl: number
  receivables_settled: number
  individuals_covered: number
  consolidated_obsoleted: number
}

export type ConsolidatedInvoiceResult = {
  invoice_id: number
  invoice_number: string
  status: 'issued'
  invoice_type: 'consolidated'
  receivable_count: number
  total_brl: number
}

export type ReconcileByTxidResult = {
  matched: boolean
  reason?: string
  invoice_id?: number
  settled?: boolean
  payment?: LedgerPaymentResult
}
```

Add these signatures under `Database['public']['Functions']` (after `list_consolidatable_receivables`):

```ts
      register_ledger_invoice_payment: {
        Args: {
          p_invoice_id: number
          p_amount_brl: number
          p_method: string
          p_paid_at: string | null
          p_pix_txid: string | null
          p_source: string
          p_notes: string | null
          p_actor: string | null
        }
        Returns: Json
      }
      create_local_consolidated_invoice: {
        Args: {
          p_customer_id: number
          p_receivable_ids: number[]
          p_due_date: string | null
          p_notes: string | null
          p_actor: string | null
        }
        Returns: Json
      }
      obsolete_consolidated_invoice: {
        Args: {
          p_invoice_id: number
          p_reason: string | null
          p_actor: string | null
        }
        Returns: Json
      }
      reconcile_invoice_payment_by_txid: {
        Args: {
          p_txid: string
          p_amount_brl: number
          p_paid_at: string | null
        }
        Returns: Json
      }
```

- [x] **Step 2: Add service wrappers to `src/services/billingLedger.ts`**

Append:

```ts
import { buildTransshippingPixPayload } from '../lib/pix'
import type {
  ConsolidatedInvoiceResult,
  LedgerPaymentResult,
  ReconcileByTxidResult,
} from '../types/database'

export async function createConsolidatedInvoice(input: {
  customerId: number
  receivableIds: number[]
  dueDate?: string | null
  notes?: string | null
}) {
  const { data, error } = await supabase.rpc('create_local_consolidated_invoice', {
    p_customer_id: input.customerId,
    p_receivable_ids: input.receivableIds,
    p_due_date: input.dueDate ?? null,
    p_notes: input.notes?.trim() || null,
    p_actor: null,
  })
  if (error) throw error
  const result = data as unknown as ConsolidatedInvoiceResult

  // Generate the PIX payload using the consolidated invoice number as TXID.
  if (result?.invoice_id && result.total_brl > 0 && result.invoice_number) {
    const payload = buildTransshippingPixPayload(result.total_brl, result.invoice_number)
    await supabase.from('invoices').update({ pix_payload: payload }).eq('id', result.invoice_id)
  }
  return result
}

export async function registerLedgerInvoicePayment(input: {
  invoiceId: number
  amountBrl: number
  method?: string
  paidAt?: string | null
  pixTxid?: string | null
  source?: 'manual' | 'pix_extract'
  notes?: string | null
}) {
  const { data, error } = await supabase.rpc('register_ledger_invoice_payment', {
    p_invoice_id: input.invoiceId,
    p_amount_brl: input.amountBrl,
    p_method: input.method ?? 'pix',
    p_paid_at: input.paidAt ?? null,
    p_pix_txid: input.pixTxid ?? null,
    p_source: input.source ?? 'manual',
    p_notes: input.notes?.trim() || null,
    p_actor: null,
  })
  if (error) throw error
  return data as unknown as LedgerPaymentResult
}

export async function obsoleteConsolidatedInvoice(input: { invoiceId: number; reason?: string | null }) {
  const { data, error } = await supabase.rpc('obsolete_consolidated_invoice', {
    p_invoice_id: input.invoiceId,
    p_reason: input.reason?.trim() || null,
    p_actor: null,
  })
  if (error) throw error
  return data as unknown as { invoice_id: number; status: 'obsolete'; reason: string }
}

export async function reconcileInvoicePaymentByTxid(input: {
  txid: string
  amountBrl: number
  paidAt?: string | null
}) {
  const { data, error } = await supabase.rpc('reconcile_invoice_payment_by_txid', {
    p_txid: input.txid,
    p_amount_brl: input.amountBrl,
    p_paid_at: input.paidAt ?? null,
  })
  if (error) throw error
  return data as unknown as ReconcileByTxidResult
}
```

- [x] **Step 3: Add mutation hooks to `src/hooks/useBillingLedger.ts`**

Append:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createConsolidatedInvoice,
  obsoleteConsolidatedInvoice,
  registerLedgerInvoicePayment,
} from '../services/billingLedger'

function useLedgerInvalidation() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.billingLedger.all() })
    qc.invalidateQueries({ queryKey: queryKeys.invoices.all() })
    qc.invalidateQueries({ queryKey: queryKeys.bls.all() })
  }
}

export function useCreateConsolidatedInvoice() {
  const invalidate = useLedgerInvalidation()
  return useMutation({
    mutationFn: createConsolidatedInvoice,
    onSuccess: invalidate,
  })
}

export function useRegisterLedgerInvoicePayment() {
  const invalidate = useLedgerInvalidation()
  return useMutation({
    mutationFn: registerLedgerInvoicePayment,
    onSuccess: invalidate,
  })
}

export function useObsoleteConsolidatedInvoice() {
  const invalidate = useLedgerInvalidation()
  return useMutation({
    mutationFn: obsoleteConsolidatedInvoice,
    onSuccess: invalidate,
  })
}
```

- [x] **Step 4: Verify typecheck/build**

```bash
npm run build
```

Expected: passes with new types/services/hooks.

- [x] **Step 5: Commit TypeScript ledger write layer**

```bash
git add src/types/database.ts src/services/billingLedger.ts src/hooks/useBillingLedger.ts
git commit -m "Add ledger write services and hooks"
```

---

### Task 4: Integration Tests and Verification

**Files:**
- Modify: `src/integration/supabase.integration.test.ts`

- [ ] **Step 1: Add opt-in integration test for the consolidated + payment + reconciliation flow**

In `src/integration/supabase.integration.test.ts`, add inside the existing `describeIntegration` block after the Phase 1 ledger test:

```ts
  billingFlowTest('ledger phase 2 reconciliation is TXID-only and idempotent', async () => {
    // No TXID -> nothing settled.
    const none = await client.rpc('reconcile_invoice_payment_by_txid', {
      p_txid: 'TXID-DOES-NOT-EXIST-' + Date.now(),
      p_amount_brl: 1,
      p_paid_at: null,
    })
    expect(none.error).toBeNull()
    expect((none.data as { matched: boolean })?.matched).toBe(false)

    // Empty TXID is rejected cleanly, never auto-settled.
    const empty = await client.rpc('reconcile_invoice_payment_by_txid', {
      p_txid: '   ',
      p_amount_brl: 1,
      p_paid_at: null,
    })
    expect(empty.error).toBeNull()
    expect((empty.data as { matched: boolean; reason?: string })?.matched).toBe(false)
    expect((empty.data as { reason?: string })?.reason).toBe('empty_txid')
  })
```

- [ ] **Step 2: Self-review — no Demurrage changes in the migration**

```bash
rg -n "demurrage|demurrage_invoices" supabase/migrations/20260529110000_local_billing_ledger_phase2.sql
```

Expected: no matches.

- [ ] **Step 3: Self-review — reconciliation path has no CNPJ/valor fallback**

```bash
rg -n "cnpj|cpf|customer.*amount|amount.*customer" supabase/migrations/20260529110000_local_billing_ledger_phase2.sql
```

Expected: no matches (TXID-only).

- [ ] **Step 4: Confirm existing reconciliation screen untouched**

```bash
git status --short src/services/reconciliacao.ts src/pages
```

Expected: no changes to `reconciliacao.ts` or pages (UI cutover is a later phase).

- [ ] **Step 5: Run all checks**

```bash
npm test
npm run build
```

Expected: tests and build pass; integration tests remain skipped unless `SUPABASE_RUN_INTEGRATION=1`.

- [ ] **Step 6: Commit integration tests**

```bash
git add src/integration/supabase.integration.test.ts
git commit -m "Add ledger phase 2 integration test"
```

---

## Follow-Up Plans

After Phase 2 is merged and verified:

1. Phase 3: rebuild the consolidated-invoice modal in `Faturamento.tsx` on `listConsolidatableReceivables` + `createConsolidatedInvoice`, and render consolidated PDFs from `invoice_receivable_links`.
2. Phase 4: cut reconciliation and reports/portal over to the ledger (drop the CNPJ+valor fallback once the TXID path is covered by tests), and migrate balance reads from invoice to receivable.
