CREATE OR REPLACE FUNCTION public.mark_bl_ready_and_create_invoice(
  p_bl_id TEXT,
  p_customer_id BIGINT DEFAULT NULL,
  p_due_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bl_id TEXT := upper(trim(p_bl_id));
  v_customer_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(p_customer_id, b.customer_id)
  INTO v_customer_id
  FROM public.bls b
  WHERE b.id = v_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'B/L % sem cliente vinculado.', v_bl_id USING ERRCODE = '22023';
  END IF;

  PERFORM public.mark_bl_ready_for_billing(v_bl_id, p_actor);

  RETURN public.create_invoice_from_bls_with_ledger(
    ARRAY[v_bl_id],
    v_customer_id,
    p_due_date,
    p_notes,
    true,
    p_actor
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_bl_ready_and_create_invoice(TEXT, BIGINT, DATE, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_bl_ready_and_create_invoice(TEXT, BIGINT, DATE, TEXT, UUID) TO authenticated;
