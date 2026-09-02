-- Close privileged alert helpers to direct client execution.
-- The ETA helper remains available to active internal users because the SPA
-- has a legitimate internal consumer.

CREATE OR REPLACE FUNCTION public.get_voyage_first_brazilian_eta(p_voyage_id BIGINT)
RETURNS DATE
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_has_eligible_pod BOOLEAN;
  v_min_own_eta DATE;
  v_indicated_eta DATE;
  v_indicated_port TEXT;
BEGIN
  IF NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.get_voyage_eligible_pods(p_voyage_id))
    INTO v_has_eligible_pod;
  IF NOT v_has_eligible_pod THEN
    RETURN NULL;
  END IF;

  WITH latest_eta AS (
    SELECT DISTINCT ON (entity_id)
      upper(btrim(split_part(entity_id, '::', 2))) AS port_code,
      NULLIF(btrim(new_value), '')::date AS eta
    FROM public.audit_logs
    WHERE entity_type = 'voyage_pod_schedule'
      AND entity_id LIKE p_voyage_id || '::%'
      AND field_name = 'eta'
    ORDER BY entity_id, changed_at DESC
  )
  SELECT MIN(eta) INTO v_min_own_eta
  FROM latest_eta
  WHERE port_code IN (SELECT pod FROM public.get_voyage_eligible_pods(p_voyage_id));

  SELECT
    (SELECT NULLIF(btrim(new_value), '')::date FROM public.audit_logs
     WHERE entity_type = 'voyages' AND entity_id = p_voyage_id::text
       AND field_name = 'indicated_first_brazilian_eta'
     ORDER BY changed_at DESC LIMIT 1),
    (SELECT NULLIF(btrim(new_value), '') FROM public.audit_logs
     WHERE entity_type = 'voyages' AND entity_id = p_voyage_id::text
       AND field_name = 'indicated_first_brazilian_port'
     ORDER BY changed_at DESC LIMIT 1)
  INTO v_indicated_eta, v_indicated_port;

  IF v_indicated_eta IS NOT NULL AND v_indicated_port IS NOT NULL
     AND (v_min_own_eta IS NULL OR v_indicated_eta < v_min_own_eta) THEN
    RETURN v_indicated_eta;
  END IF;

  RETURN v_min_own_eta;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.portal_billing_gate(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_voyage_eligible_pods(BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_voyage_status_from_terminal_scales(BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_voyage_first_brazilian_eta(BIGINT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.portal_billing_gate(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_voyage_eligible_pods(BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_voyage_first_brazilian_eta(BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_voyage_status_from_terminal_scales(BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_voyage_first_brazilian_eta(BIGINT) TO authenticated;
