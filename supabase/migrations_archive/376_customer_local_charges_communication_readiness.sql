-- 376: prontidão de comunicação de taxas locais por cliente e viagem.
--
-- A prontidão financeira é um veredito próprio do canal de Comunicados. Ela
-- não altera a revisão do B/L nem o gate do Portal: apenas reúne, por cliente,
-- o CE Mercante, as pendências da revisão e o estado financeiro de cada B/L.

CREATE OR REPLACE FUNCTION public.customer_local_charges_communication_readiness(
  p_voyage_id BIGINT,
  p_customer_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_active_read_user()) THEN
    RAISE EXCEPTION 'Usuário interno ativo é obrigatório.' USING ERRCODE = '42501';
  END IF;

  IF p_voyage_id IS NULL OR p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Viagem e cliente são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  WITH bl_state AS (
    SELECT
      b.id AS bl_id,
      NULLIF(btrim(b.ce_mercante), '') AS ce_mercante,
      COALESCE(b.financial_status, 'pending') AS financial_status,
      COALESCE(b.cargo_mode, 'container') AS cargo_mode,
      b.bb_weight_ton,
      public.compute_bl_review_pendencies(
        b.customer_id,
        COALESCE(b.cargo_mode, 'container'),
        b.bb_weight_ton
      ) AS review_pendencies
    FROM public.bls AS b
    WHERE b.voyage_id = p_voyage_id
      AND b.customer_id = p_customer_id
      -- B/L cancelado não participa do resumo nem pode bloquear o cliente.
      AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
  ), annotated AS (
    SELECT
      bl_state.*,
      array_remove(ARRAY[
        CASE WHEN bl_state.ce_mercante IS NULL THEN 'ce_mercante_ausente'::TEXT END,
        CASE WHEN COALESCE(cardinality(bl_state.review_pendencies), 0) > 0 THEN 'revisao_pendente'::TEXT END,
        CASE WHEN bl_state.financial_status NOT IN ('invoiced', 'paid') THEN 'faturamento_pendente'::TEXT END
      ], NULL) AS blocked_reasons
    FROM bl_state
  ), aggregate AS (
    SELECT
      count(*)::INTEGER AS bl_count,
      count(*) FILTER (WHERE cardinality(blocked_reasons) > 0)::INTEGER AS blocked_bl_count,
      COALESCE(bool_and(cardinality(blocked_reasons) = 0), false) AS ready,
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'bl_id', bl_id,
          'ce_mercante', ce_mercante,
          'financial_status', financial_status,
          'cargo_mode', cargo_mode,
          'review_pendencies', to_jsonb(review_pendencies),
          'blocked_reasons', to_jsonb(blocked_reasons)
        ) ORDER BY bl_id
      ), '[]'::JSONB) AS bls
    FROM annotated
  ), reason_aggregate AS (
    SELECT COALESCE(jsonb_agg(DISTINCT reason ORDER BY reason), '[]'::JSONB) AS reasons
    FROM annotated
    CROSS JOIN LATERAL unnest(annotated.blocked_reasons) AS reason
  )
  SELECT jsonb_build_object(
    'voyage_id', p_voyage_id,
    'customer_id', p_customer_id,
    'ready', CASE WHEN bl_count = 0 THEN false ELSE ready END,
    'reason_code', CASE
      WHEN bl_count = 0 THEN 'no_bls'
      WHEN ready THEN 'ready'
      ELSE COALESCE(reasons ->> 0, 'readiness_blocked')
    END,
    'bl_count', bl_count,
    'blocked_bl_count', blocked_bl_count,
    'reasons', reasons,
    'bls', bls
  )
  INTO v_result
  FROM aggregate CROSS JOIN reason_aggregate;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.customer_local_charges_communication_readiness(BIGINT, BIGINT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_local_charges_communication_readiness(BIGINT, BIGINT)
  TO service_role, authenticated;
