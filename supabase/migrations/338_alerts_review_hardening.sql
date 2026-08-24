-- 338: correções da revisão independente da integração dos Blocos 1–5.
--
-- Este migration fecha quatro contratos que não podem ser corrigidos apenas na
-- UI: audiência de notificações, identidade de terminal, ocorrência por marco
-- e superfície server-only dos reconciliadores. A pendência de exportação é
-- deliberadamente agregada por escala porque os manifests legados ainda não
-- têm terminal_id; o upgrade para granularidade documental fica explícito em
-- 306_voyage_escala_operation_fronts.

-- O destino é derivado pelo roteador compartilhado do cliente. Mantê-lo também
-- em PL/pgSQL criava duas fontes divergentes para o mesmo link.
CREATE OR REPLACE FUNCTION public.clear_alert_item_destination()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.alert_type_catalog c
    WHERE c.type = NEW.item_type AND c.active = true
  ) THEN
    NEW.destination := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS clear_alert_item_destination ON public.alert_items;
CREATE TRIGGER clear_alert_item_destination
  BEFORE INSERT OR UPDATE OF destination, item_type ON public.alert_items
  FOR EACH ROW EXECUTE FUNCTION public.clear_alert_item_destination();

REVOKE ALL ON FUNCTION public.clear_alert_item_destination() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_alert_item_destination() TO service_role;

UPDATE public.alert_items i
SET destination = NULL
WHERE EXISTS (
  SELECT 1 FROM public.alert_type_catalog c
  WHERE c.type = i.item_type AND c.active = true
);

UPDATE public.internal_notifications n
SET destination = NULL
WHERE EXISTS (
  SELECT 1 FROM public.alert_items i
  JOIN public.alert_type_catalog c ON c.type = i.item_type AND c.active = true
  WHERE i.id = n.alert_item_id
);

-- A audiência é a união do catálogo com o departamento concreto do item ADR.
-- O recipient_department continua sendo o role efetivamente entregue, não o
-- departamento responsável original do catálogo.
CREATE OR REPLACE FUNCTION public.fanout_alert_item_for_department(
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
  v_audience TEXT[];
  v_count INTEGER := 0;
  v_fallback BOOLEAN := false;
BEGIN
  SELECT * INTO v_item FROM public.alert_items WHERE id = p_item_id;
  SELECT * INTO v_alert FROM public.alerts WHERE id = p_alert_id;
  SELECT * INTO v_catalog FROM public.alert_type_catalog WHERE type = v_item.item_type;

  SELECT COALESCE(array_agg(DISTINCT department ORDER BY department), '{}'::TEXT[])
  INTO v_audience
  FROM unnest(
    COALESCE(v_catalog.audience_departments, '{}'::TEXT[])
    || CASE WHEN NULLIF(btrim(p_department), '') IS NULL THEN '{}'::TEXT[]
            ELSE ARRAY[NULLIF(btrim(p_department), '')] END
  ) AS departments(department)
  WHERE department IS NOT NULL;

  FOR v_user IN
    SELECT up.id, up.role
    FROM public.user_profiles up
    WHERE up.active = true AND up.role = ANY(v_audience)
  LOOP
    INSERT INTO public.internal_notifications (
      alert_id, alert_item_id, event_id, recipient_id, recipient_department,
      is_fallback, item_type, severity, title, message, entity_type, entity_id,
      destination, payload
    )
    VALUES (
      p_alert_id, p_item_id, p_event_id, v_user.id, v_user.role,
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
        jsonb_build_object('fallback_for', COALESCE(NULLIF(btrim(p_department), ''), v_catalog.responsible_department)) || v_item.metadata
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
      p_alert_id, p_item_id, p_event_id, v_item.item_type,
      COALESCE(NULLIF(btrim(p_department), ''), v_catalog.responsible_department, 'desconhecido'),
      CASE WHEN v_fallback THEN 'Nenhum destinatário ativo no fallback Administrativo.'
           ELSE 'Nenhum destinatário ativo na audiência do item.' END
    );
  END IF;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.fanout_alert_item_for_department(BIGINT, BIGINT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fanout_alert_item_for_department(BIGINT, BIGINT, BIGINT, TEXT) TO service_role;

-- A troca de marco abre uma nova ocorrência do mesmo item. Renomeamos a
-- implementação anterior e a envolvemos para manter toda a lógica já validada
-- de agregação/reabertura, adicionando apenas a transição de ocorrência.
ALTER FUNCTION public.upsert_alert_item(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT)
  RENAME TO upsert_alert_item_before_milestone_hardening;

CREATE OR REPLACE FUNCTION public.upsert_alert_item(
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
  v_before RECORD;
  v_after RECORD;
  v_result JSONB;
  v_event_id BIGINT;
  v_metadata JSONB := COALESCE(p_metadata, '{}'::jsonb);
BEGIN
  SELECT i.id, i.status, i.metadata
  INTO v_before
  FROM public.alert_items i
  JOIN public.alerts a ON a.id = i.alert_id
  WHERE i.item_type = p_type
    AND i.department = NULLIF(btrim(p_department), '')
    AND a.entity_type = p_entity_type
    AND a.entity_id = p_entity_id
  ORDER BY i.id DESC
  LIMIT 1;

  v_result := public.upsert_alert_item_before_milestone_hardening(
    p_type, p_entity_type, p_entity_id, p_message, p_source,
    p_department, v_metadata, p_destination
  );

  IF v_before.id IS NOT NULL
     AND v_before.status = 'active'
     AND v_metadata ? 'milestone'
     AND v_before.metadata->>'milestone' IS DISTINCT FROM v_metadata->>'milestone' THEN
    SELECT i.id, i.alert_id, i.occurrence_id
    INTO v_after
    FROM public.alert_items i
    WHERE i.id = v_before.id
    FOR UPDATE;

    UPDATE public.alert_items
    SET occurrence_id = gen_random_uuid(), updated_at = now()
    WHERE id = v_after.id
    RETURNING id, alert_id, occurrence_id INTO v_after;

    INSERT INTO public.alert_item_events(
      alert_item_id, occurrence_id, event_type, previous_status, new_status,
      actor_id, metadata
    )
    VALUES (
      v_after.id, v_after.occurrence_id, 'opened', 'active', 'active',
      auth.uid(), v_metadata
    )
    RETURNING id INTO v_event_id;

    IF p_source <> 'foundation_backfill' THEN
      PERFORM public.fanout_alert_item_for_department(
        v_after.alert_id, v_after.id, v_event_id, p_department
      );
    END IF;

    v_result := jsonb_set(v_result, '{event_id}', to_jsonb(v_event_id), true);
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_alert_item_before_milestone_hardening(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_alert_item(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_alert_item(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO service_role;

-- A chave fechada é voyage::porto::depots.code, não o UUID interno do depot.
CREATE OR REPLACE FUNCTION public.voyage_terminal_code(p_terminal_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(upper(btrim(d.code)), '')
  FROM public.depots d
  WHERE d.id = p_terminal_id;
$$;

REVOKE ALL ON FUNCTION public.voyage_terminal_code(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.voyage_terminal_code(UUID) TO service_role;

-- A função já existente é mantida como fonte única; só os três usos que
-- vazavam o UUID são substituídos no corpo compilado.
DO $patch$
DECLARE
  v_definition TEXT;
BEGIN
  SELECT pg_get_functiondef('public.reconcile_voyage_schedule_date_alerts(bigint,text,text)'::regprocedure)
  INTO v_definition;
  v_definition := replace(
    v_definition,
    'upper(btrim(v_term_rec.terminal_id::text))',
    'public.voyage_terminal_code(v_term_rec.terminal_id)'
  );
  v_definition := replace(
    v_definition,
    '''terminal'', v_term_rec.terminal_id',
    '''terminal'', public.voyage_terminal_code(v_term_rec.terminal_id)'
  );
  v_definition := replace(
    v_definition,
    '''&terminal='' || v_term_rec.terminal_id',
    '''&terminal='' || public.voyage_terminal_code(v_term_rec.terminal_id)'
  );
  EXECUTE v_definition;
END;
$patch$;

-- O schema legado dos manifests não tem terminal_id. Até que a atribuição
-- desça para BL/unidade, a pendência deve existir uma vez por escala, nunca
-- aparentar uma resolução independente por terminal.
CREATE OR REPLACE FUNCTION public.reconcile_voyage_export_after_atd_alerts(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_terminal_id TEXT,
  p_source TEXT DEFAULT 'voyage_operation_detector'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_port_norm TEXT := upper(btrim(p_port));
  v_entity_id TEXT := p_voyage_id || '::' || v_port_norm;
  v_export_rec RECORD;
  v_terminal_atd TIMESTAMPTZ;
  v_terminal_code TEXT;
  v_has_granite_link BOOLEAN := true;
  v_has_empty_link BOOLEAN := true;
BEGIN
  SELECT tem_exportacao, has_granite, has_empty
  INTO v_export_rec
  FROM public.voyage_export_schedules
  WHERE voyage_id = p_voyage_id AND upper(btrim(pol)) = v_port_norm;

  IF NOT FOUND OR NOT COALESCE(v_export_rec.tem_exportacao, false) THEN
    PERFORM public.resolve_alert_item('voyage_export_after_atd', 'voyage_pod_schedule', v_entity_id, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  SELECT s.terminal_atd, public.voyage_terminal_code(s.terminal_id)
  INTO v_terminal_atd, v_terminal_code
  FROM public.voyage_escala_terminal_state s
  WHERE s.voyage_id = p_voyage_id
    AND s.port = v_port_norm
    AND s.terminal_id::text = p_terminal_id;

  IF v_terminal_atd IS NULL THEN
    PERFORM public.resolve_alert_item('voyage_export_after_atd', 'voyage_pod_schedule', v_entity_id, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  IF COALESCE(v_export_rec.has_granite, false) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.granite_manifests WHERE voyage_id = p_voyage_id
    ) INTO v_has_granite_link;
  END IF;

  IF COALESCE(v_export_rec.has_empty, false) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.vazios_manifests WHERE voyage_id = p_voyage_id
    ) INTO v_has_empty_link;
  END IF;

  IF NOT v_has_granite_link OR NOT v_has_empty_link THEN
    PERFORM public.upsert_alert_item(
      'voyage_export_after_atd',
      'voyage_pod_schedule',
      v_entity_id,
      'Exportação pendente de vínculo após saída/ATD no terminal para a escala ' || v_port_norm,
      p_source,
      jsonb_build_object(
        'voyage_id', p_voyage_id,
        'port', v_port_norm,
        'terminal_id', p_terminal_id,
        'terminal_code', v_terminal_code,
        'has_granite', v_export_rec.has_granite,
        'has_empty', v_export_rec.has_empty,
        'granite_linked', v_has_granite_link,
        'empty_linked', v_has_empty_link
      ),
      '/viagens/' || p_voyage_id || '?escala=' || v_port_norm
    );
  ELSE
    PERFORM public.resolve_alert_item('voyage_export_after_atd', 'voyage_pod_schedule', v_entity_id, p_source, '{}'::jsonb);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_voyage_export_after_atd_alerts(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_export_after_atd_alerts(BIGINT, TEXT, TEXT, TEXT) TO service_role;

-- Conversão idempotente dos carriers já emitidos: mantém item, eventos e
-- notificações; só normaliza a identidade visível e o link compartilhado.
DO $backfill$
DECLARE
  v_row RECORD;
  v_new_entity_id TEXT;
BEGIN
  FOR v_row IN
    SELECT a.id AS alert_id,
           a.entity_id,
           split_part(a.entity_id, '::', 1)::BIGINT AS voyage_id,
           upper(btrim(split_part(a.entity_id, '::', 2))) AS port,
           split_part(a.entity_id, '::', 3)::UUID AS terminal_id,
           upper(btrim(d.code)) AS terminal_code
    FROM public.alerts a
    JOIN public.voyage_escala_terminal_state s
      ON s.voyage_id = split_part(a.entity_id, '::', 1)::BIGINT
     AND s.port = upper(btrim(split_part(a.entity_id, '::', 2)))
     AND s.terminal_id = split_part(a.entity_id, '::', 3)::UUID
    JOIN public.depots d ON d.id = s.terminal_id
    WHERE a.entity_type = 'voyage_escala_terminal'
      AND split_part(a.entity_id, '::', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  LOOP
    v_new_entity_id := v_row.voyage_id || '::' || v_row.port || '::' || v_row.terminal_code;
    UPDATE public.alerts SET entity_id = v_new_entity_id WHERE id = v_row.alert_id;
    UPDATE public.internal_notifications
    SET entity_id = v_new_entity_id,
        destination = NULL,
        payload = CASE WHEN payload ? 'terminal'
          THEN jsonb_set(payload, '{terminal}', to_jsonb(v_row.terminal_code), true)
          ELSE payload END || jsonb_build_object('terminal_code', v_row.terminal_code)
    WHERE alert_id = v_row.alert_id;
    UPDATE public.alert_items
    SET destination = NULL,
        metadata = metadata || jsonb_build_object('terminal_code', v_row.terminal_code)
    WHERE alert_id = v_row.alert_id;
  END LOOP;
END;
$backfill$;

-- F-06: o item de exportação é granularidade de escala até que o modelo de
-- manifests tenha vínculo terminal. ponytail: preservamos o terminal no
-- metadata e mantemos o fallback por escala; quando houver terminal_id em
-- granite_manifests/vazios_manifests, o detector poderá voltar ao terminal.
DO $backfill$
DECLARE
  v_row RECORD;
  v_scale_alert_id BIGINT;
  v_existing_item_id BIGINT;
  v_new_entity_id TEXT;
BEGIN
  FOR v_row IN
    SELECT a.id AS alert_id,
           i.id AS item_id,
           i.status AS item_status,
           i.department,
           i.message,
           split_part(a.entity_id, '::', 1)::BIGINT AS voyage_id,
           upper(btrim(split_part(a.entity_id, '::', 2))) AS port,
           split_part(a.entity_id, '::', 3) AS terminal_id
    FROM public.alerts a
    JOIN public.alert_items i ON i.alert_id = a.id
    WHERE i.item_type = 'voyage_export_after_atd'
      AND a.entity_type = 'voyage_escala_terminal'
  LOOP
    v_new_entity_id := v_row.voyage_id || '::' || v_row.port;

    SELECT a.id INTO v_scale_alert_id
    FROM public.alerts a
    WHERE a.type = 'aggregate'
      AND a.entity_type = 'voyage_pod_schedule'
      AND a.entity_id = v_new_entity_id
    ORDER BY a.id DESC
    LIMIT 1
    FOR UPDATE;

    IF v_scale_alert_id IS NULL THEN
      INSERT INTO public.alerts(type, entity_type, entity_id, message, status)
      VALUES ('aggregate', 'voyage_pod_schedule', v_new_entity_id, v_row.message, 'open')
      RETURNING id INTO v_scale_alert_id;
    END IF;

    SELECT i.id INTO v_existing_item_id
    FROM public.alert_items i
    WHERE i.alert_id = v_scale_alert_id
      AND i.item_type = 'voyage_export_after_atd'
    FOR UPDATE;

    IF v_existing_item_id IS NULL THEN
      -- Move only this item. Other terminal-level items remain attached to
      -- their original carrier and continue to be reconciled independently.
      UPDATE public.alert_items
      SET alert_id = v_scale_alert_id,
          destination = NULL,
          metadata = metadata || jsonb_build_object('terminal_id', v_row.terminal_id),
          updated_at = now()
      WHERE id = v_row.item_id;
      UPDATE public.internal_notifications
      SET alert_id = v_scale_alert_id,
          entity_type = 'voyage_pod_schedule',
          entity_id = v_new_entity_id,
          destination = NULL
      WHERE alert_item_id = v_row.item_id;
    ELSE
      -- A repeated backfill must not violate UNIQUE(alert_id, item_type).
      -- Keep the existing scale item authoritative and close only this
      -- duplicated terminal item, preserving its event history.
      IF v_row.item_status = 'active' THEN
        UPDATE public.alert_items
        SET status = 'resolved',
            destination = NULL,
            updated_at = now(),
            resolved_at = now()
        WHERE id = v_row.item_id;
        INSERT INTO public.alert_item_events (
          alert_item_id, occurrence_id, event_type, previous_status, new_status,
          actor_id, metadata
        )
        SELECT id, occurrence_id, 'resolved', 'active', 'resolved', NULL,
               metadata || jsonb_build_object('reason', 'scale_backfill_duplicate')
        FROM public.alert_items
        WHERE id = v_row.item_id;
      END IF;
      UPDATE public.internal_notifications
      SET entity_type = 'voyage_pod_schedule',
          entity_id = v_new_entity_id,
          destination = NULL
      WHERE alert_item_id = v_row.item_id;
    END IF;

    PERFORM public.refresh_alert_aggregate(v_row.alert_id);
    PERFORM public.refresh_alert_aggregate(v_scale_alert_id);
  END LOOP;
END;
$backfill$;

-- Triggers de frescor: a fila não aguarda o cron quando a origem mudou. O
-- detector agendado permanece como rede de segurança e reconcilia o restante.
CREATE OR REPLACE FUNCTION public.reconcile_voyage_operation_alerts_on_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_voyage_id BIGINT;
  v_port TEXT;
BEGIN
  IF NEW.entity_type NOT IN ('voyage_pod_schedule', 'voyage_pol_schedule', 'voyages') THEN
    RETURN NEW;
  END IF;
  v_voyage_id := NULLIF(split_part(NEW.entity_id, '::', 1), '')::BIGINT;
  IF NEW.entity_type = 'voyages' THEN
    PERFORM public.reconcile_voyage_operation_alerts(v_voyage_id, 'voyage_operation_trigger');
  ELSE
    v_port := NULLIF(upper(btrim(split_part(NEW.entity_id, '::', 2))), '');
    IF v_port IS NOT NULL THEN
      PERFORM public.reconcile_voyage_schedule_date_alerts(v_voyage_id, v_port, 'voyage_operation_trigger');
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Reconciliação de alertas de viagem ignorada para audit_logs.id=%: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS reconcile_voyage_operation_alerts_on_audit ON public.audit_logs;
CREATE TRIGGER reconcile_voyage_operation_alerts_on_audit
  AFTER INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.reconcile_voyage_operation_alerts_on_audit();

CREATE OR REPLACE FUNCTION public.reconcile_voyage_operation_alerts_on_terminal_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public.reconcile_voyage_operation_alerts(NEW.voyage_id, 'voyage_operation_trigger');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Reconciliação de alertas de terminal ignorada para voyage_id=%: %', NEW.voyage_id, SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS reconcile_voyage_operation_alerts_on_terminal_change ON public.voyage_escala_terminal_state;
CREATE TRIGGER reconcile_voyage_operation_alerts_on_terminal_change
  AFTER INSERT OR UPDATE OF port, terminal_id, terminal_etb, terminal_atb, terminal_etd, terminal_atd, terminal_rtw
  ON public.voyage_escala_terminal_state
  FOR EACH ROW EXECUTE FUNCTION public.reconcile_voyage_operation_alerts_on_terminal_change();

REVOKE ALL ON FUNCTION public.reconcile_voyage_operation_alerts_on_audit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_voyage_operation_alerts_on_terminal_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_operation_alerts_on_audit() TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_operation_alerts_on_terminal_change() TO service_role;

-- Reconciliadores de alertas são server-only; o browser nunca deve disparar
-- escrita/resolução em massa de viagens.
REVOKE ALL ON FUNCTION public.reconcile_voyage_bl_expected_alerts(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_voyage_baplie_missing_alerts(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_voyage_baplie_coverage_alerts(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_voyage_ce_mercante_missing_alerts(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_voyage_schedule_date_alerts(BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_voyage_export_after_atd_alerts(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_voyage_operation_alerts(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_bl_expected_alerts(BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_baplie_missing_alerts(BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_baplie_coverage_alerts(BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_ce_mercante_missing_alerts(BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_schedule_date_alerts(BIGINT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_export_after_atd_alerts(BIGINT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_operation_alerts(BIGINT, TEXT) TO service_role;

-- O editor legado de Demurrage ainda atualiza diretamente a invoice. A
-- conversa da Dispute precisa acompanhar essa transição para não deixar a
-- invoice encerrada com uma conversa operacional ainda aberta.
CREATE OR REPLACE FUNCTION public.sync_demurrage_dispute_lifecycle_from_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_state TEXT;
  v_next_responder TEXT;
BEGIN
  IF NEW.dispute_status = 'resolvido' THEN
    v_state := 'resolvida';
    v_next_responder := 'ninguem';
  ELSIF NEW.dispute_status = 'cancelado' THEN
    v_state := 'cancelada';
    v_next_responder := 'ninguem';
  ELSIF COALESCE(NEW.dispute_open, false) THEN
    v_state := 'aberta';
    v_next_responder := 'equipamentos';
  ELSE
    RETURN NEW;
  END IF;

  WITH target AS (
    SELECT id
    FROM public.demurrage_disputes
    WHERE demurrage_invoice_id = NEW.id
    ORDER BY CASE WHEN state = 'aberta' THEN 0 ELSE 1 END, id DESC
    LIMIT 1
  )
  UPDATE public.demurrage_disputes d
  SET state = v_state,
      next_responder = v_next_responder,
      resolved_at = CASE WHEN v_state = 'resolvida' THEN COALESCE(d.resolved_at, now()) ELSE NULL END,
      cancelled_at = CASE WHEN v_state = 'cancelada' THEN COALESCE(d.cancelled_at, now()) ELSE NULL END
  FROM target
  WHERE d.id = target.id;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sync_demurrage_dispute_lifecycle_from_invoice ON public.demurrage_invoices;
CREATE TRIGGER sync_demurrage_dispute_lifecycle_from_invoice
  AFTER INSERT OR UPDATE OF dispute_open, dispute_status
  ON public.demurrage_invoices
  FOR EACH ROW EXECUTE FUNCTION public.sync_demurrage_dispute_lifecycle_from_invoice();

REVOKE ALL ON FUNCTION public.sync_demurrage_dispute_lifecycle_from_invoice() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_demurrage_dispute_lifecycle_from_invoice() TO service_role;

CREATE INDEX IF NOT EXISTS idx_pix_reconciliation_exceptions_resolved_invoice
  ON public.pix_reconciliation_exceptions (resolved_invoice_id)
  WHERE resolved_invoice_id IS NOT NULL;
