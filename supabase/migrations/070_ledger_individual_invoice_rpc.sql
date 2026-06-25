-- Renumbered from 20260529140000 (original timestamped migration: 20260529140000_ledger_individual_invoice_rpc.sql).
-- Phase 4e: expose the individual local-charge invoice creation as a ledger RPC.
-- The auto-emission trigger now routes through this RPC after syncing the B/L
-- receivable, keeping the individual workflow on the same ledger API surface as
-- consolidated creation and payments.

CREATE OR REPLACE FUNCTION public.sync_local_charge_receivable(p_bl_id TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bl RECORD;
  v_amount NUMERIC(14,2);
  v_paid_amount NUMERIC(14,2);
  v_receivable_id BIGINT;
  v_status TEXT;
BEGIN
  IF auth.uid() IS NOT NULL
     AND (NOT public.is_active_user() OR NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT id, customer_id, voyage_id, cargo_mode, pol, pod
  INTO v_bl
  FROM public.bls
  WHERE id = UPPER(TRIM(p_bl_id));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.customer_id IS NULL THEN
    RAISE EXCEPTION 'B/L % sem cliente vinculado.', p_bl_id USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(COALESCE(total_value_brl, 0)), 0)
  INTO v_amount
  FROM public.charge_calculations
  WHERE bl_id = v_bl.id
    AND COALESCE(status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt');

  SELECT COALESCE(SUM(p.amount_brl), 0)
  INTO v_paid_amount
  FROM public.invoice_bls ib
  JOIN public.invoices i ON i.id = ib.invoice_id
  JOIN public.payments p ON p.invoice_id = i.id
  WHERE ib.bl_id = v_bl.id
    AND COALESCE(i.status, 'issued') = 'paid';

  v_paid_amount := LEAST(v_paid_amount, v_amount);
  v_status := CASE
    WHEN v_amount <= 0 THEN 'void'
    WHEN v_paid_amount >= v_amount THEN 'settled'
    WHEN v_paid_amount > 0 THEN 'partially_settled'
    ELSE 'open'
  END;

  INSERT INTO public.bl_receivables (
    bl_id, customer_id, source, original_amount_brl, settled_amount_brl, balance_brl,
    status, voyage_id, cargo_mode, pol, pod, updated_at
  )
  VALUES (
    v_bl.id, v_bl.customer_id, 'local_charges', v_amount, v_paid_amount,
    GREATEST(v_amount - v_paid_amount, 0), v_status, v_bl.voyage_id,
    v_bl.cargo_mode, v_bl.pol, v_bl.pod, now()
  )
  ON CONFLICT (source, bl_id)
  DO UPDATE SET
    customer_id = EXCLUDED.customer_id,
    original_amount_brl = EXCLUDED.original_amount_brl,
    settled_amount_brl = EXCLUDED.settled_amount_brl,
    balance_brl = EXCLUDED.balance_brl,
    status = EXCLUDED.status,
    voyage_id = EXCLUDED.voyage_id,
    cargo_mode = EXCLUDED.cargo_mode,
    pol = EXCLUDED.pol,
    pod = EXCLUDED.pod,
    updated_at = now()
  RETURNING id INTO v_receivable_id;

  RETURN v_receivable_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_local_charge_receivable(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_local_charge_receivable(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_local_individual_invoice_from_receivable(
  p_receivable_id BIGINT,
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
  v_receivable RECORD;
  v_existing_invoice RECORD;
  v_result JSONB;
  v_invoice_id BIGINT;
  v_actor UUID := COALESCE(p_actor, auth.uid());
  v_notes TEXT := COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Emissao individual a partir do ledger do B/L');
BEGIN
  IF auth.uid() IS NOT NULL
     AND (NOT public.is_active_user() OR NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT
    br.id,
    br.bl_id,
    br.customer_id,
    br.source,
    br.balance_brl,
    br.status,
    b.charge_status,
    b.financial_status
  INTO v_receivable
  FROM public.bl_receivables br
  JOIN public.bls b ON b.id = br.bl_id
  WHERE br.id = p_receivable_id
  FOR UPDATE OF br;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receivable % nao encontrado.', p_receivable_id USING ERRCODE = 'P0002';
  END IF;

  IF v_receivable.source <> 'local_charges' THEN
    RAISE EXCEPTION 'Receivable % nao e de taxas locais.', p_receivable_id USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_receivable.status, 'open') NOT IN ('open', 'partially_settled')
     OR COALESCE(v_receivable.balance_brl, 0) <= 0 THEN
    RAISE EXCEPTION 'Receivable % sem saldo aberto para invoice individual.', p_receivable_id USING ERRCODE = '22023';
  END IF;

  SELECT inv.id, inv.invoice_number, inv.status, inv.total_brl, inv.balance_brl
  INTO v_existing_invoice
  FROM public.invoice_receivable_links irl
  JOIN public.invoices inv ON inv.id = irl.invoice_id
  WHERE irl.receivable_id = p_receivable_id
    AND inv.invoice_type = 'individual'
    AND COALESCE(inv.status, 'issued') NOT IN ('cancelled', 'obsolete')
  ORDER BY inv.id DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'invoice_id', v_existing_invoice.id,
      'invoice_number', v_existing_invoice.invoice_number,
      'status', v_existing_invoice.status,
      'customer_id', v_receivable.customer_id,
      'bl_count', 1,
      'total_brl', v_existing_invoice.total_brl,
      'balance_brl', v_existing_invoice.balance_brl,
      'receivable_id', p_receivable_id,
      'invoice_type', 'individual',
      'existing', true
    );
  END IF;

  v_result := public.create_invoice_from_bls_core(
    ARRAY[v_receivable.bl_id],
    v_receivable.customer_id,
    p_due_date,
    v_notes,
    true,
    v_actor,
    CASE WHEN auth.uid() IS NULL THEN 'system_auto' ELSE 'internal' END,
    NULL
  );

  v_invoice_id := (v_result->>'invoice_id')::BIGINT;
  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Falha ao criar invoice individual para receivable %.', p_receivable_id USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.link_invoice_to_ledger(v_invoice_id);

  UPDATE public.invoices
  SET invoice_type = 'individual'
  WHERE id = v_invoice_id;

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, receivable_id, actor, payload)
  VALUES (
    v_invoice_id,
    'issued',
    p_receivable_id,
    v_actor,
    jsonb_build_object('source', CASE WHEN auth.uid() IS NULL THEN 'system_auto' ELSE 'manual' END)
  );

  RETURN v_result || jsonb_build_object(
    'receivable_id', p_receivable_id,
    'invoice_type', 'individual',
    'existing', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_local_individual_invoice_from_receivable(BIGINT, DATE, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_local_individual_invoice_from_receivable(BIGINT, DATE, TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.emit_invoice_on_bl_ready()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_receivable_id BIGINT;
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
      v_receivable_id := public.sync_local_charge_receivable(NEW.id);
      PERFORM public.create_local_individual_invoice_from_receivable(
        v_receivable_id,
        NULL,
        'Emissao automatica ao ficar pronto para faturamento',
        NULL
      );
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
