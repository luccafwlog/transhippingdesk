-- 339_treatment_echo_and_transversal_surfaces.sql
-- Bloco 6: Transversal e Portal do Cliente (#525 / #519)
--
-- 1. Ampliar alert_item_events para aceitar 'dismissed'.
-- 2. dismiss_alert_item: grava evento 'dismissed' e fan-out do Eco de Tratamento.
-- 3. list_internal_notifications: paginação server-side com limite e offset.
-- 4. count_unread_internal_notifications: contagem de não lidas para o badge.
-- 5. mark_all_internal_notifications_read: baixa em massa escopada ao auth.uid().
-- 6. list_alert_queue / list_alert_queue_page: filtro por departamento, projeção de dispensa e ordenação por prioridade.
-- 7. summarize_alert_queue_by_department: agregado dedicado para o /painel.

-- 1. Ampliar alert_item_events.event_type
ALTER TABLE public.alert_item_events
  DROP CONSTRAINT IF EXISTS alert_item_events_event_type_check;

ALTER TABLE public.alert_item_events
  ADD CONSTRAINT alert_item_events_event_type_check
  CHECK (event_type IN ('opened', 'updated', 'resolved', 'dismissed'));

-- 2. dismiss_alert_item com emissão de evento e Eco de Tratamento
CREATE OR REPLACE FUNCTION public.dismiss_alert_item(
  p_item_id BIGINT,
  p_reason TEXT,
  p_review_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_item public.alert_items%ROWTYPE;
  v_alert public.alerts%ROWTYPE;
  v_dismissal public.alert_item_dismissals%ROWTYPE;
  v_event_id BIGINT;
  v_actor_name TEXT;
  v_author_name TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Motivo da dispensa é obrigatório.' USING ERRCODE = '22023';
  END IF;
  IF p_review_at IS NULL OR p_review_at <= now() THEN
    RAISE EXCEPTION 'A revisão deve ser uma data futura.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.alert_items WHERE id = p_item_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de alerta não está ativo.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_alert FROM public.alerts WHERE id = v_item.alert_id;

  SELECT full_name INTO v_actor_name FROM public.user_profiles WHERE id = auth.uid();
  v_author_name := COALESCE(NULLIF(btrim(v_actor_name), ''), 'Usuário');

  -- Gravar a dispensa auditada
  INSERT INTO public.alert_item_dismissals(alert_item_id, occurrence_id, reason, dismissed_by, review_at)
  VALUES (v_item.id, v_item.occurrence_id, btrim(p_reason), auth.uid(), p_review_at)
  RETURNING * INTO v_dismissal;

  -- Gravar o evento 'dismissed' na ocorrência corrente
  INSERT INTO public.alert_item_events (
    alert_item_id, occurrence_id, event_type, previous_status, new_status, actor_id, metadata
  )
  VALUES (
    v_item.id,
    v_item.occurrence_id,
    'dismissed',
    v_item.status,
    v_item.status,
    auth.uid(),
    jsonb_build_object(
      'reason', btrim(p_reason),
      'review_at', p_review_at,
      'dismissal_id', v_dismissal.id
    )
  )
  RETURNING id INTO v_event_id;

  -- Fan-out do Eco de Tratamento para os destinatários que já receberam notificações
  -- nesta ocorrência, excluindo o autor da dispensa (auth.uid()).
  INSERT INTO public.internal_notifications (
    alert_id,
    alert_item_id,
    event_id,
    recipient_id,
    recipient_department,
    is_fallback,
    item_type,
    severity,
    title,
    message,
    entity_type,
    entity_id,
    destination,
    payload
  )
  SELECT DISTINCT ON (n.recipient_id)
    v_alert.id,
    v_item.id,
    v_event_id,
    n.recipient_id,
    n.recipient_department,
    n.is_fallback,
    v_item.item_type,
    'normal',
    'Pendência dispensada',
    'Pendência dispensada por ' || v_author_name || ' até ' || to_char(p_review_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'),
    v_alert.entity_type,
    v_alert.entity_id,
    NULL,
    jsonb_build_object(
      'is_echo', true,
      'dismissed_by', auth.uid(),
      'dismissed_by_name', v_author_name,
      'reason', btrim(p_reason),
      'review_at', p_review_at,
      'dismissal_id', v_dismissal.id
    )
  FROM public.internal_notifications n
  JOIN public.alert_item_events e ON e.id = n.event_id
  WHERE n.alert_item_id = v_item.id
    AND e.occurrence_id = v_item.occurrence_id
    AND n.recipient_id <> auth.uid()
  ORDER BY n.recipient_id, n.id DESC
  ON CONFLICT (event_id, recipient_id) DO NOTHING;

  -- Zero destinatários no Eco é normal (ex.: autor era o único destinatário).
  -- Não grava em alert_notification_failures.

  RETURN jsonb_build_object(
    'id', v_dismissal.id,
    'item_id', v_item.id,
    'review_at', v_dismissal.review_at,
    'event_id', v_event_id
  );
END;
$function$;

-- 3. list_internal_notifications com suporte a paginação
DROP FUNCTION IF EXISTS public.list_internal_notifications(BOOLEAN);

CREATE OR REPLACE FUNCTION public.list_internal_notifications(
  p_include_read BOOLEAN DEFAULT false,
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS SETOF JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'id', n.id,
    'alert_id', n.alert_id,
    'alert_item_id', n.alert_item_id,
    'item_type', n.item_type,
    'severity', n.severity,
    'title', n.title,
    'message', n.message,
    'entity_type', n.entity_type,
    'entity_id', n.entity_id,
    'destination', n.destination,
    'is_fallback', n.is_fallback,
    'read_at', n.read_at,
    'created_at', n.created_at,
    'payload', n.payload
  )
  FROM public.internal_notifications n
  WHERE public.is_active_read_user()
    AND n.recipient_id = auth.uid()
    AND (p_include_read OR n.read_at IS NULL)
  ORDER BY n.created_at DESC, n.id DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
$$;

-- 4. count_unread_internal_notifications
CREATE OR REPLACE FUNCTION public.count_unread_internal_notifications()
RETURNS BIGINT
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.internal_notifications
  WHERE recipient_id = auth.uid()
    AND read_at IS NULL;

  RETURN v_count;
END;
$function$;

-- 5. mark_all_internal_notifications_read
CREATE OR REPLACE FUNCTION public.mark_all_internal_notifications_read()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_rows_updated INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.internal_notifications
  SET read_at = COALESCE(read_at, now())
  WHERE recipient_id = auth.uid()
    AND read_at IS NULL;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RETURN v_rows_updated;
END;
$function$;

-- 6. list_alert_queue_page e list_alert_queue atualizados
DROP FUNCTION IF EXISTS public.list_alert_queue_page(TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.list_alert_queue_page(TEXT, TEXT, INTEGER, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION public.list_alert_queue_page(
  p_filter TEXT DEFAULT 'active',
  p_entity_type TEXT DEFAULT NULL,
  p_offset INTEGER DEFAULT 0,
  p_limit INTEGER DEFAULT 100,
  p_department TEXT DEFAULT NULL
)
RETURNS SETOF JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF p_filter NOT IN ('active', 'dismissed', 'all') THEN
    RAISE EXCEPTION 'Filtro inválido.' USING ERRCODE = '22023';
  END IF;
  IF p_offset < 0 OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Paginação inválida.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH queue_rows AS (
    SELECT jsonb_build_object(
      'id', a.id,
      'item_id', i.id,
      'status', a.status,
      'item_status', i.status,
      'type', i.item_type,
      'severity', i.severity,
      'department', i.department,
      'message', i.message,
      'entity_type', a.entity_type,
      'entity_id', a.entity_id,
      'destination', i.destination,
      'created_at', a.created_at,
      'updated_at', i.updated_at,
      'dismissed_until', d.review_at,
      'dismissal_reason', d.reason,
      'dismissed_by', d.dismissed_by,
      'dismissed_by_name', up.full_name,
      'dismissed_at', d.dismissed_at,
      'metadata', i.metadata
    ) AS payload,
    COALESCE(d.review_at > now(), false) AS is_dismissed,
    (i.severity = 'critical') AS is_critical,
    a.created_at,
    i.id AS item_id
    FROM public.alerts a
    JOIN public.alert_items i ON i.alert_id = a.id AND i.status = 'active'
    LEFT JOIN LATERAL (
      SELECT ad.review_at, ad.reason, ad.dismissed_by, ad.dismissed_at
      FROM public.alert_item_dismissals ad
      WHERE ad.alert_item_id = i.id AND ad.occurrence_id = i.occurrence_id
      ORDER BY ad.dismissed_at DESC
      LIMIT 1
    ) d ON true
    LEFT JOIN public.user_profiles up ON up.id = d.dismissed_by
    WHERE a.status <> 'closed'
      AND (
        p_filter = 'all'
        OR (p_filter = 'dismissed' AND d.review_at > now())
        OR (p_filter = 'active' AND (d.review_at IS NULL OR d.review_at <= now()))
      )
      AND (p_entity_type IS NULL OR a.entity_type = p_entity_type)
      AND (
        p_department IS NULL
        OR i.department = p_department
        OR (p_department = 'sem_departamento' AND (i.department IS NULL OR btrim(i.department) = ''))
      )

    UNION ALL

    SELECT jsonb_build_object(
      'id', a.id,
      'item_id', NULL,
      'status', a.status,
      'item_status', NULL,
      'type', a.type,
      'severity', COALESCE(c.severity, 'normal'),
      'department', c.responsible_department,
      'message', a.message,
      'entity_type', a.entity_type,
      'entity_id', a.entity_id,
      'destination', c.default_destination,
      'created_at', a.created_at,
      'updated_at', a.created_at,
      'dismissed_until', NULL,
      'dismissal_reason', NULL,
      'dismissed_by', NULL,
      'dismissed_by_name', NULL,
      'dismissed_at', NULL,
      'metadata', '{}'::jsonb
    ) AS payload,
    false AS is_dismissed,
    (COALESCE(c.severity, 'normal') = 'critical') AS is_critical,
    a.created_at,
    a.id AS item_id
    FROM public.alerts a
    LEFT JOIN public.alert_type_catalog c ON c.type = a.type
    WHERE p_filter IN ('active', 'all')
      AND a.status <> 'closed'
      AND (p_entity_type IS NULL OR a.entity_type = p_entity_type)
      AND (
        p_department IS NULL
        OR c.responsible_department = p_department
        OR (p_department = 'sem_departamento' AND (c.responsible_department IS NULL OR btrim(c.responsible_department) = ''))
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.alert_items i WHERE i.alert_id = a.id
      )
  )
  SELECT payload
  FROM queue_rows
  ORDER BY
    is_dismissed ASC,
    is_critical DESC,
    created_at DESC,
    item_id DESC
  OFFSET p_offset
  LIMIT p_limit;
END;
$function$;

DROP FUNCTION IF EXISTS public.list_alert_queue(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.list_alert_queue(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.list_alert_queue(
  p_filter TEXT DEFAULT 'active',
  p_entity_type TEXT DEFAULT NULL,
  p_department TEXT DEFAULT NULL
)
RETURNS SETOF JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.list_alert_queue_page(p_filter, p_entity_type, 0, 200, p_department);
$$;

-- 7. summarize_alert_queue_by_department: agregado dedicado para o /painel
CREATE OR REPLACE FUNCTION public.summarize_alert_queue_by_department()
RETURNS TABLE (
  department TEXT,
  active_count BIGINT,
  dismissed_count BIGINT,
  is_legacy BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH item_rows AS (
    SELECT
      COALESCE(NULLIF(btrim(i.department), ''), 'sem_departamento') AS dept,
      COALESCE(d.review_at > now(), false) AS is_dismissed,
      false AS is_legacy
    FROM public.alerts a
    JOIN public.alert_items i ON i.alert_id = a.id AND i.status = 'active'
    LEFT JOIN LATERAL (
      SELECT ad.review_at
      FROM public.alert_item_dismissals ad
      WHERE ad.alert_item_id = i.id AND ad.occurrence_id = i.occurrence_id
      ORDER BY ad.dismissed_at DESC
      LIMIT 1
    ) d ON true
    WHERE a.status <> 'closed'

    UNION ALL

    SELECT
      COALESCE(NULLIF(btrim(c.responsible_department), ''), 'sem_departamento') AS dept,
      false AS is_dismissed,
      true AS is_legacy
    FROM public.alerts a
    LEFT JOIN public.alert_type_catalog c ON c.type = a.type
    WHERE a.status <> 'closed'
      AND NOT EXISTS (SELECT 1 FROM public.alert_items i WHERE i.alert_id = a.id)
  )
  SELECT
    dept AS department,
    COUNT(*) FILTER (WHERE NOT is_dismissed) AS active_count,
    COUNT(*) FILTER (WHERE is_dismissed) AS dismissed_count,
    bool_or(item_rows.is_legacy) AS is_legacy
  FROM item_rows
  GROUP BY dept
  ORDER BY
    CASE WHEN dept = 'sem_departamento' THEN 1 ELSE 0 END,
    dept ASC;
END;
$function$;

-- Revoke/Grant permissions
REVOKE ALL ON FUNCTION public.dismiss_alert_item(BIGINT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_internal_notifications(BOOLEAN, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.count_unread_internal_notifications() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_all_internal_notifications_read() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_alert_queue(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_alert_queue_page(TEXT, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.summarize_alert_queue_by_department() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.dismiss_alert_item(BIGINT, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_internal_notifications(BOOLEAN, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_unread_internal_notifications() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_internal_notifications_read() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_alert_queue(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_alert_queue_page(TEXT, TEXT, INTEGER, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.summarize_alert_queue_by_department() TO authenticated;
