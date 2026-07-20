-- Agency Departure Report: somente administradores podem reabrir o snapshot.
-- Intent: a UI sempre reservou esta acao a administradores; a RPC precisa
-- manter o mesmo limite contra chamadas diretas. O fechamento permanece
-- acessivel a qualquer usuario interno ativo, conforme o contrato do ADR.
-- Rollback: reaplicar a definicao de reopen_agency_departure_report da 214.

CREATE OR REPLACE FUNCTION public.reopen_agency_departure_report(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_justification TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(p_justification, '')) = '' THEN
    RAISE EXCEPTION 'Reabertura exige justificativa.' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_report_id
  FROM public.agency_departure_reports
  WHERE voyage_id = p_voyage_id AND port = upper(btrim(p_port)) AND status = 'closed'
  FOR UPDATE;
  IF v_report_id IS NULL THEN
    RAISE EXCEPTION 'ADR nao esta fechado.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.agency_departure_reports
  SET status = 'open', closed_at = NULL, closed_by = NULL, closed_snapshot = NULL
  WHERE id = v_report_id;
  UPDATE public.agency_departure_report_signoffs
  SET state = 'pending', signed_by = NULL, signed_at = NULL
  WHERE report_id = v_report_id;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report', p_voyage_id || '::' || upper(btrim(p_port)),
          'status', 'closed', 'open', auth.uid(), btrim(p_justification));

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.reopen_agency_departure_report(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_agency_departure_report(BIGINT, TEXT, TEXT) TO authenticated;

-- Revalidate the frozen payload at the database boundary.  The UI derives
-- these values, but the snapshot is a financial record and must not accept
-- arbitrary client-defined section names or an unbounded JSON document.
CREATE OR REPLACE FUNCTION public.close_agency_departure_report(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_snapshot JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report_id UUID;
  v_completed INTEGER;
  v_unknown_sections TEXT[];
  v_unknown_top_level TEXT[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object'
     OR jsonb_typeof(p_snapshot->'header') <> 'object'
     OR jsonb_typeof(p_snapshot->'sections') <> 'object'
     OR jsonb_typeof(p_snapshot->'occurrences') <> 'array'
     OR jsonb_typeof(p_snapshot->'signoffs') <> 'array'
     OR octet_length(p_snapshot::text) > 1048576 THEN
    RAISE EXCEPTION 'Snapshot invalido: esperado objeto com header, sections, occurrences e signoffs (maximo 1 MiB).' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(key ORDER BY key) INTO v_unknown_top_level
  FROM jsonb_object_keys(p_snapshot) AS key
  WHERE key NOT IN ('header', 'sections', 'occurrences', 'signoffs');
  IF v_unknown_top_level IS NOT NULL THEN
    RAISE EXCEPTION 'Snapshot possui chaves de topo desconhecidas: %.', array_to_string(v_unknown_top_level, ', ')
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(key ORDER BY key) INTO v_unknown_sections
  FROM jsonb_object_keys(p_snapshot->'sections') AS key
  WHERE key NOT IN (
    'cargaDescarregada', 'cargaSolta', 'vaziosDescarregados', 'veiculos',
    'vaziosEmbarcados', 'vehicleLocations', 'depots', 'directEmbarkCount',
    'granito', 'storage', 'operation', 'overtimeHandlingCount',
    'overtimeTransportCount'
  );
  IF v_unknown_sections IS NOT NULL THEN
    RAISE EXCEPTION 'Snapshot possui secoes desconhecidas: %.', array_to_string(v_unknown_sections, ', ')
      USING ERRCODE = '22023';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);
  SELECT id INTO v_report_id
  FROM public.agency_departure_reports
  WHERE id = v_report_id
  FOR UPDATE;

  SELECT COUNT(*) INTO v_completed
  FROM public.agency_departure_report_signoffs
  WHERE report_id = v_report_id AND state <> 'pending';
  IF v_completed <> 7 THEN
    RAISE EXCEPTION 'Fechamento exige todas as secoes confirmadas (% pendentes).', 7 - v_completed
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.agency_departure_reports
  SET status = 'closed', closed_at = now(), closed_by = auth.uid(), closed_snapshot = p_snapshot
  WHERE id = v_report_id AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADR ja fechado.' USING ERRCODE = '23505';
  END IF;

  UPDATE public.alerts
  SET status = 'closed', closed_at = now()
  WHERE type = 'agency_report_section_pending'
    AND entity_type = 'agency_departure_report'
    AND entity_id LIKE p_voyage_id || '::' || upper(btrim(p_port)) || '::%'
    AND status <> 'closed';

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.close_agency_departure_report(BIGINT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_agency_departure_report(BIGINT, TEXT, JSONB) TO authenticated;
