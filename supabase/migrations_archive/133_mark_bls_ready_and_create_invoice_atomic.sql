-- Renumbered from 20260622133100 (original timestamped migration: 20260622133100_mark_bls_ready_and_create_invoice_atomic.sql).
-- Promote and invoice one customer group atomically.
-- Rollback: drop public.mark_bls_ready_and_create_invoice and restore the
-- previous frontend batch flow only if partial promotion is acceptable.

CREATE OR REPLACE FUNCTION public.mark_bls_ready_and_create_invoice(
  p_bl_ids TEXT[],
  p_customer_id BIGINT,
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
  v_bl_ids TEXT[];
  v_bl RECORD;
  v_bl_id TEXT;
  v_found_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT ARRAY_AGG(DISTINCT upper(trim(value)) ORDER BY upper(trim(value)))
  INTO v_bl_ids
  FROM unnest(COALESCE(p_bl_ids, ARRAY[]::TEXT[])) AS value
  WHERE NULLIF(trim(value), '') IS NOT NULL;

  IF COALESCE(cardinality(v_bl_ids), 0) = 0 OR p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Informe ao menos um B/L e um cliente para faturar.' USING ERRCODE = '22023';
  END IF;

  FOR v_bl IN
    SELECT b.id, b.customer_id
    FROM public.bls b
    WHERE b.id = ANY(v_bl_ids)
    ORDER BY b.id
    FOR UPDATE
  LOOP
    v_found_count := v_found_count + 1;
    IF v_bl.customer_id IS DISTINCT FROM p_customer_id THEN
      RAISE EXCEPTION 'B/L % nao pertence ao cliente informado.', v_bl.id USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF v_found_count <> cardinality(v_bl_ids) THEN
    RAISE EXCEPTION 'Um ou mais B/Ls nao foram encontrados.' USING ERRCODE = 'P0002';
  END IF;

  FOREACH v_bl_id IN ARRAY v_bl_ids
  LOOP
    PERFORM public.mark_bl_ready_for_billing(v_bl_id, p_actor);
  END LOOP;

  RETURN public.create_invoice_from_bls_with_ledger(
    v_bl_ids,
    p_customer_id,
    p_due_date,
    p_notes,
    true,
    p_actor
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_bls_ready_and_create_invoice(TEXT[], BIGINT, DATE, TEXT, UUID)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_bls_ready_and_create_invoice(TEXT[], BIGINT, DATE, TEXT, UUID)
TO authenticated;
