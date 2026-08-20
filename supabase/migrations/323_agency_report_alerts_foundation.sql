-- 323: migra os produtores do ADR para a fundação transversal de Alertas.
--
-- Intenção: um ADR terminalizado tem um único agregado em
-- (agency_departure_report, viagem::porto::terminal); ADR legado conserva
-- viagem::porto. Os dois itens continuam independentes:
-- agency_report_department_pending (normal) e
-- agency_report_deadline_missed (critical).
--
-- A migração não edita 225/251/253/258/271/272/273/306. Os detectores antigos
-- continuam existindo como contratos públicos, mas passam a reconciliar o
-- agregado central. O cron da 319 permanece a rede de segurança; triggers de
-- audit_logs e de sign-off fazem a reconciliação imediata.
--
-- Rollback: remover os triggers abaixo e reaplicar as definições de
-- detect_agency_report_pending/detect_agency_report_deadline_missed da 306;
-- os itens/ocorrências novos devem ser preservados para auditoria.

CREATE OR REPLACE FUNCTION public.agency_report_alert_entity_key(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_terminal_code TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p_voyage_id::TEXT || '::' || upper(btrim(p_port)) ||
    CASE
      WHEN NULLIF(btrim(COALESCE(p_terminal_code, '')), '') IS NULL THEN ''
      ELSE '::' || btrim(p_terminal_code)
    END;
$function$;

REVOKE ALL ON FUNCTION public.agency_report_alert_entity_key(BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agency_report_alert_entity_key(BIGINT, TEXT, TEXT) TO service_role;

-- O contrato do ADR tem um item por departamento dentro do mesmo agregado.
-- A unicidade da fundação (alert_id, item_type) era suficiente para os
-- primeiros produtores, mas colapsaria três pendências departamentais em uma.
ALTER TABLE public.alert_items
  DROP CONSTRAINT IF EXISTS alert_items_alert_id_item_type_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_items_type_department
  ON public.alert_items (alert_id, item_type, department);

-- A audiência do ADR é o departamento do item, não o departamento padrão do
-- catálogo. A sobrecarga mantém intacta a RPC de sete argumentos usada pelos
-- produtores já migrados e permite ao Bloco 5 informar o dono real.
DROP FUNCTION IF EXISTS public.fanout_alert_item_for_department(BIGINT, BIGINT, BIGINT, TEXT);
CREATE FUNCTION public.fanout_alert_item_for_department(
  p_alert_id BIGINT,
  p_item_id BIGINT,
  p_event_id BIGINT,
  p_department TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_item public.alert_items%ROWTYPE;
  v_alert public.alerts%ROWTYPE;
  v_catalog public.alert_type_catalog%ROWTYPE;
  v_user RECORD;
  v_count INTEGER := 0;
  v_fallback BOOLEAN := false;
BEGIN
  SELECT * INTO v_item FROM public.alert_items WHERE id = p_item_id;
  SELECT * INTO v_alert FROM public.alerts WHERE id = p_alert_id;
  SELECT * INTO v_catalog FROM public.alert_type_catalog WHERE type = v_item.item_type;

  FOR v_user IN
    SELECT up.id, up.role
    FROM public.user_profiles up
    WHERE up.active = true AND up.role = p_department
  LOOP
    INSERT INTO public.internal_notifications (
      alert_id, alert_item_id, event_id, recipient_id, recipient_department,
      is_fallback, item_type, severity, title, message, entity_type, entity_id,
      destination, payload
    )
    VALUES (
      p_alert_id, p_item_id, p_event_id, v_user.id, p_department,
      false, v_item.item_type, v_item.severity, 'Nova pendência operacional',
      v_item.message, v_alert.entity_type, v_alert.entity_id, v_item.destination,
      v_item.metadata
    )
    ON CONFLICT (event_id, recipient_id) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 AND v_item.severity = 'critical' THEN
    v_fallback := true;
    FOR v_user IN
      SELECT up.id, up.role
      FROM public.user_profiles up
      WHERE up.active = true AND up.role IN ('administrativo', 'admin')
    LOOP
      INSERT INTO public.internal_notifications (
        alert_id, alert_item_id, event_id, recipient_id, recipient_department,
        is_fallback, item_type, severity, title, message, entity_type, entity_id,
        destination, payload
      )
      VALUES (
        p_alert_id, p_item_id, p_event_id, v_user.id, v_user.role,
        true, v_item.item_type, v_item.severity, 'Nova pendência operacional',
        v_item.message, v_alert.entity_type, v_alert.entity_id, v_item.destination,
        jsonb_build_object('fallback_for', p_department) || v_item.metadata
      )
      ON CONFLICT (event_id, recipient_id) DO NOTHING;
      v_count := v_count + 1;
    END LOOP;
  END IF;

  IF v_count = 0 THEN
    INSERT INTO public.alert_notification_failures (
      alert_id, alert_item_id, event_id, item_type, department, reason
    )
    VALUES (
      p_alert_id, p_item_id, p_event_id, v_item.item_type, p_department,
      CASE WHEN v_fallback THEN 'Nenhum destinatário ativo no fallback Administrativo.'
           ELSE 'Nenhum destinatário ativo na audiência do item.' END
    );
  END IF;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.fanout_alert_item_for_department(BIGINT, BIGINT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fanout_alert_item_for_department(BIGINT, BIGINT, BIGINT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_alert_item_for_department(
  p_type TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_department TEXT,
  p_source TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_item public.alert_items%ROWTYPE;
  v_alert_id BIGINT;
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  SELECT i.* INTO v_item
  FROM public.alert_items i
  JOIN public.alerts a ON a.id = i.alert_id
  WHERE i.item_type = p_type
    AND i.department = p_department
    AND a.entity_type = p_entity_type
    AND a.entity_id = p_entity_id
    AND i.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  v_alert_id := v_item.alert_id;
  UPDATE public.alert_items
  SET status = 'resolved', updated_at = now(), resolved_at = now()
  WHERE id = v_item.id;
  INSERT INTO public.alert_item_events (
    alert_item_id, occurrence_id, event_type, previous_status, new_status,
    actor_id, metadata
  )
  VALUES (
    v_item.id, v_item.occurrence_id, 'resolved', 'active', 'resolved',
    auth.uid(), COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('source', p_source)
  );
  PERFORM public.refresh_alert_aggregate(v_alert_id);
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_alert_item_for_department(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_alert_item_for_department(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

DROP FUNCTION IF EXISTS public.upsert_alert_item(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT);
CREATE FUNCTION public.upsert_alert_item(
  p_type TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_message TEXT,
  p_source TEXT,
  p_department TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_destination TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_catalog public.alert_type_catalog%ROWTYPE;
  v_alert public.alerts%ROWTYPE;
  v_item public.alert_items%ROWTYPE;
  v_event_id BIGINT;
  v_reopened BOOLEAN := false;
  v_new_item BOOLEAN := false;
  v_department TEXT := NULLIF(btrim(p_department), '');
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_type), '') IS NULL OR NULLIF(btrim(p_entity_type), '') IS NULL
     OR NULLIF(btrim(p_entity_id), '') IS NULL OR NULLIF(btrim(p_message), '') IS NULL
     OR NULLIF(btrim(p_source), '') IS NULL OR v_department IS NULL THEN
    RAISE EXCEPTION 'Tipo, entidade, mensagem, origem e departamento são obrigatórios.' USING ERRCODE = '22023';
  END IF;
  IF v_department NOT IN ('operacoes', 'documentacao', 'equipamentos') THEN
    RAISE EXCEPTION 'Departamento inválido.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_catalog
  FROM public.alert_type_catalog
  WHERE type = p_type AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tipo de alerta fora do catálogo: %', p_type USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('alerts.foundation_internal', 'on', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('alert:' || p_entity_type || ':' || p_entity_id, 0));

  SELECT * INTO v_alert
  FROM public.alerts a
  WHERE a.type = 'aggregate'
    AND a.entity_type = p_entity_type
    AND a.entity_id = p_entity_id
  ORDER BY a.id DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.alerts(type, entity_type, entity_id, message, status)
    VALUES ('aggregate', p_entity_type, p_entity_id, p_message, 'open')
    RETURNING * INTO v_alert;
  ELSE
    UPDATE public.alerts
    SET status = 'open', closed_at = NULL
    WHERE id = v_alert.id;
    v_alert.status := 'open';
  END IF;

  SELECT * INTO v_item
  FROM public.alert_items
  WHERE alert_id = v_alert.id AND item_type = p_type AND department = v_department
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.alert_items (
      alert_id, item_type, source, severity, department, destination,
      message, metadata, status
    )
    VALUES (
      v_alert.id, p_type, p_source, v_catalog.severity, v_department,
      COALESCE(p_destination, v_catalog.default_destination), p_message,
      COALESCE(p_metadata, '{}'::jsonb), 'active'
    )
    RETURNING * INTO v_item;
    v_new_item := true;
  ELSE
    v_reopened := v_item.status = 'resolved';
    UPDATE public.alert_items
    SET source = p_source,
        severity = v_catalog.severity,
        department = v_department,
        destination = COALESCE(p_destination, v_catalog.default_destination),
        message = p_message,
        metadata = COALESCE(p_metadata, '{}'::jsonb),
        status = 'active',
        updated_at = now(),
        resolved_at = NULL,
        occurrence_id = CASE WHEN v_reopened THEN gen_random_uuid() ELSE occurrence_id END
    WHERE id = v_item.id
    RETURNING * INTO v_item;
  END IF;

  IF v_new_item OR v_reopened THEN
    INSERT INTO public.alert_item_events (
      alert_item_id, occurrence_id, event_type, previous_status, new_status,
      actor_id, metadata
    )
    VALUES (
      v_item.id, v_item.occurrence_id, 'opened',
      CASE WHEN v_new_item THEN NULL ELSE 'resolved' END,
      'active', auth.uid(), COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING id INTO v_event_id;
    IF p_source <> 'foundation_backfill' THEN
      PERFORM public.fanout_alert_item_for_department(v_alert.id, v_item.id, v_event_id, v_department);
    END IF;
  ELSE
    INSERT INTO public.alert_item_events (
      alert_item_id, occurrence_id, event_type, previous_status, new_status,
      actor_id, metadata
    )
    VALUES (v_item.id, v_item.occurrence_id, 'updated', 'active', 'active',
            auth.uid(), COALESCE(p_metadata, '{}'::jsonb));
  END IF;

  PERFORM public.refresh_alert_aggregate(v_alert.id);
  PERFORM set_config('alerts.foundation_internal', 'off', true);
  RETURN jsonb_build_object(
    'alert_id', v_alert.id, 'item_id', v_item.id, 'event_id', v_event_id,
    'reopened', v_reopened
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_alert_item(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_alert_item(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO service_role;

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
  v_deadline DATE;
  v_baseline DATE;
  v_eligible BOOLEAN := false;
  v_omitted BOOLEAN := false;
  v_deleted BOOLEAN := false;
  v_terminal_code TEXT;
  v_entity_id TEXT;
  v_department TEXT;
  v_pending BOOLEAN;
  v_signed BOOLEAN;
  v_deadline_missed BOOLEAN;
  v_metadata JSONB;
  v_message TEXT;
  v_changed INTEGER := 0;
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  SELECT r.*, d.code AS terminal_code
  INTO v_report
  FROM public.agency_departure_reports r
  LEFT JOIN public.depots d ON d.id = r.terminal_id
  WHERE r.id = p_report_id
  FOR UPDATE OF r;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('report_id', p_report_id, 'eligible', false, 'changed', 0);
  END IF;

  IF v_report.terminal_id IS NOT NULL THEN
    SELECT s.terminal_atd::DATE INTO v_atd
    FROM public.voyage_escala_terminal_state s
    WHERE s.voyage_id = v_report.voyage_id
      AND s.port = upper(btrim(v_report.port))
      AND s.terminal_id = v_report.terminal_id;
  ELSE
    SELECT COALESCE(
      (SELECT NULLIF(btrim(a.new_value), '')::DATE
       FROM public.audit_logs a
       WHERE a.entity_type = 'voyage_pod_schedule'
         AND a.entity_id = v_report.voyage_id || '::' || upper(btrim(v_report.port))
         AND a.field_name = 'atd'
       ORDER BY a.changed_at DESC LIMIT 1),
      (SELECT NULLIF(btrim(a.new_value), '')::DATE
       FROM public.audit_logs a
       WHERE a.entity_type = 'voyage_pol_schedule'
         AND a.entity_id = v_report.voyage_id || '::' || upper(btrim(v_report.port))
         AND a.field_name = 'atd'
       ORDER BY a.changed_at DESC LIMIT 1)
    ) INTO v_atd;
  END IF;

  SELECT COALESCE((
    SELECT a.new_value = 'true'
    FROM public.audit_logs a
    WHERE a.entity_type = 'voyage_pod_schedule'
      AND a.entity_id = v_report.voyage_id || '::' || upper(btrim(v_report.port))
      AND a.field_name = 'omitted'
    ORDER BY a.changed_at DESC LIMIT 1
  ), false) INTO v_omitted;
  SELECT COALESCE((
    SELECT a.new_value = 'true'
    FROM public.audit_logs a
    WHERE a.entity_type = 'voyage_pod_schedule'
      AND a.entity_id = v_report.voyage_id || '::' || upper(btrim(v_report.port))
      AND a.field_name = 'deleted'
    ORDER BY a.changed_at DESC LIMIT 1
  ), false) INTO v_deleted;
  SELECT captured_at::DATE INTO v_baseline
  FROM public.agency_report_pending_baselines
  WHERE baseline_key = 'agency_report_deadline_missed';

  v_eligible := v_report.status = 'open'
    AND v_atd IS NOT NULL
    AND NOT v_omitted
    AND NOT v_deleted
    AND (v_baseline IS NULL OR v_atd >= v_baseline);

  -- A legacy ADR is no longer an eligible producer once a terminalized ADR
  -- exists for the same scale. The historical carrier remains auditable.
  IF v_report.terminal_id IS NULL AND EXISTS (
    SELECT 1 FROM public.agency_departure_reports newer
    WHERE newer.voyage_id = v_report.voyage_id
      AND newer.port = v_report.port
      AND newer.terminal_id IS NOT NULL
  ) THEN
    v_eligible := false;
  END IF;

  v_entity_id := public.agency_report_alert_entity_key(
    v_report.voyage_id, v_report.port, v_report.terminal_code
  );
  v_deadline := CASE WHEN v_atd IS NULL THEN NULL ELSE public.agency_report_deadline_date(v_atd) END;

  FOR v_department IN SELECT unnest(ARRAY['operacoes', 'documentacao', 'equipamentos'])
  LOOP
    v_metadata := jsonb_build_object(
      'report_id', v_report.id,
      'voyage_id', v_report.voyage_id,
      'port', upper(btrim(v_report.port)),
      'terminal_code', v_report.terminal_code,
      'department', v_department,
      'deadline_date', v_deadline
    );

    IF p_pending THEN
      SELECT EXISTS (
        SELECT 1
        FROM (VALUES
          ('datas'), ('carga_descarregada'), ('carga_carregada'),
          ('veiculos'), ('vazios_embarcados'), ('vazios_descarregados')
        ) AS sections(section)
        LEFT JOIN public.agency_departure_report_signoffs so
          ON so.report_id = v_report.id AND so.section = sections.section
        WHERE public.agency_report_section_owner(sections.section) = v_department
          AND COALESCE(so.state, 'pending') = 'pending'
      ) INTO v_pending;
      v_message := 'ADR ' || upper(btrim(v_report.port))
        || CASE WHEN v_report.terminal_code IS NULL THEN '' ELSE ' / ' || v_report.terminal_code END
        || ': departamento "' || public.agency_report_department_label(v_department) || '" pendente.';
      IF v_eligible AND v_pending THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
          WHERE i.item_type = 'agency_report_department_pending'
            AND i.status = 'active' AND a.entity_type = 'agency_departure_report'
            AND a.entity_id = v_entity_id AND i.department = v_department
        ) THEN
          PERFORM public.upsert_alert_item(
            'agency_report_department_pending', 'agency_departure_report', v_entity_id,
            v_message, 'agency_report_reconcile', v_department, v_metadata, '/viagens'
          );
          v_changed := v_changed + 1;
        END IF;
      ELSE
        IF public.resolve_alert_item_for_department(
          'agency_report_department_pending', 'agency_departure_report', v_entity_id,
          v_department, 'agency_report_reconcile', v_metadata
        ) THEN
          v_changed := v_changed + 1;
        END IF;
      END IF;
    END IF;

    IF p_deadline THEN
      SELECT COALESCE((
        SELECT signed_at IS NOT NULL
        FROM public.agency_departure_report_department_signoffs ds
        WHERE ds.report_id = v_report.id AND ds.department = v_department
      ), false) INTO v_signed;
      v_deadline_missed := v_eligible AND v_deadline < CURRENT_DATE AND NOT v_signed;
      v_message := 'ADR ' || upper(btrim(v_report.port))
        || CASE WHEN v_report.terminal_code IS NULL THEN '' ELSE ' / ' || v_report.terminal_code END
        || ': prazo de conclusão vencido para "' || public.agency_report_department_label(v_department) || '".';
      IF v_deadline_missed THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
          WHERE i.item_type = 'agency_report_deadline_missed'
            AND i.status = 'active' AND a.entity_type = 'agency_departure_report'
            AND a.entity_id = v_entity_id AND i.department = v_department
        ) THEN
          PERFORM public.upsert_alert_item(
            'agency_report_deadline_missed', 'agency_departure_report', v_entity_id,
            v_message, 'agency_report_reconcile', v_department, v_metadata, '/viagens'
          );
          v_changed := v_changed + 1;
        END IF;
      ELSE
        IF public.resolve_alert_item_for_department(
          'agency_report_deadline_missed', 'agency_departure_report', v_entity_id,
          v_department, 'agency_report_reconcile', v_metadata
        ) THEN
          v_changed := v_changed + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'report_id', v_report.id, 'entity_id', v_entity_id,
    'eligible', v_eligible, 'atd', v_atd, 'deadline_date', v_deadline,
    'changed', v_changed
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_agency_report_alerts(UUID, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_agency_report_alerts(UUID, BOOLEAN, BOOLEAN) TO service_role;

-- Converte os carriers ADR ainda abertos para o agregado correto. Nenhuma
-- notificação histórica é criada: a sobrecarga usa foundation_backfill.
DO $backfill$
DECLARE
  v_row RECORD;
  v_parts TEXT[];
  v_department TEXT;
  v_terminal TEXT;
  v_entity_id TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  FOR v_row IN
    SELECT a.id, a.type, a.entity_type, a.entity_id, a.message
    FROM public.alerts a
    WHERE a.type IN ('agency_report_department_pending', 'agency_report_deadline_missed')
      AND a.status <> 'closed'
      AND a.entity_type = 'agency_departure_report'
    ORDER BY a.id
  LOOP
    v_parts := string_to_array(v_row.entity_id, '::');
    IF COALESCE(array_length(v_parts, 1), 0) = 4 THEN
      v_terminal := v_parts[3];
      v_department := v_parts[4];
      v_entity_id := v_parts[1] || '::' || v_parts[2] || '::' || v_terminal;
    ELSIF COALESCE(array_length(v_parts, 1), 0) = 3 THEN
      v_terminal := NULL;
      v_department := v_parts[3];
      v_entity_id := v_parts[1] || '::' || v_parts[2];
    ELSE
      CONTINUE;
    END IF;
    IF v_department NOT IN ('operacoes', 'documentacao', 'equipamentos') THEN CONTINUE; END IF;

    PERFORM public.upsert_alert_item(
      v_row.type, v_row.entity_type, v_entity_id, v_row.message,
      'foundation_backfill', v_department,
      jsonb_build_object('department', v_department, 'legacy_entity_id', v_row.entity_id),
      '/viagens'
    );
    UPDATE public.alerts
    SET status = 'closed', closed_at = COALESCE(closed_at, now())
    WHERE id = v_row.id;
  END LOOP;
END;
$backfill$;

CREATE OR REPLACE FUNCTION public.reconcile_agency_report_alerts_on_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report RECORD;
  v_report_id UUID;
  v_section_department TEXT;
  v_section TEXT;
  v_voyage_id BIGINT;
  v_port TEXT;
BEGIN
  IF NEW.entity_type IN ('voyage_pod_schedule', 'voyage_pol_schedule')
     AND NEW.field_name IN ('atd', 'omitted', 'deleted', 'terminal_dates', 'terminal_state_removed', 'terminal_assignment') THEN
    v_voyage_id := split_part(NEW.entity_id, '::', 1)::BIGINT;
    v_port := upper(btrim(split_part(NEW.entity_id, '::', 2)));
    FOR v_report IN
      SELECT id FROM public.agency_departure_reports
      WHERE voyage_id = v_voyage_id AND port = v_port
    LOOP
      PERFORM public.reconcile_agency_report_alerts(v_report.id, TRUE, TRUE);
    END LOOP;
  ELSIF NEW.entity_type IN ('agency_departure_report_signoff', 'agency_departure_report_department_signoff') THEN
    IF NEW.entity_id ~ '^[0-9a-fA-F-]{36}::' THEN
      v_report_id := split_part(NEW.entity_id, '::', 1)::UUID;
    ELSE
      v_voyage_id := split_part(NEW.entity_id, '::', 1)::BIGINT;
      v_port := upper(btrim(split_part(NEW.entity_id, '::', 2)));
      SELECT id INTO v_report_id FROM public.agency_departure_reports
      WHERE voyage_id = v_voyage_id AND port = v_port AND terminal_id IS NULL;
    END IF;

    IF NEW.entity_type = 'agency_departure_report_signoff'
       AND NEW.field_name = 'state' AND NEW.new_value = 'pending' THEN
      v_section := CASE
        WHEN NEW.entity_id ~ '^[0-9a-fA-F-]{36}::' THEN split_part(NEW.entity_id, '::', 2)
        ELSE split_part(NEW.entity_id, '::', 3)
      END;
      SELECT department INTO v_section_department
      FROM public.agency_departure_report_signoffs
      WHERE report_id = v_report_id AND section = v_section;
      IF v_section_department IS NOT NULL THEN
        UPDATE public.agency_departure_report_department_signoffs
        SET signed_at = NULL, signed_by = NULL
        WHERE report_id = v_report_id
          AND department = v_section_department
          AND signed_at IS NOT NULL;
        IF FOUND THEN
          INSERT INTO public.audit_logs (
            entity_type, entity_id, field_name, old_value, new_value,
            changed_by, justification
          )
          VALUES (
            'agency_departure_report_department_signoff',
            v_report_id::TEXT || '::' || v_section_department,
            'signed', 'true', 'false', NEW.changed_by, NEW.justification
          );
        END IF;
      END IF;
    END IF;
    IF v_report_id IS NOT NULL THEN
      PERFORM public.reconcile_agency_report_alerts(v_report_id, TRUE, TRUE);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS reconcile_agency_report_alerts_on_audit ON public.audit_logs;
CREATE TRIGGER reconcile_agency_report_alerts_on_audit
  AFTER INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.reconcile_agency_report_alerts_on_audit();

CREATE OR REPLACE FUNCTION public.reconcile_agency_report_alerts_on_report_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.reconcile_agency_report_alerts(NEW.id, TRUE, TRUE);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS reconcile_agency_report_alerts_on_report_change ON public.agency_departure_reports;
CREATE TRIGGER reconcile_agency_report_alerts_on_report_change
  AFTER UPDATE OF status ON public.agency_departure_reports
  FOR EACH ROW EXECUTE FUNCTION public.reconcile_agency_report_alerts_on_report_change();

-- Compatibilidade do contrato público: cada detector agora reconcilia apenas
-- seu tipo e usa o estado terminalizado, em vez de inserir carriers legados.
CREATE OR REPLACE FUNCTION public.detect_agency_report_department_pending()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report RECORD;
  v_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  FOR v_report IN SELECT id FROM public.agency_departure_reports LOOP
    PERFORM public.reconcile_agency_report_alerts(v_report.id, TRUE, FALSE);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.detect_agency_report_pending()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public.detect_agency_report_department_pending();
END;
$function$;

CREATE OR REPLACE FUNCTION public.detect_agency_report_deadline_missed()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report RECORD;
  v_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  FOR v_report IN SELECT id FROM public.agency_departure_reports LOOP
    PERFORM public.reconcile_agency_report_alerts(v_report.id, FALSE, TRUE);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.detect_agency_report_pending() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.detect_agency_report_department_pending() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.detect_agency_report_deadline_missed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_agency_report_pending() TO authenticated;
GRANT EXECUTE ON FUNCTION public.detect_agency_report_department_pending() TO authenticated;
GRANT EXECUTE ON FUNCTION public.detect_agency_report_deadline_missed() TO authenticated;

COMMENT ON FUNCTION public.reconcile_agency_report_alerts(UUID, BOOLEAN, BOOLEAN) IS
  'Reconcilia os itens coletivos de pendência e prazo do ADR a partir da origem autoritativa.';
