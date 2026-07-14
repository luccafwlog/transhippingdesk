-- 188: Desacoplamento financeiro do Portal (issue #370).
-- A prontidão do Portal deixa de ser condição do gate de revisão/faturamento.
-- A visibilidade passa a ser dada por alertas preventivos e exceções críticas.
-- Nenhuma outra condição do gate foi alterada.

CREATE OR REPLACE FUNCTION public.compute_bl_review_pendencies(
  p_customer_id BIGINT,
  p_cargo_mode TEXT,
  p_bb_weight_ton NUMERIC
)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_reasons TEXT[] := ARRAY[]::TEXT[];
  v_has_email BOOLEAN := false;
BEGIN
  IF p_customer_id IS NULL THEN
    v_reasons := array_append(v_reasons, 'Cliente nao vinculado');
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.customer_contacts c
      WHERE c.customer_id = p_customer_id
        AND NULLIF(btrim(c.email), '') IS NOT NULL
    ) INTO v_has_email;

    IF NOT v_has_email THEN
      v_reasons := array_append(v_reasons, 'Cliente sem e-mail cadastrado');
    END IF;
  END IF;

  IF p_cargo_mode = 'carga_solta'
     AND (p_bb_weight_ton IS NULL OR p_bb_weight_ton <= 0) THEN
    v_reasons := array_append(v_reasons, 'Peso BB ausente');
  END IF;

  RETURN v_reasons;
END;
$function$;

REVOKE ALL ON FUNCTION public.compute_bl_review_pendencies(BIGINT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
