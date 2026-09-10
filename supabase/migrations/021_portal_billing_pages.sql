-- S12: paginated Portal billing projections.
-- The existing list RPCs remain available for exports and older consumers;
-- these contracts bound the response sent to the interactive billing tabs.

CREATE OR REPLACE FUNCTION public._portal_list_invoices_page_core(
  p_customer_id BIGINT,
  p_limit INTEGER DEFAULT 25,
  p_offset INTEGER DEFAULT 0,
  p_status TEXT DEFAULT NULL,
  p_vessel TEXT DEFAULT NULL,
  p_bl TEXT DEFAULT NULL,
  p_pod TEXT DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  RETURN (
    WITH all_rows AS MATERIALIZED (
      SELECT r.*
      FROM public._portal_list_invoices_core(p_customer_id) AS r
    ),
    filtered AS MATERIALIZED (
      SELECT r.*
      FROM all_rows AS r
      WHERE (
        NULLIF(BTRIM(p_status), '') IS NULL
        OR (p_status = 'issued' AND r.status IN ('issued', 'partially_paid', 'draft'))
        OR (p_status = 'paid' AND r.status IN ('paid', 'covered'))
        OR (p_status = 'cancelled' AND r.status IN ('cancelled', 'obsolete'))
      )
      AND (
        NULLIF(BTRIM(p_vessel), '') IS NULL
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(r.vessel_voyages, '{}'::TEXT[])) AS value
          WHERE POSITION(LOWER(BTRIM(p_vessel)) IN LOWER(value)) > 0
        )
      )
      AND (
        NULLIF(BTRIM(p_bl), '') IS NULL
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(r.bls, '{}'::TEXT[])) AS value
          WHERE POSITION(LOWER(BTRIM(p_bl)) IN LOWER(value)) > 0
        )
      )
      AND (NULLIF(BTRIM(p_pod), '') IS NULL OR BTRIM(p_pod) = ANY(COALESCE(r.pods, '{}'::TEXT[])))
      AND (p_date_from IS NULL OR r.issued_at::DATE >= p_date_from)
      AND (p_date_to IS NULL OR r.issued_at::DATE <= p_date_to)
    ),
    page_rows AS (
      SELECT f.*
      FROM filtered AS f
      ORDER BY f.issued_at DESC NULLS LAST, f.id DESC
      LIMIT v_limit OFFSET v_offset
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(to_jsonb(page_rows) ORDER BY page_rows.issued_at DESC NULLS LAST, page_rows.id DESC) FROM page_rows), '[]'::JSONB),
      'total_count', (SELECT COUNT(*) FROM filtered),
      'vessel_options', COALESCE((
        SELECT jsonb_agg(value ORDER BY value)
        FROM (
          SELECT DISTINCT value
          FROM all_rows AS r, unnest(COALESCE(r.vessel_voyages, '{}'::TEXT[])) AS value
          WHERE value IS NOT NULL AND value <> ''
        ) AS options
      ), '[]'::JSONB),
      'pods', COALESCE((
        SELECT jsonb_agg(value ORDER BY value)
        FROM (
          SELECT DISTINCT value
          FROM all_rows AS r, unnest(COALESCE(r.pods, '{}'::TEXT[])) AS value
          WHERE value IS NOT NULL AND value <> ''
        ) AS options
      ), '[]'::JSONB)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_list_invoices_page(
  p_limit INTEGER DEFAULT 25,
  p_offset INTEGER DEFAULT 0,
  p_status TEXT DEFAULT NULL,
  p_vessel TEXT DEFAULT NULL,
  p_bl TEXT DEFAULT NULL,
  p_pod TEXT DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public._portal_list_invoices_page_core(
    public.current_portal_customer_id(),
    p_limit, p_offset, p_status, p_vessel, p_bl, p_pod, p_date_from, p_date_to
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_inspect_list_invoices_page(
  p_customer_id BIGINT,
  p_limit INTEGER DEFAULT 25,
  p_offset INTEGER DEFAULT 0,
  p_status TEXT DEFAULT NULL,
  p_vessel TEXT DEFAULT NULL,
  p_bl TEXT DEFAULT NULL,
  p_pod TEXT DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public._portal_list_invoices_page_core(
    public._portal_inspect_guard(p_customer_id),
    p_limit, p_offset, p_status, p_vessel, p_bl, p_pod, p_date_from, p_date_to
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._portal_list_demurrage_invoices_page_core(
  p_customer_id BIGINT,
  p_limit INTEGER DEFAULT 25,
  p_offset INTEGER DEFAULT 0,
  p_status TEXT DEFAULT NULL,
  p_vessel TEXT DEFAULT NULL,
  p_bl TEXT DEFAULT NULL,
  p_pod TEXT DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  RETURN (
    WITH all_rows AS MATERIALIZED (
      SELECT value AS row
      FROM jsonb_array_elements(public._portal_list_demurrage_invoices_core(p_customer_id))
    ),
    filtered AS MATERIALIZED (
      SELECT r.row
      FROM all_rows AS r
      WHERE (
        NULLIF(BTRIM(p_status), '') IS NULL
        OR (p_status = 'issued' AND r.row->>'status' IN ('issued', 'partially_paid', 'draft'))
        OR (p_status = 'paid' AND r.row->>'status' IN ('paid', 'covered'))
        OR (p_status = 'cancelled' AND r.row->>'status' IN ('cancelled', 'obsolete'))
      )
      AND (
        NULLIF(BTRIM(p_vessel), '') IS NULL
        OR POSITION(LOWER(BTRIM(p_vessel)) IN LOWER(CONCAT_WS(' / ', r.row->>'vessel_name', r.row->>'voyage_number'))) > 0
      )
      AND (
        NULLIF(BTRIM(p_bl), '') IS NULL
        OR POSITION(LOWER(BTRIM(p_bl)) IN LOWER(COALESCE(r.row->>'bl_id', ''))) > 0
      )
      AND (NULLIF(BTRIM(p_pod), '') IS NULL OR BTRIM(p_pod) = r.row->>'pod')
      AND (p_date_from IS NULL OR (r.row->>'billed_at')::DATE >= p_date_from)
      AND (p_date_to IS NULL OR (r.row->>'billed_at')::DATE <= p_date_to)
    ),
    page_rows AS (
      SELECT f.row
      FROM filtered AS f
      ORDER BY (f.row->>'billed_at')::TIMESTAMPTZ DESC NULLS LAST, (f.row->>'id')::BIGINT DESC
      LIMIT v_limit OFFSET v_offset
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(page_rows.row ORDER BY (page_rows.row->>'billed_at')::TIMESTAMPTZ DESC NULLS LAST, (page_rows.row->>'id')::BIGINT DESC) FROM page_rows), '[]'::JSONB),
      'total_count', (SELECT COUNT(*) FROM filtered),
      'vessel_options', COALESCE((
        SELECT jsonb_agg(value ORDER BY value)
        FROM (
          SELECT DISTINCT CONCAT_WS(' / ', r.row->>'vessel_name', r.row->>'voyage_number') AS value
          FROM all_rows AS r
          WHERE COALESCE(r.row->>'vessel_name', '') <> ''
        ) AS options
      ), '[]'::JSONB),
      'pods', COALESCE((
        SELECT jsonb_agg(value ORDER BY value)
        FROM (
          SELECT DISTINCT r.row->>'pod' AS value
          FROM all_rows AS r
          WHERE COALESCE(r.row->>'pod', '') <> ''
        ) AS options
      ), '[]'::JSONB)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_list_demurrage_invoices_page(
  p_limit INTEGER DEFAULT 25,
  p_offset INTEGER DEFAULT 0,
  p_status TEXT DEFAULT NULL,
  p_vessel TEXT DEFAULT NULL,
  p_bl TEXT DEFAULT NULL,
  p_pod TEXT DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public._portal_list_demurrage_invoices_page_core(
    public.current_portal_customer_id(),
    p_limit, p_offset, p_status, p_vessel, p_bl, p_pod, p_date_from, p_date_to
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_inspect_list_demurrage_invoices_page(
  p_customer_id BIGINT,
  p_limit INTEGER DEFAULT 25,
  p_offset INTEGER DEFAULT 0,
  p_status TEXT DEFAULT NULL,
  p_vessel TEXT DEFAULT NULL,
  p_bl TEXT DEFAULT NULL,
  p_pod TEXT DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public._portal_list_demurrage_invoices_page_core(
    public._portal_inspect_guard(p_customer_id),
    p_limit, p_offset, p_status, p_vessel, p_bl, p_pod, p_date_from, p_date_to
  );
END;
$$;

REVOKE ALL ON FUNCTION public._portal_list_invoices_page_core(BIGINT, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, DATE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._portal_list_demurrage_invoices_page_core(BIGINT, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, DATE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_list_invoices_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, DATE, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.portal_inspect_list_invoices_page(BIGINT, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, DATE, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.portal_list_demurrage_invoices_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, DATE, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.portal_inspect_list_demurrage_invoices_page(BIGINT, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, DATE, DATE) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.portal_list_invoices_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_inspect_list_invoices_page(BIGINT, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_demurrage_invoices_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_inspect_list_demurrage_invoices_page(BIGINT, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, DATE, DATE) TO authenticated;
