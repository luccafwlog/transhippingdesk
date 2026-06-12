CREATE OR REPLACE FUNCTION public.create_invoice_from_bls_with_ledger(
  p_bl_ids TEXT[],
  p_customer_id BIGINT DEFAULT NULL,
  p_due_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_issue_now BOOLEAN DEFAULT true,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
  v_invoice_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_result := public.create_invoice_from_bls_core(
    p_bl_ids,
    p_customer_id,
    p_due_date,
    p_notes,
    p_issue_now,
    COALESCE(p_actor, auth.uid()),
    'internal',
    NULL
  );

  v_invoice_id := (v_result->>'invoice_id')::BIGINT;
  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Falha ao criar invoice para B/Ls.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.link_invoice_to_ledger(v_invoice_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice_from_bls_with_ledger(TEXT[], BIGINT, DATE, TEXT, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_bls_with_ledger(TEXT[], BIGINT, DATE, TEXT, BOOLEAN, UUID) TO authenticated;
