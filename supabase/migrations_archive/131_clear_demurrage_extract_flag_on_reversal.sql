-- Renumbered from 20260622132451 (original timestamped migration: 20260622132451_clear_demurrage_extract_flag_on_reversal.sql).
-- Cancelling a Demurrage payment must release every PIX reconciliation marker.
-- Rollback: restore reverse_demurrage_payment from
-- 20260614180000_require_justification_on_payment_reversal.sql.

CREATE OR REPLACE FUNCTION public.reverse_demurrage_payment(
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
  v_actor UUID;
  v_old_status TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa para cancelar a baixa.' USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT status INTO v_old_status
  FROM public.demurrage_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demurrage invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_old_status, '') <> 'paid' THEN
    RAISE EXCEPTION 'Demurrage invoice % nao esta paga (status=%).', p_invoice_id, COALESCE(v_old_status, '?')
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.demurrage_invoices
  SET
    status = 'issued',
    paid_at = NULL,
    pix_txid = NULL,
    conciliated_by_extract = false
  WHERE id = p_invoice_id;

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
    'demurrage_invoice',
    p_invoice_id::TEXT,
    'payment_reversed',
    v_old_status,
    'issued',
    v_actor,
    now(),
    TRIM(p_reason)
  );

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'new_status', 'issued'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_demurrage_payment(BIGINT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_demurrage_payment(BIGINT, TEXT, UUID) TO authenticated;
