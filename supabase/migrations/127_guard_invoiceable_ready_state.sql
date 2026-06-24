-- Renumbered from 20260618163840 (original timestamped migration: 20260618163840_guard_invoiceable_ready_state.sql).
-- Prevent B/Ls without positive BRL charge lines from reaching ready_for_billing.

CREATE OR REPLACE FUNCTION public.mark_bl_ready_for_billing(
  p_bl_id TEXT,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bl RECORD;
  v_pending_count INTEGER := 0;
  v_usd_count INTEGER := 0;
  v_table_count INTEGER := 0;
  v_invoiceable_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  SELECT
    id,
    charge_status,
    pod,
    cargo_mode,
    customer_id,
    customer_reconciliation_status
  INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.customer_id IS NULL THEN
    UPDATE public.bls
    SET billing_hold_reason = 'Cliente nao reconciliado para faturamento.'
    WHERE id = p_bl_id;

    RAISE EXCEPTION
      'B/L % nao possui cliente vinculado. Vincule um cliente antes de marcar como pronto para faturar.',
      p_bl_id
      USING ERRCODE = 'P0003';
  END IF;

  IF COALESCE(v_bl.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled') THEN
    UPDATE public.bls
    SET billing_hold_reason = 'Cliente exige reconciliacao manual antes do faturamento.'
    WHERE id = p_bl_id;

    RAISE EXCEPTION 'B/L exige reconciliacao manual antes do faturamento.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO v_pending_count
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id
    AND status = 'review_required';

  IF v_pending_count > 0 THEN
    UPDATE public.bls
    SET billing_hold_reason = 'Ainda existem linhas com pendencia de revisao.'
    WHERE id = p_bl_id;

    RAISE EXCEPTION 'Ainda existem linhas com pendencia de revisao' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO v_usd_count
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id
    AND COALESCE(total_value_usd, 0) > 0
    AND COALESCE(status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_usd_count > 0 THEN
    UPDATE public.bls
    SET billing_hold_reason = 'Linhas em USD exigem ajuste manual antes do faturamento.'
    WHERE id = p_bl_id;

    RAISE EXCEPTION 'Existem linhas em USD que bloqueiam o ready_for_billing.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO v_invoiceable_count
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id
    AND COALESCE(total_value_brl, 0) > 0
    AND COALESCE(status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_invoiceable_count = 0 THEN
    UPDATE public.bls
    SET billing_hold_reason = 'B/L sem linhas BRL faturaveis. Recalcule as taxas antes de faturar.'
    WHERE id = p_bl_id;

    RAISE EXCEPTION 'B/L sem linhas BRL faturaveis.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO v_table_count
  FROM public.charge_tables
  WHERE public.normalize_port_code(pod) = public.normalize_port_code(v_bl.pod)
    AND cargo_mode = v_bl.cargo_mode
    AND active = true
    AND valid_from <= CURRENT_DATE
    AND (valid_to IS NULL OR valid_to >= CURRENT_DATE);

  IF v_table_count = 0 THEN
    RAISE EXCEPTION
      'Nenhuma tabela de cobranca vigente para POD "%" (modo: %). Configure em /taxas-locais antes de prosseguir.',
      v_bl.pod, v_bl.cargo_mode
      USING ERRCODE = 'P0004';
  END IF;

  UPDATE public.charge_calculations
  SET status = 'ready_for_billing'
  WHERE bl_id = p_bl_id
    AND status IN ('calculated', 'reviewed');

  UPDATE public.bls
  SET
    charge_status = 'ready_for_billing',
    billing_hold_reason = NULL
  WHERE id = p_bl_id;

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    changed_at,
    justification
  )
  VALUES (
    'bl',
    p_bl_id,
    'charge_status',
    COALESCE(v_bl.charge_status, 'null'),
    'ready_for_billing',
    auth.uid(),
    NOW(),
    'Marcado como pronto para faturar no modulo de Taxas Locais'
  );

  RETURN jsonb_build_object('bl_id', p_bl_id, 'status', 'ready_for_billing', 'changed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_bl_ready_for_billing(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_bl_ready_for_billing(TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.promote_calculated_bl_ready_for_billing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pending_count INTEGER := 0;
  v_usd_count INTEGER := 0;
  v_invoiceable_count INTEGER := 0;
BEGIN
  IF COALESCE(NEW.charge_status, 'not_calculated') <> 'calculated' THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS NULL
    OR COALESCE(NEW.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled') THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
  INTO v_pending_count
  FROM public.charge_calculations
  WHERE bl_id = NEW.id
    AND status = 'review_required';

  IF v_pending_count > 0 THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
  INTO v_invoiceable_count
  FROM public.charge_calculations
  WHERE bl_id = NEW.id
    AND COALESCE(total_value_brl, 0) > 0
    AND status IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_invoiceable_count = 0 THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
  INTO v_usd_count
  FROM public.charge_calculations
  WHERE bl_id = NEW.id
    AND COALESCE(total_value_usd, 0) > 0
    AND COALESCE(status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_usd_count > 0 THEN
    RETURN NEW;
  END IF;

  UPDATE public.charge_calculations
  SET status = 'ready_for_billing'
  WHERE bl_id = NEW.id
    AND status IN ('calculated', 'reviewed');

  NEW.charge_status := 'ready_for_billing';
  NEW.billing_hold_reason := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promote_calculated_bl_ready ON public.bls;
CREATE TRIGGER trg_promote_calculated_bl_ready
BEFORE INSERT OR UPDATE OF charge_status, customer_id, customer_reconciliation_status
ON public.bls
FOR EACH ROW
EXECUTE FUNCTION public.promote_calculated_bl_ready_for_billing();
