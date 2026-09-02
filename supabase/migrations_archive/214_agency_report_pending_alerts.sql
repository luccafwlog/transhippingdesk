-- Agency Departure Report: alertas de pendências pós-ATD.
-- Intent: cada seção sem sign-off de uma escala brasileira já encerrada gera
-- um alerta para o departamento dono; ADR fechado não mantém pendências.
-- Baseline: somente ATDs registrados após esta implantação são considerados.
-- Rollback: DROP FUNCTION public.detect_agency_report_pending().

CREATE OR REPLACE FUNCTION public.detect_agency_report_pending()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_inserted INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;

  WITH latest_atd AS (
    SELECT DISTINCT ON (entity_id) entity_id, new_value, changed_at
    FROM public.audit_logs
    WHERE entity_type = 'voyage_pod_schedule' AND field_name = 'atd'
    ORDER BY entity_id, changed_at DESC
  ),
  departed AS (
    SELECT
      split_part(entity_id, '::', 1)::BIGINT AS voyage_id,
      upper(trim(split_part(entity_id, '::', 2))) AS port
    FROM latest_atd
    WHERE COALESCE(trim(new_value), '') <> ''
      -- Evita criar pendências retroativas na primeira detecção após o deploy.
      AND changed_at >= TIMESTAMPTZ '2026-07-19 00:00:00+00'
  ),
  sections AS (
    SELECT unnest(ARRAY[
      'datas', 'carga_descarregada', 'carga_carregada', 'veiculos',
      'vazios_embarcados', 'vazios_descarregados', 'ocorrencias'
    ]) AS section
  ),
  pending AS (
    SELECT d.voyage_id, d.port, s.section
    FROM departed d
    CROSS JOIN sections s
    LEFT JOIN public.agency_departure_reports r
      ON r.voyage_id = d.voyage_id AND r.port = d.port
    LEFT JOIN public.agency_departure_report_signoffs so
      ON so.report_id = r.id AND so.section = s.section
    WHERE COALESCE(r.status, 'open') = 'open'
      AND COALESCE(so.state, 'pending') = 'pending'
  ),
  inserted AS (
    INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
    SELECT
      'agency_report_section_pending',
      'agency_departure_report',
      p.voyage_id || '::' || p.port || '::' || p.section,
      'ADR ' || p.port || ': secao "' || p.section || '" pendente ('
        || public.agency_report_section_owner(p.section) || ').',
      'open'
    FROM pending p
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.alerts a
      WHERE a.type = 'agency_report_section_pending'
        AND a.entity_type = 'agency_departure_report'
        AND a.entity_id = p.voyage_id || '::' || p.port || '::' || p.section
        AND a.status <> 'closed'
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.detect_agency_report_pending() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_agency_report_pending() TO authenticated;

-- Fechamento e reabertura do Agency Departure Report. Esta migration ainda
-- nao foi publicada, portanto o contrato de alertas e fechamento permanece
-- atomicamente versionado aqui.
CREATE OR REPLACE FUNCTION public.agency_report_reject_closed_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_status TEXT;
BEGIN
  -- FOR SHARE serializa o sign-off/ocorrencia com o UPDATE de fechamento:
  -- quem entrou antes do fechamento termina primeiro; quem entra depois ve o
  -- relatorio fechado e nao consegue alterar o snapshot ja congelado.
  SELECT status INTO v_status
  FROM public.agency_departure_reports
  WHERE id = NEW.report_id
  FOR SHARE;

  IF v_status = 'closed' THEN
    RAISE EXCEPTION 'ADR fechado: reabra antes de alterar seus dados.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agency_report_signoffs_reject_closed_write ON public.agency_departure_report_signoffs;
CREATE TRIGGER agency_report_signoffs_reject_closed_write
  BEFORE INSERT OR UPDATE ON public.agency_departure_report_signoffs
  FOR EACH ROW EXECUTE FUNCTION public.agency_report_reject_closed_write();

DROP TRIGGER IF EXISTS agency_report_occurrences_reject_closed_write ON public.agency_departure_report_occurrences;
CREATE TRIGGER agency_report_occurrences_reject_closed_write
  BEFORE INSERT ON public.agency_departure_report_occurrences
  FOR EACH ROW EXECUTE FUNCTION public.agency_report_reject_closed_write();

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
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object'
     OR jsonb_typeof(p_snapshot->'sections') <> 'object' THEN
    RAISE EXCEPTION 'Snapshot obrigatorio (objeto com "sections") no fechamento.' USING ERRCODE = '22023';
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
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
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

REVOKE ALL ON FUNCTION public.agency_report_reject_closed_write() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_agency_departure_report(BIGINT, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_agency_departure_report(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_agency_departure_report(BIGINT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_agency_departure_report(BIGINT, TEXT, TEXT) TO authenticated;
