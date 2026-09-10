-- 020: projeções paginadas para as listas operacionais (S12).
-- A página e os contadores usam o mesmo conjunto filtrado, com ordenação total
-- por data e id. O RPC é invoker para preservar o RLS de bls/containers.

CREATE OR REPLACE FUNCTION public.operational_list_bls(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50,
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
  SELECT
    b.*,
    COUNT(*) OVER () AS total_count
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
        SELECT 1 FROM public.bl_containers bc
        WHERE bc.bl_id = b.id AND (COALESCE(bc.is_imo, false) OR COALESCE(bc.is_oog, false))
      ))
      OR (p_cargo_profile = 'imo' AND EXISTS (
        SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND COALESCE(bc.is_imo, false)
      ))
      OR (p_cargo_profile = 'oog' AND EXISTS (
        SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND COALESCE(bc.is_oog, false)
      ))
    )
), projected AS (
  SELECT
    f.*,
    (
      to_jsonb(f)
      - 'total_count'
      || jsonb_build_object(
        'customer', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', c.id, 'cnpj_cpf', c.cnpj_cpf, 'name', c.name
        ) END,
        'voyage', CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', v.id, 'voyage_number', v.voyage_number, 'eta', v.eta, 'ata', v.ata,
          'status', v.status,
          'vessel', CASE WHEN vs.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', vs.id, 'name', vs.name, 'imo', vs.imo,
            'carrier', CASE WHEN cr.id IS NULL THEN NULL ELSE jsonb_build_object(
              'id', cr.id, 'name', cr.name, 'scac', cr.scac
            ) END
          ) END
        ) END,
        'bl_containers', COALESCE((
          SELECT jsonb_agg(to_jsonb(bc) ORDER BY bc.id)
          FROM public.bl_containers bc WHERE bc.bl_id = f.id
        ), '[]'::jsonb),
        'bl_freight_lines', COALESCE((
          SELECT jsonb_agg(to_jsonb(bfl) ORDER BY bfl.seq NULLS LAST)
          FROM public.bl_freight_lines bfl WHERE bfl.bl_id = f.id
        ), '[]'::jsonb),
        'bl_breakbulk_items', COALESCE((
          SELECT jsonb_agg(to_jsonb(bb) ORDER BY bb.id)
          FROM public.bl_breakbulk_items bb WHERE bb.bl_id = f.id
        ), '[]'::jsonb)
      )
    ) AS row_json
  FROM filtered f
  LEFT JOIN public.customers c ON c.id = f.customer_id
  LEFT JOIN public.voyages v ON v.id = f.voyage_id
  LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
  LEFT JOIN public.carriers cr ON cr.id = vs.carrier_id
  ORDER BY f.created_at DESC NULLS LAST, f.id DESC
  OFFSET (GREATEST(COALESCE(p_page, 1), 1) - 1)
    * GREATEST(1, LEAST(COALESCE(p_page_size, 50), 100))
  LIMIT GREATEST(1, LEAST(COALESCE(p_page_size, 50), 100))
)
SELECT jsonb_build_object(
  'rows', COALESCE((SELECT jsonb_agg(row_json ORDER BY row_json->>'created_at' DESC NULLS LAST, row_json->>'id' DESC) FROM projected), '[]'::jsonb),
  'count', COALESCE((SELECT MAX(total_count) FROM filtered), 0)
);
$$;

CREATE OR REPLACE FUNCTION public.operational_list_containers(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50,
  p_search text DEFAULT NULL::text,
  p_voyage_id bigint DEFAULT NULL::bigint,
  p_cargo_mode text DEFAULT NULL::text,
  p_pol text DEFAULT NULL::text,
  p_pod text DEFAULT NULL::text,
  p_review_status text DEFAULT NULL::text,
  p_financial_status text DEFAULT NULL::text,
  p_charge_status text DEFAULT NULL::text,
  p_cargo_profile text DEFAULT NULL::text,
  p_container_type text DEFAULT NULL::text,
  p_vehicle_container boolean DEFAULT NULL::boolean
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
WITH filtered AS (
  SELECT bc.*, b.id AS bl_key, b.pol, b.pod, b.review_status, b.financial_status,
    b.charge_status, b.consignee, b.customer_id, b.voyage_id,
    c.name AS customer_name, c.cnpj_cpf AS customer_cnpj,
    v.voyage_number, v.eta, v.ata, v.status AS voyage_status,
    vs.id AS vessel_id, vs.name AS vessel_name, vs.imo AS vessel_imo,
    cr.name AS carrier_name, cr.scac AS carrier_scac,
    COUNT(*) OVER () AS total_count
  FROM public.bl_containers bc
  JOIN public.bls b ON b.id = bc.bl_id
  LEFT JOIN public.customers c ON c.id = b.customer_id
  LEFT JOIN public.voyages v ON v.id = b.voyage_id
  LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
  LEFT JOIN public.carriers cr ON cr.id = vs.carrier_id
  WHERE (p_voyage_id IS NULL OR b.voyage_id = p_voyage_id)
    AND (NULLIF(BTRIM(COALESCE(p_cargo_mode, '')), '') IS NULL OR b.cargo_mode = p_cargo_mode)
    AND (NULLIF(BTRIM(COALESCE(p_pol, '')), '') IS NULL OR b.pol ILIKE '%' || BTRIM(p_pol) || '%')
    AND (NULLIF(BTRIM(COALESCE(p_pod, '')), '') IS NULL OR b.pod ILIKE '%' || BTRIM(p_pod) || '%')
    AND (NULLIF(BTRIM(COALESCE(p_review_status, '')), '') IS NULL OR b.review_status = p_review_status)
    AND (NULLIF(BTRIM(COALESCE(p_financial_status, '')), '') IS NULL OR b.financial_status = p_financial_status)
    AND (NULLIF(BTRIM(COALESCE(p_charge_status, '')), '') IS NULL OR LOWER(BTRIM(COALESCE(b.charge_status, ''))) = LOWER(BTRIM(p_charge_status)))
    AND (NULLIF(BTRIM(COALESCE(p_container_type, '')), '') IS NULL OR UPPER(BTRIM(COALESCE(bc.type, ''))) = UPPER(BTRIM(p_container_type)))
    AND (
      NULLIF(BTRIM(COALESCE(p_search, '')), '') IS NULL
      OR bc.container_number ILIKE '%' || BTRIM(p_search) || '%'
      OR bc.seal_number ILIKE '%' || BTRIM(p_search) || '%'
      OR bc.type ILIKE '%' || BTRIM(p_search) || '%'
      OR bc.imo_class ILIKE '%' || BTRIM(p_search) || '%'
      OR bc.un_number ILIKE '%' || BTRIM(p_search) || '%'
      OR b.id ILIKE '%' || BTRIM(p_search) || '%'
      OR b.consignee ILIKE '%' || BTRIM(p_search) || '%'
      OR c.name ILIKE '%' || BTRIM(p_search) || '%'
      OR c.cnpj_cpf ILIKE '%' || BTRIM(p_search) || '%'
      OR vs.name ILIKE '%' || BTRIM(p_search) || '%'
      OR cr.name ILIKE '%' || BTRIM(p_search) || '%'
    )
    AND (
      NULLIF(BTRIM(COALESCE(p_cargo_profile, '')), '') IS NULL
      OR (p_cargo_profile = 'standard' AND NOT (COALESCE(bc.is_imo, false) OR COALESCE(bc.is_oog, false)))
      OR (p_cargo_profile = 'imo' AND COALESCE(bc.is_imo, false))
      OR (p_cargo_profile = 'oog' AND COALESCE(bc.is_oog, false))
    )
    AND (
      p_vehicle_container IS NULL
      OR (p_vehicle_container = true AND EXISTS (SELECT 1 FROM public.vehicles vh WHERE vh.container_id = bc.id))
      OR (p_vehicle_container = false AND NOT EXISTS (SELECT 1 FROM public.vehicles vh WHERE vh.container_id = bc.id))
    )
), projected AS (
  SELECT
    f.*,
    to_jsonb(f) - ARRAY[
      'bl_key','pol','pod','review_status','financial_status','charge_status','consignee',
      'customer_id','voyage_id','customer_name','customer_cnpj','voyage_number','eta','ata',
      'voyage_status','vessel_id','vessel_name','vessel_imo','carrier_name','carrier_scac','total_count'
    ]::text[] || jsonb_build_object(
      'bl', jsonb_build_object(
        'id', f.bl_key, 'pol', f.pol, 'pod', f.pod, 'review_status', f.review_status,
        'financial_status', f.financial_status, 'charge_status', f.charge_status,
        'consignee', f.consignee,
        'customer', CASE WHEN f.customer_id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', f.customer_id, 'cnpj_cpf', f.customer_cnpj, 'name', f.customer_name
        ) END,
        'voyage', CASE WHEN f.voyage_id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', f.voyage_id, 'voyage_number', f.voyage_number, 'eta', f.eta,
          'ata', f.ata, 'status', f.voyage_status,
          'vessel', CASE WHEN f.vessel_id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', f.vessel_id, 'name', f.vessel_name, 'imo', f.vessel_imo,
            'carrier', CASE WHEN cr.id IS NULL THEN NULL ELSE jsonb_build_object(
              'id', cr.id, 'name', f.carrier_name, 'scac', f.carrier_scac
            ) END
          ) END
        ) END
      )
    ) AS row_json
  FROM filtered f
  LEFT JOIN public.voyages v ON v.id = f.voyage_id
  LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
  LEFT JOIN public.carriers cr ON cr.id = vs.carrier_id
), page AS (
  SELECT * FROM projected
  ORDER BY (row_json->>'created_at') DESC NULLS LAST, (row_json->>'id')::bigint DESC
  OFFSET (GREATEST(COALESCE(p_page, 1), 1) - 1) * GREATEST(1, LEAST(COALESCE(p_page_size, 50), 100))
  LIMIT GREATEST(1, LEAST(COALESCE(p_page_size, 50), 100))
), type_summary AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('type', type_label, 'distinctCount', distinct_count)
    ORDER BY distinct_count DESC, type_label), '[]'::jsonb) AS value
  FROM (
    SELECT COALESCE(NULLIF(BTRIM(type), ''), 'Nao informado') AS type_label,
      COUNT(DISTINCT UPPER(BTRIM(container_number))) FILTER (WHERE NULLIF(BTRIM(container_number), '') IS NOT NULL) AS distinct_count
    FROM filtered GROUP BY COALESCE(NULLIF(BTRIM(type), ''), 'Nao informado')
  ) grouped_types
)
SELECT jsonb_build_object(
  'rows', COALESCE((SELECT jsonb_agg(row_json ORDER BY (row_json->>'created_at') DESC NULLS LAST, (row_json->>'id')::bigint DESC) FROM page), '[]'::jsonb),
  'count', COALESCE((SELECT MAX(total_count) FROM filtered), 0),
  'distinctCount', (SELECT COUNT(DISTINCT UPPER(BTRIM(container_number))) FROM filtered WHERE NULLIF(BTRIM(container_number), '') IS NOT NULL),
  'oogDistinctCount', (SELECT COUNT(DISTINCT UPPER(BTRIM(container_number))) FROM filtered WHERE COALESCE(is_oog, false) AND NULLIF(BTRIM(container_number), '') IS NOT NULL),
  'imoDistinctCount', (SELECT COUNT(DISTINCT UPPER(BTRIM(container_number))) FROM filtered WHERE COALESCE(is_imo, false) AND NULLIF(BTRIM(container_number), '') IS NOT NULL),
  'blCount', (SELECT COUNT(DISTINCT bl_key) FROM filtered),
  'typeSummary', (SELECT value FROM type_summary)
);
$$;

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
  FROM public.bls b
  LEFT JOIN public.customers c ON c.id = b.customer_id
  WHERE (p_voyage_id IS NULL OR b.voyage_id = p_voyage_id)
    AND (NULLIF(BTRIM(COALESCE(p_cargo_mode, '')), '') IS NULL OR b.cargo_mode = p_cargo_mode)
    AND (NULLIF(BTRIM(COALESCE(p_pol, '')), '') IS NULL OR b.pol ILIKE '%' || BTRIM(p_pol) || '%')
    AND (NULLIF(BTRIM(COALESCE(p_pod, '')), '') IS NULL OR b.pod ILIKE '%' || BTRIM(p_pod) || '%')
    AND (NULLIF(BTRIM(COALESCE(p_review_status, '')), '') IS NULL OR b.review_status = p_review_status)
    AND (NULLIF(BTRIM(COALESCE(p_financial_status, '')), '') IS NULL OR b.financial_status = p_financial_status)
    AND (NULLIF(BTRIM(COALESCE(p_charge_status, '')), '') IS NULL OR LOWER(BTRIM(COALESCE(b.charge_status, ''))) = LOWER(BTRIM(p_charge_status)))
    AND (NULLIF(BTRIM(COALESCE(p_search, '')), '') IS NULL OR b.id ILIKE '%' || BTRIM(p_search) || '%' OR b.consignee ILIKE '%' || BTRIM(p_search) || '%' OR c.name ILIKE '%' || BTRIM(p_search) || '%' OR c.cnpj_cpf ILIKE '%' || BTRIM(p_search) || '%')
    AND (
      NULLIF(BTRIM(COALESCE(p_cargo_profile, '')), '') IS NULL
      OR (p_cargo_profile = 'standard' AND NOT EXISTS (SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND (COALESCE(bc.is_imo, false) OR COALESCE(bc.is_oog, false))))
      OR (p_cargo_profile = 'imo' AND EXISTS (SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND COALESCE(bc.is_imo, false)))
      OR (p_cargo_profile = 'oog' AND EXISTS (SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND COALESCE(bc.is_oog, false)))
    )
)
SELECT jsonb_build_object(
  'totalBls', COUNT(*)::integer,
  'totalDistinctContainers', (SELECT COUNT(DISTINCT UPPER(BTRIM(bc.container_number))) FROM public.bl_containers bc JOIN filtered f ON f.id = bc.bl_id WHERE NULLIF(BTRIM(bc.container_number), '') IS NOT NULL),
  'pendingReview', COUNT(*) FILTER (WHERE review_status = 'pending_review')::integer,
  'pendingFinancial', COUNT(*) FILTER (WHERE financial_status = 'pending')::integer,
  'chargePending', COUNT(*) FILTER (WHERE charge_status IN ('review_required', 'not_calculated'))::integer,
  'chargeReady', COUNT(*) FILTER (WHERE charge_status = 'ready_for_billing')::integer,
  'chargeExempt', COUNT(*) FILTER (WHERE charge_status = 'exempt')::integer
)
FROM filtered;
$$;

REVOKE ALL ON FUNCTION public.operational_list_bls(integer, integer, text, bigint, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operational_list_bls(integer, integer, text, bigint, text, text, text, text, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.operational_list_containers(integer, integer, text, bigint, text, text, text, text, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operational_list_containers(integer, integer, text, bigint, text, text, text, text, text, text, text, text, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.operational_list_bl_summary(text, bigint, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operational_list_bl_summary(text, bigint, text, text, text, text, text, text, text) TO authenticated, service_role;
