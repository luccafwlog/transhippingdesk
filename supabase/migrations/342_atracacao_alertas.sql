-- 342: alertas no grão da Escala e da Atracação.
--
-- A escala é dona de ETA/ATA. ETB/ATB/ETD/ATD/Restow pertencem à
-- voyage_escala_terminal_state; TBC participa apenas do predicado coletivo de
-- ausência e nunca recebe um alerta próprio.

CREATE OR REPLACE FUNCTION public.refresh_voyage_status_from_terminal_scales(p_voyage_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_active_scales INTEGER;
  v_pending_scales INTEGER;
BEGIN
  WITH entities AS (
    SELECT DISTINCT entity_id, upper(btrim(split_part(entity_id, '::', 2))) AS port
    FROM public.audit_logs
    WHERE entity_type = 'voyage_pod_schedule'
      AND split_part(entity_id, '::', 1)::bigint = p_voyage_id
  ), latest_flags AS (
    SELECT e.entity_id,
      COALESCE((SELECT a.new_value = 'true' FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'deleted' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), false) AS deleted,
      COALESCE((SELECT a.new_value = 'true' FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'omitted' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), false) AS omitted
    FROM entities e
  ), scale_state AS (
    SELECT f.entity_id,
      EXISTS (SELECT 1 FROM public.voyage_escala_terminal_state s WHERE s.voyage_id = p_voyage_id AND s.port = split_part(f.entity_id, '::', 2)) AS has_atracacao,
      EXISTS (SELECT 1 FROM public.voyage_escala_terminal_state s WHERE s.voyage_id = p_voyage_id AND s.port = split_part(f.entity_id, '::', 2) AND s.terminal_atd IS NULL) AS has_pending_atracacao
    FROM latest_flags f
    WHERE NOT f.deleted AND NOT f.omitted
  )
  SELECT COUNT(*)::integer, COUNT(*) FILTER (WHERE NOT has_atracacao OR has_pending_atracacao)::integer
  INTO v_active_scales, v_pending_scales
  FROM scale_state;

  IF v_active_scales > 0 THEN
    UPDATE public.voyages
    SET status = CASE WHEN v_pending_scales = 0 THEN 'completed' ELSE 'active' END
    WHERE id = p_voyage_id AND status <> 'cancelled';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_voyage_status_from_terminal_scales(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_voyage_status_from_terminal_scales(BIGINT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reconcile_voyage_schedule_date_alerts(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_source TEXT DEFAULT 'voyage_operation_detector'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_port_norm TEXT := upper(btrim(p_port));
  v_scale_entity_id TEXT := p_voyage_id || '::' || v_port_norm;
  v_term_rec RECORD;
  v_term_entity_id TEXT;
  v_is_deleted BOOLEAN := false;
  v_is_omitted BOOLEAN := false;
  v_eta DATE;
  v_ata DATE;
  v_has_terminal_etb BOOLEAN := false;
BEGIN
  WITH latest_state AS (
    SELECT DISTINCT ON (field_name) field_name, new_value
    FROM public.audit_logs
    WHERE entity_type = 'voyage_pod_schedule'
      AND entity_id = v_scale_entity_id
      AND field_name IN ('deleted', 'omitted', 'eta', 'ata')
    ORDER BY field_name, changed_at DESC, id DESC
  )
  SELECT
    COALESCE(bool_or(field_name = 'deleted' AND new_value = 'true'), false),
    COALESCE(bool_or(field_name = 'omitted' AND new_value = 'true'), false),
    MAX(CASE WHEN field_name = 'eta' THEN NULLIF(btrim(new_value), '')::date END),
    MAX(CASE WHEN field_name = 'ata' THEN NULLIF(btrim(new_value), '')::date END)
  INTO v_is_deleted, v_is_omitted, v_eta, v_ata
  FROM latest_state;

  IF v_is_deleted OR v_is_omitted THEN
    PERFORM public.resolve_alert_item('voyage_schedule_date_pending', 'voyage_pod_schedule', v_scale_entity_id, p_source, jsonb_build_object('reason', 'scale_deleted_or_omitted'));
    FOR v_term_rec IN
      SELECT terminal_id FROM public.voyage_escala_terminal_state
      WHERE voyage_id = p_voyage_id AND port = v_port_norm
    LOOP
      IF v_term_rec.terminal_id IS NULL THEN CONTINUE; END IF;
      v_term_entity_id := p_voyage_id || '::' || v_port_norm || '::' || upper(btrim(v_term_rec.terminal_id::text));
      PERFORM public.resolve_alert_item('voyage_terminal_date_pending', 'voyage_escala_terminal', v_term_entity_id, p_source, '{}'::jsonb);
      PERFORM public.resolve_alert_item('voyage_export_after_atd', 'voyage_escala_terminal', v_term_entity_id, p_source, '{}'::jsonb);
    END LOOP;
    RETURN;
  END IF;

  SELECT COALESCE(bool_or(terminal_etb IS NOT NULL), false)
  INTO v_has_terminal_etb
  FROM public.voyage_escala_terminal_state
  WHERE voyage_id = p_voyage_id AND port = v_port_norm;

  -- Predicado da escala: depois da chegada, cobrar somente a existência de
  -- uma Atracação com previsão de ETB. TBC conta para este conjunto.
  IF v_eta IS NOT NULL AND v_eta <= v_today AND v_ata IS NULL THEN
    PERFORM public.upsert_alert_item(
      'voyage_schedule_date_pending', 'voyage_pod_schedule', v_scale_entity_id,
      'ATA pendente para escala ' || v_port_norm || ' (ETA ' || to_char(v_eta, 'DD/MM/YYYY') || ' atingido)',
      p_source, jsonb_build_object('voyage_id', p_voyage_id, 'port', v_port_norm, 'milestone', 'ata', 'eta', v_eta),
      '/viagens/' || p_voyage_id || '?escala=' || v_port_norm
    );
  ELSIF v_ata IS NOT NULL AND NOT v_has_terminal_etb THEN
    PERFORM public.upsert_alert_item(
      'voyage_schedule_date_pending', 'voyage_pod_schedule', v_scale_entity_id,
      'ETB pendente para escala ' || v_port_norm || ' (ATA informada)',
      p_source, jsonb_build_object('voyage_id', p_voyage_id, 'port', v_port_norm, 'milestone', 'etb'),
      '/viagens/' || p_voyage_id || '?escala=' || v_port_norm
    );
  ELSE
    PERFORM public.resolve_alert_item('voyage_schedule_date_pending', 'voyage_pod_schedule', v_scale_entity_id, p_source, '{}'::jsonb);
  END IF;

  -- Predicado da Atracação: cada terminal recebe apenas a sua própria cadeia.
  FOR v_term_rec IN
    SELECT terminal_id, terminal_code, terminal_etb::date AS terminal_etb,
      terminal_atb::date AS terminal_atb, terminal_etd::date AS terminal_etd,
      terminal_atd::date AS terminal_atd
    FROM public.voyage_escala_terminal_state s
    LEFT JOIN public.depots d ON d.id = s.terminal_id
    WHERE s.voyage_id = p_voyage_id AND s.port = v_port_norm AND s.terminal_id IS NOT NULL
  LOOP
    v_term_entity_id := p_voyage_id || '::' || v_port_norm || '::' || upper(btrim(v_term_rec.terminal_id::text));
    IF v_term_rec.terminal_etb IS NOT NULL AND v_term_rec.terminal_etb <= v_today AND v_term_rec.terminal_atb IS NULL THEN
      PERFORM public.upsert_alert_item(
        'voyage_terminal_date_pending', 'voyage_escala_terminal', v_term_entity_id,
        'ATB pendente no terminal para a escala ' || v_port_norm || ' (ETB ' || to_char(v_term_rec.terminal_etb, 'DD/MM/YYYY') || ' atingido)',
        p_source, jsonb_build_object('voyage_id', p_voyage_id, 'port', v_port_norm, 'terminal', v_term_rec.terminal_id, 'milestone', 'atb', 'etb', v_term_rec.terminal_etb),
        '/viagens/' || p_voyage_id || '?escala=' || v_port_norm || '&terminal=' || v_term_rec.terminal_id
      );
    ELSIF v_term_rec.terminal_atb IS NOT NULL AND v_term_rec.terminal_etd IS NULL THEN
      PERFORM public.upsert_alert_item(
        'voyage_terminal_date_pending', 'voyage_escala_terminal', v_term_entity_id,
        'ETD pendente no terminal para a escala ' || v_port_norm || ' (ATB informada)',
        p_source, jsonb_build_object('voyage_id', p_voyage_id, 'port', v_port_norm, 'terminal', v_term_rec.terminal_id, 'milestone', 'etd'),
        '/viagens/' || p_voyage_id || '?escala=' || v_port_norm || '&terminal=' || v_term_rec.terminal_id
      );
    ELSIF v_term_rec.terminal_etd IS NOT NULL AND v_term_rec.terminal_etd <= v_today AND v_term_rec.terminal_atd IS NULL THEN
      PERFORM public.upsert_alert_item(
        'voyage_terminal_date_pending', 'voyage_escala_terminal', v_term_entity_id,
        'ATD pendente no terminal para a escala ' || v_port_norm || ' (ETD ' || to_char(v_term_rec.terminal_etd, 'DD/MM/YYYY') || ' atingido)',
        p_source, jsonb_build_object('voyage_id', p_voyage_id, 'port', v_port_norm, 'terminal', v_term_rec.terminal_id, 'milestone', 'atd', 'etd', v_term_rec.terminal_etd),
        '/viagens/' || p_voyage_id || '?escala=' || v_port_norm || '&terminal=' || v_term_rec.terminal_id
      );
    ELSE
      PERFORM public.resolve_alert_item('voyage_terminal_date_pending', 'voyage_escala_terminal', v_term_entity_id, p_source, '{}'::jsonb);
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_voyage_schedule_date_alerts(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_schedule_date_alerts(BIGINT, TEXT, TEXT) TO authenticated, service_role;

-- Itens abertos no grão antigo não têm mais uma Atracação correspondente.
-- Fechamento explícito preserva o evento e o motivo na trilha da fundação.
DO $migration$
DECLARE
  v_item RECORD;
BEGIN
  FOR v_item IN
    SELECT i.id, i.alert_id, i.occurrence_id, a.entity_type, a.entity_id, i.item_type
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.status = 'active'
      AND i.item_type IN ('voyage_schedule_date_pending', 'voyage_terminal_date_pending')
      AND a.entity_type = 'voyage_pod_schedule'
  LOOP
    UPDATE public.alert_items
    SET status = 'resolved', updated_at = now(), resolved_at = now(),
        metadata = metadata || jsonb_build_object('migration', '342_atracacao_alertas', 'reason', 'legacy_scale_berth_milestone_retired')
    WHERE id = v_item.id;
    INSERT INTO public.alert_item_events (alert_item_id, occurrence_id, event_type, previous_status, new_status, metadata)
    VALUES (v_item.id, v_item.occurrence_id, 'resolved', 'active', 'resolved', jsonb_build_object('migration', '342_atracacao_alertas', 'reason', 'legacy_scale_berth_milestone_retired'));
    PERFORM public.refresh_alert_aggregate(v_item.alert_id);
  END LOOP;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.reconcile_agency_report_alerts(
  p_report_id UUID,
  p_pending BOOLEAN DEFAULT TRUE,
  p_deadline BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report RECORD;
  v_atd DATE;
  v_atd_updated_at TIMESTAMPTZ;
  v_deadline DATE;
  v_deadline_baseline DATE;
  v_pending_baseline TIMESTAMPTZ := TIMESTAMPTZ '2026-07-19 00:00:00+00';
  v_pending_eligible BOOLEAN := false;
  v_deadline_eligible BOOLEAN := false;
  v_omitted BOOLEAN := false;
  v_deleted BOOLEAN := false;
  v_entity_id TEXT;
  v_department TEXT;
  v_pending BOOLEAN;
  v_signed BOOLEAN;
  v_deadline_missed BOOLEAN;
  v_metadata JSONB;
  v_message TEXT;
  v_upsert_result JSONB;
  v_changed INTEGER := 0;
  v_created INTEGER := 0;
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;

  SELECT r.*, d.code AS terminal_code INTO v_report
  FROM public.agency_departure_reports r
  LEFT JOIN public.depots d ON d.id = r.terminal_id
  WHERE r.id = p_report_id FOR UPDATE OF r;
  IF NOT FOUND THEN RETURN jsonb_build_object('report_id', p_report_id, 'eligible', false, 'changed', 0); END IF;

  SELECT terminal_atd::date, updated_at INTO v_atd, v_atd_updated_at
  FROM public.voyage_escala_terminal_state
  WHERE voyage_id = v_report.voyage_id AND port = upper(btrim(v_report.port)) AND terminal_id = v_report.terminal_id;

  SELECT COALESCE((SELECT a.new_value = 'true' FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = v_report.voyage_id || '::' || upper(btrim(v_report.port)) AND a.field_name = 'omitted' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), false) INTO v_omitted;
  SELECT COALESCE((SELECT a.new_value = 'true' FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = v_report.voyage_id || '::' || upper(btrim(v_report.port)) AND a.field_name = 'deleted' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), false) INTO v_deleted;
  SELECT captured_at::date INTO v_deadline_baseline FROM public.agency_report_pending_baselines WHERE baseline_key = 'agency_report_deadline_missed';

  v_pending_eligible := v_report.status = 'open' AND v_report.terminal_id IS NOT NULL AND v_atd IS NOT NULL AND v_atd_updated_at >= v_pending_baseline AND NOT v_omitted AND NOT v_deleted AND upper(btrim(v_report.port)) LIKE 'BR%';
  v_deadline_eligible := v_report.status = 'open' AND v_report.terminal_id IS NOT NULL AND v_atd IS NOT NULL AND NOT v_omitted AND NOT v_deleted AND upper(btrim(v_report.port)) LIKE 'BR%' AND (v_deadline_baseline IS NULL OR v_atd >= v_deadline_baseline);
  v_entity_id := public.agency_report_alert_entity_key(v_report.voyage_id, v_report.port, v_report.terminal_code);
  v_deadline := CASE WHEN v_atd IS NULL THEN NULL ELSE public.agency_report_deadline_date(v_atd) END;

  FOR v_department IN SELECT unnest(ARRAY['operacoes', 'documentacao', 'equipamentos']) LOOP
    v_metadata := jsonb_build_object('report_id', v_report.id, 'voyage_id', v_report.voyage_id, 'port', upper(btrim(v_report.port)), 'terminal_code', v_report.terminal_code, 'department', v_department, 'deadline_date', v_deadline);
    IF p_pending THEN
      SELECT EXISTS (
        SELECT 1 FROM (VALUES ('datas'), ('carga_descarregada'), ('carga_carregada'), ('veiculos'), ('vazios_embarcados'), ('vazios_descarregados')) AS sections(section)
        LEFT JOIN public.agency_departure_report_signoffs so ON so.report_id = v_report.id AND so.section = sections.section
        WHERE public.agency_report_section_owner(sections.section) = v_department AND COALESCE(so.state, 'pending') = 'pending'
      ) INTO v_pending;
      v_message := 'ADR ' || upper(btrim(v_report.port)) || ' / ' || COALESCE(v_report.terminal_code, 'terminal') || ': departamento "' || public.agency_report_department_label(v_department) || '" pendente.';
      IF v_pending_eligible AND v_pending THEN
        v_upsert_result := public.upsert_alert_item('agency_report_department_pending', 'agency_departure_report', v_entity_id, v_message, 'agency_report_reconcile', v_department, v_metadata, '/viagens');
        IF COALESCE((v_upsert_result->>'created')::boolean, false) OR COALESCE((v_upsert_result->>'reopened')::boolean, false) THEN v_changed := v_changed + 1; v_created := v_created + 1; END IF;
      ELSE
        IF public.resolve_alert_item_for_department('agency_report_department_pending', 'agency_departure_report', v_entity_id, v_department, 'agency_report_reconcile', v_metadata) THEN v_changed := v_changed + 1; END IF;
      END IF;
    END IF;
    IF p_deadline THEN
      SELECT COALESCE((SELECT signed_at IS NOT NULL FROM public.agency_departure_report_department_signoffs ds WHERE ds.report_id = v_report.id AND ds.department = v_department), false) INTO v_signed;
      v_deadline_missed := v_deadline_eligible AND v_deadline < CURRENT_DATE AND NOT v_signed;
      v_message := 'ADR ' || upper(btrim(v_report.port)) || ' / ' || COALESCE(v_report.terminal_code, 'terminal') || ': prazo de conclusão vencido para "' || public.agency_report_department_label(v_department) || '".';
      IF v_deadline_missed THEN
        v_upsert_result := public.upsert_alert_item('agency_report_deadline_missed', 'agency_departure_report', v_entity_id, v_message, 'agency_report_reconcile', v_department, v_metadata, '/viagens');
        IF COALESCE((v_upsert_result->>'created')::boolean, false) OR COALESCE((v_upsert_result->>'reopened')::boolean, false) THEN v_changed := v_changed + 1; v_created := v_created + 1; END IF;
      ELSE
        IF public.resolve_alert_item_for_department('agency_report_deadline_missed', 'agency_departure_report', v_entity_id, v_department, 'agency_report_reconcile', v_metadata) THEN v_changed := v_changed + 1; END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('report_id', v_report.id, 'entity_id', v_entity_id, 'eligible', v_deadline_eligible, 'pending_eligible', v_pending_eligible, 'atd', v_atd, 'deadline_date', v_deadline, 'changed', v_changed, 'created', v_created);
END;
$function$;

CREATE OR REPLACE FUNCTION public.detect_agency_report_pending()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_report RECORD; v_result JSONB; v_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501'; END IF;
  FOR v_report IN SELECT id FROM public.agency_departure_reports WHERE status = 'open' LOOP
    v_result := public.reconcile_agency_report_alerts(v_report.id, TRUE, FALSE);
    v_count := v_count + COALESCE((v_result->>'created')::integer, 0);
  END LOOP;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.detect_agency_report_deadline_missed()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_report RECORD; v_result JSONB; v_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501'; END IF;
  FOR v_report IN SELECT id FROM public.agency_departure_reports WHERE status = 'open' LOOP
    v_result := public.reconcile_agency_report_alerts(v_report.id, FALSE, TRUE);
    v_count := v_count + COALESCE((v_result->>'created')::integer, 0);
  END LOOP;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.detect_agency_report_pending() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.detect_agency_report_deadline_missed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_agency_report_pending() TO authenticated;
GRANT EXECUTE ON FUNCTION public.detect_agency_report_deadline_missed() TO authenticated;
