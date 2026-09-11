-- 040: tolerância a drift de maiúsculas e espaços em charge_status no resumo operacional.
--
-- Migration 036 comparava charge_status com case exato nos contadores dos tiles
-- (chargeReady, chargePending, chargeExempt), enquanto o filtro WHERE principal normalizava
-- com LOWER(BTRIM(...)). Esta migration substitui a função garantindo a mesma tolerância no FILTER.

CREATE OR REPLACE FUNCTION public.operational_list_bl_summary(
  p_search text DEFAULT NULL::text,
  p_voyage_id bigint DEFAULT NULL::bigint,
  p_cargo_mode text DEFAULT NULL::text,
  p_pol text DEFAULT NULL::text,
  p_pod text DEFAULT NULL::text,
  p_review_status text DEFAULT NULL::text,
  p_financial_status text DEFAULT NULL::text,
  p_charge_status text DEFAULT NULL::text,
  p_cargo_profile text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
WITH filtered AS (
  SELECT b.*
  FROM public.bls AS b
  LEFT JOIN public.customers AS c ON c.id = b.customer_id
  WHERE (p_voyage_id IS NULL OR b.voyage_id = p_voyage_id)
    AND (NULLIF(BTRIM(COALESCE(p_cargo_mode, '')), '') IS NULL OR b.cargo_mode = p_cargo_mode)
    AND (NULLIF(BTRIM(COALESCE(p_pol, '')), '') IS NULL OR b.pol ILIKE '%' || BTRIM(p_pol) || '%')
    AND (NULLIF(BTRIM(COALESCE(p_pod, '')), '') IS NULL OR b.pod ILIKE '%' || BTRIM(p_pod) || '%')
    AND (NULLIF(BTRIM(COALESCE(p_review_status, '')), '') IS NULL OR b.review_status = p_review_status)
    AND (NULLIF(BTRIM(COALESCE(p_financial_status, '')), '') IS NULL OR b.financial_status = p_financial_status)
    AND (NULLIF(BTRIM(COALESCE(p_charge_status, '')), '') IS NULL OR LOWER(BTRIM(COALESCE(b.charge_status, ''))) = LOWER(BTRIM(p_charge_status)))
    AND (
      NULLIF(BTRIM(COALESCE(p_search, '')), '') IS NULL
      OR b.id ILIKE '%' || BTRIM(p_search) || '%'
      OR b.consignee ILIKE '%' || BTRIM(p_search) || '%'
      OR c.name ILIKE '%' || BTRIM(p_search) || '%'
      OR c.cnpj_cpf ILIKE '%' || BTRIM(p_search) || '%'
    )
    AND (
      NULLIF(BTRIM(COALESCE(p_cargo_profile, '')), '') IS NULL
      OR (p_cargo_profile = 'standard' AND NOT EXISTS (
        SELECT 1
        FROM public.bl_containers AS bc
        WHERE bc.bl_id = b.id
          AND (COALESCE(bc.is_imo, false) OR COALESCE(bc.is_oog, false))
      ))
      OR (p_cargo_profile = 'imo' AND EXISTS (
        SELECT 1 FROM public.bl_containers AS bc WHERE bc.bl_id = b.id AND COALESCE(bc.is_imo, false)
      ))
      OR (p_cargo_profile = 'oog' AND EXISTS (
        SELECT 1 FROM public.bl_containers AS bc WHERE bc.bl_id = b.id AND COALESCE(bc.is_oog, false)
      ))
    )
)
SELECT jsonb_build_object(
  'totalBls', COUNT(*)::integer,
  'totalDistinctContainers', (
    SELECT COUNT(DISTINCT UPPER(BTRIM(bc.container_number)))
    FROM public.bl_containers AS bc
    JOIN filtered AS f ON f.id = bc.bl_id
    WHERE NULLIF(BTRIM(bc.container_number), '') IS NOT NULL
  ),
  'pendingReview', COUNT(*) FILTER (WHERE review_status = 'pending_review')::integer,
  'pendingFinancial', COUNT(*) FILTER (WHERE financial_status = 'pending')::integer,
  'chargePending', COUNT(*) FILTER (WHERE LOWER(BTRIM(COALESCE(charge_status, ''))) IN ('review_required', 'not_calculated'))::integer,
  'chargeReady', COUNT(*) FILTER (WHERE LOWER(BTRIM(COALESCE(charge_status, ''))) = 'ready_for_billing')::integer,
  'chargeExempt', COUNT(*) FILTER (WHERE LOWER(BTRIM(COALESCE(charge_status, ''))) = 'exempt')::integer,
  'totalMachines', COALESCE(SUM(bb_machine_qty), 0),
  'totalPackages', COALESCE(SUM(COALESCE(bb_packages_total, bb_packages_qty)), 0),
  'totalWeightTon', COALESCE(SUM(COALESCE(bb_weight_ton, total_weight_kg / 1000)), 0),
  'totalCbm', COALESCE(SUM(total_cbm), 0)
)
FROM filtered;
$$;

REVOKE ALL ON FUNCTION public.operational_list_bl_summary(text, bigint, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operational_list_bl_summary(text, bigint, text, text, text, text, text, text, text) TO authenticated, service_role;
