-- Renumbered from 20260529120000 (original timestamped migration: 20260529120000_ledger_auto_emit_phase4a.sql).
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
