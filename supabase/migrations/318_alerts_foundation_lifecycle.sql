-- 318: agregado, itens, histórico, dispensa e Notificação Interna.
--
-- `alerts` continua existindo para preservar o histórico legado. A partir
-- daqui, `type` identifica o item; o agregado é a linha de `alerts` por
-- entidade e o ciclo de vida é operado pelas RPCs abaixo.
-- O status histórico `acknowledged` não é apagado; nenhuma RPC nova o cria.

CREATE TABLE IF NOT EXISTS public.alert_items (
  id BIGSERIAL PRIMARY KEY,
  alert_id BIGINT NOT NULL REFERENCES public.alerts(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL REFERENCES public.alert_type_catalog(type),
  source TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('normal', 'critical')),
  department TEXT,
  destination TEXT,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  occurrence_id UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (alert_id, item_type)
);

CREATE TABLE IF NOT EXISTS public.alert_item_events (
  id BIGSERIAL PRIMARY KEY,
  alert_item_id BIGINT NOT NULL REFERENCES public.alert_items(id) ON DELETE CASCADE,
  occurrence_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('opened', 'updated', 'resolved')),
  previous_status TEXT,
  new_status TEXT NOT NULL CHECK (new_status IN ('active', 'resolved')),
  actor_id UUID REFERENCES auth.users(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.alert_item_dismissals (
  id BIGSERIAL PRIMARY KEY,
  alert_item_id BIGINT NOT NULL REFERENCES public.alert_items(id) ON DELETE CASCADE,
  occurrence_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) >= 3),
  dismissed_by UUID NOT NULL REFERENCES auth.users(id),
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  review_at TIMESTAMPTZ NOT NULL,
  CHECK (review_at > dismissed_at)
);

CREATE TABLE IF NOT EXISTS public.internal_notifications (
  id BIGSERIAL PRIMARY KEY,
  alert_id BIGINT NOT NULL REFERENCES public.alerts(id) ON DELETE CASCADE,
  alert_item_id BIGINT NOT NULL REFERENCES public.alert_items(id) ON DELETE CASCADE,
  event_id BIGINT NOT NULL REFERENCES public.alert_item_events(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_department TEXT NOT NULL,
  is_fallback BOOLEAN NOT NULL DEFAULT false,
  item_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('normal', 'critical')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  destination TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, recipient_id)
);

CREATE TABLE IF NOT EXISTS public.alert_notification_failures (
  id BIGSERIAL PRIMARY KEY,
  alert_id BIGINT REFERENCES public.alerts(id) ON DELETE SET NULL,
  alert_item_id BIGINT REFERENCES public.alert_items(id) ON DELETE SET NULL,
  event_id BIGINT REFERENCES public.alert_item_events(id) ON DELETE SET NULL,
  item_type TEXT NOT NULL,
  department TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_items_active ON public.alert_items(alert_id, status);
CREATE INDEX IF NOT EXISTS idx_alert_items_type ON public.alert_items(item_type, status);
CREATE INDEX IF NOT EXISTS idx_alert_item_events_item ON public.alert_item_events(alert_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_item_dismissals_current ON public.alert_item_dismissals(alert_item_id, occurrence_id, review_at);
CREATE INDEX IF NOT EXISTS idx_internal_notifications_recipient ON public.internal_notifications(recipient_id, read_at, created_at DESC);

ALTER TABLE public.alert_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_item_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_item_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_notification_failures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alert_items_select_active ON public.alert_items;
CREATE POLICY alert_items_select_active ON public.alert_items
  FOR SELECT TO authenticated USING (public.is_active_user());
DROP POLICY IF EXISTS alert_item_events_select_active ON public.alert_item_events;
CREATE POLICY alert_item_events_select_active ON public.alert_item_events
  FOR SELECT TO authenticated USING (public.is_active_user());
DROP POLICY IF EXISTS alert_item_dismissals_select_active ON public.alert_item_dismissals;
CREATE POLICY alert_item_dismissals_select_active ON public.alert_item_dismissals
  FOR SELECT TO authenticated USING (public.is_active_user());
DROP POLICY IF EXISTS internal_notifications_select_recipient ON public.internal_notifications;
CREATE POLICY internal_notifications_select_recipient ON public.internal_notifications
  FOR SELECT TO authenticated USING (recipient_id = auth.uid());
DROP POLICY IF EXISTS internal_notifications_update_recipient ON public.internal_notifications;
CREATE POLICY internal_notifications_update_recipient ON public.internal_notifications
  FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());
DROP POLICY IF EXISTS alert_notification_failures_select_active ON public.alert_notification_failures;
CREATE POLICY alert_notification_failures_select_active ON public.alert_notification_failures
  FOR SELECT TO authenticated USING (public.is_active_user());

REVOKE INSERT, UPDATE, DELETE ON public.alert_items, public.alert_item_events,
  public.alert_item_dismissals, public.internal_notifications,
  public.alert_notification_failures FROM authenticated, anon, PUBLIC;
GRANT SELECT ON public.alert_items, public.alert_item_events, public.alert_item_dismissals,
  public.alert_notification_failures TO authenticated;
GRANT SELECT, UPDATE (read_at) ON public.internal_notifications TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

CREATE OR REPLACE FUNCTION public.alert_actor_is_authorized()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.role() = 'service_role' OR (auth.uid() IS NOT NULL AND public.is_active_user());
$$;

REVOKE ALL ON FUNCTION public.alert_actor_is_authorized() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.alert_actor_is_authorized() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_alert_aggregate(p_alert_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_message TEXT;
  v_open BOOLEAN;
BEGIN
  SELECT string_agg(i.message, ' | ' ORDER BY i.id), bool_or(i.status = 'active')
    INTO v_message, v_open
  FROM public.alert_items i
  WHERE i.alert_id = p_alert_id;

  UPDATE public.alerts
  SET type = 'aggregate',
      message = COALESCE(v_message, message),
      status = CASE WHEN COALESCE(v_open, false) THEN 'open' ELSE 'closed' END,
      closed_at = CASE WHEN COALESCE(v_open, false) THEN NULL ELSE COALESCE(closed_at, now()) END
  WHERE id = p_alert_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_alert_aggregate(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_alert_aggregate(BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.fanout_alert_item(
  p_alert_id BIGINT,
  p_item_id BIGINT,
  p_event_id BIGINT
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
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
    WHERE up.active = true
      AND up.role = ANY(v_catalog.audience_departments)
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
        jsonb_build_object('fallback_for', v_item.department) || v_item.metadata
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
      COALESCE(v_item.department, v_catalog.responsible_department),
      CASE WHEN v_fallback THEN 'Nenhum destinatário ativo no fallback Administrativo.'
           ELSE 'Nenhum destinatário ativo na audiência do item.' END
    );
  END IF;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.fanout_alert_item(BIGINT, BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fanout_alert_item(BIGINT, BIGINT, BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_alert_item(
  p_type TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_message TEXT,
  p_source TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_destination TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_catalog public.alert_type_catalog%ROWTYPE;
  v_alert public.alerts%ROWTYPE;
  v_item public.alert_items%ROWTYPE;
  v_event_id BIGINT;
  v_reopened BOOLEAN := false;
  v_new_item BOOLEAN := false;
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_type), '') IS NULL OR NULLIF(btrim(p_entity_type), '') IS NULL
     OR NULLIF(btrim(p_entity_id), '') IS NULL OR NULLIF(btrim(p_message), '') IS NULL
     OR NULLIF(btrim(p_source), '') IS NULL THEN
    RAISE EXCEPTION 'Tipo, entidade, mensagem e origem são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_catalog
  FROM public.alert_type_catalog
  WHERE type = p_type AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tipo de alerta fora do catálogo: %', p_type USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('alert:' || p_entity_type || ':' || p_entity_id, 0));

  SELECT * INTO v_alert
  FROM public.alerts
  WHERE entity_type = p_entity_type AND entity_id = p_entity_id
  ORDER BY (status <> 'closed') DESC, (type = 'aggregate') DESC, id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.alerts(type, entity_type, entity_id, message, status)
    VALUES ('aggregate', p_entity_type, p_entity_id, p_message, 'open')
    RETURNING * INTO v_alert;
  ELSE
    UPDATE public.alerts
    SET type = 'aggregate', status = 'open', closed_at = NULL
    WHERE id = v_alert.id;
    v_alert.type := 'aggregate';
    v_alert.status := 'open';
  END IF;

  SELECT * INTO v_item
  FROM public.alert_items
  WHERE alert_id = v_alert.id AND item_type = p_type
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.alert_items (
      alert_id, item_type, source, severity, department, destination,
      message, metadata, status
    )
    VALUES (
      v_alert.id, p_type, p_source, v_catalog.severity,
      v_catalog.responsible_department,
      COALESCE(p_destination, v_catalog.default_destination),
      p_message, COALESCE(p_metadata, '{}'::jsonb), 'active'
    )
    RETURNING * INTO v_item;
    v_new_item := true;
  ELSE
    UPDATE public.alert_items
    SET source = p_source,
        severity = v_catalog.severity,
        department = v_catalog.responsible_department,
        destination = COALESCE(p_destination, v_catalog.default_destination),
        message = p_message,
        metadata = COALESCE(p_metadata, '{}'::jsonb),
        status = 'active',
        updated_at = now(),
        resolved_at = NULL,
        occurrence_id = CASE WHEN status = 'resolved' THEN gen_random_uuid() ELSE occurrence_id END
    WHERE id = v_item.id
    RETURNING * INTO v_item;
    v_reopened := v_item.status = 'active' AND EXISTS (
      SELECT 1 FROM public.alert_item_events e
      WHERE e.alert_item_id = v_item.id AND e.event_type = 'resolved'
        AND e.occurrence_id <> v_item.occurrence_id
    );
  END IF;

  IF v_new_item OR v_reopened THEN
    INSERT INTO public.alert_item_events (
      alert_item_id, occurrence_id, event_type, previous_status, new_status,
      actor_id, metadata
    )
    VALUES (
      v_item.id, v_item.occurrence_id,
      CASE WHEN v_new_item THEN 'opened' ELSE 'opened' END,
      CASE WHEN v_new_item THEN NULL ELSE 'resolved' END,
      'active', auth.uid(), COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING id INTO v_event_id;
    PERFORM public.fanout_alert_item(v_alert.id, v_item.id, v_event_id);
  ELSE
    INSERT INTO public.alert_item_events (
      alert_item_id, occurrence_id, event_type, previous_status, new_status,
      actor_id, metadata
    )
    VALUES (v_item.id, v_item.occurrence_id, 'updated', 'active', 'active', auth.uid(), COALESCE(p_metadata, '{}'::jsonb));
  END IF;

  PERFORM public.refresh_alert_aggregate(v_alert.id);
  RETURN jsonb_build_object('alert_id', v_alert.id, 'item_id', v_item.id, 'event_id', v_event_id, 'reopened', v_reopened);
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_alert_item(
  p_type TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_source TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_item public.alert_items%ROWTYPE;
  v_alert_id BIGINT;
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  SELECT i.* INTO v_item
  FROM public.alert_items i
  JOIN public.alerts a ON a.id = i.alert_id
  WHERE i.item_type = p_type AND a.entity_type = p_entity_type AND a.entity_id = p_entity_id AND i.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT a.id INTO v_alert_id
  FROM public.alerts a
  WHERE a.id = v_item.alert_id;

  UPDATE public.alert_items SET status = 'resolved', updated_at = now(), resolved_at = now() WHERE id = v_item.id;
  INSERT INTO public.alert_item_events (
    alert_item_id, occurrence_id, event_type, previous_status, new_status,
    actor_id, metadata
  ) VALUES (v_item.id, v_item.occurrence_id, 'resolved', 'active', 'resolved', auth.uid(), COALESCE(p_metadata, '{}'::jsonb));
  PERFORM public.refresh_alert_aggregate(v_alert_id);
  RETURN true;
END;
$function$;

-- Compatibility boundary for producers that have not yet moved to the
-- block-specific RPC. Known catalog types are routed into the aggregate so a
-- legacy INSERT cannot create a second queue row for the same entity.
CREATE OR REPLACE FUNCTION public.route_catalog_alert_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.type <> 'aggregate'
     AND NEW.entity_type IS NOT NULL
     AND NEW.entity_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.alert_type_catalog WHERE type = NEW.type AND active)
     AND current_setting('alerts.foundation_direct_insert', true) IS DISTINCT FROM 'on' THEN
    PERFORM public.upsert_alert_item(
      NEW.type, NEW.entity_type, NEW.entity_id, NEW.message,
      'legacy_insert', '{}'::jsonb, NULL
    );
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS route_catalog_alert_insert ON public.alerts;
CREATE TRIGGER route_catalog_alert_insert
  BEFORE INSERT ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION public.route_catalog_alert_insert();

REVOKE ALL ON FUNCTION public.route_catalog_alert_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.route_catalog_alert_insert() TO service_role;

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
  v_dismissal public.alert_item_dismissals%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Motivo da dispensa é obrigatório.' USING ERRCODE = '22023'; END IF;
  IF p_review_at IS NULL OR p_review_at <= now() THEN RAISE EXCEPTION 'A revisão deve ser uma data futura.' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_item FROM public.alert_items WHERE id = p_item_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item de alerta não está ativo.' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO public.alert_item_dismissals(alert_item_id, occurrence_id, reason, dismissed_by, review_at)
  VALUES (v_item.id, v_item.occurrence_id, btrim(p_reason), auth.uid(), p_review_at)
  RETURNING * INTO v_dismissal;

  RETURN jsonb_build_object('id', v_dismissal.id, 'item_id', v_item.id, 'review_at', v_dismissal.review_at);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_alert_queue(p_filter TEXT DEFAULT 'active')
RETURNS SETOF JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  IF p_filter NOT IN ('active', 'dismissed', 'all') THEN RAISE EXCEPTION 'Filtro inválido.' USING ERRCODE = '22023'; END IF;

  RETURN QUERY
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
    'metadata', i.metadata
  )
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
    AND (
      p_filter = 'all'
      OR (p_filter = 'dismissed' AND d.review_at > now())
      OR (p_filter = 'active' AND (d.review_at IS NULL OR d.review_at <= now()))
    )
  ORDER BY (d.review_at > now()) ASC, a.created_at DESC, i.id DESC;

  -- Alertas históricos continuam visíveis até que seus produtores sejam
  -- migrados para alert_items. Eles não podem ser dispensados pela nova
  -- fila, pois não têm occurrence_id nem histórico de dispensa.
  IF p_filter IN ('active', 'all') THEN
    RETURN QUERY
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
      'metadata', '{}'::jsonb
    )
    FROM public.alerts a
    LEFT JOIN public.alert_type_catalog c ON c.type = a.type
    WHERE a.status <> 'closed'
      AND NOT EXISTS (
        SELECT 1 FROM public.alert_items i WHERE i.alert_id = a.id
      )
    ORDER BY a.created_at DESC, a.id DESC;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_internal_notifications(p_include_read BOOLEAN DEFAULT false)
RETURNS SETOF JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'id', n.id, 'alert_id', n.alert_id, 'alert_item_id', n.alert_item_id,
    'item_type', n.item_type, 'severity', n.severity, 'title', n.title,
    'message', n.message, 'entity_type', n.entity_type, 'entity_id', n.entity_id,
    'destination', n.destination, 'is_fallback', n.is_fallback,
    'read_at', n.read_at, 'created_at', n.created_at, 'payload', n.payload
  )
  FROM public.internal_notifications n
  WHERE n.recipient_id = auth.uid() AND (p_include_read OR n.read_at IS NULL)
  ORDER BY n.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.mark_internal_notification_read(p_notification_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  UPDATE public.internal_notifications
  SET read_at = COALESCE(read_at, now())
  WHERE id = p_notification_id AND recipient_id = auth.uid();
  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_alert_item(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_alert_item(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dismiss_alert_item(BIGINT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_alert_queue(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_internal_notifications(BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_internal_notification_read(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_alert_item(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_alert_item(TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dismiss_alert_item(BIGINT, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_alert_queue(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_internal_notifications(BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_internal_notification_read(BIGINT) TO authenticated;

-- Idempotent conversion of known live legacy rows. The old row remains the
-- historical carrier; its type is retained in alert_items and the aggregate
-- is reused on subsequent cycles.
DO $backfill$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT a.type, a.entity_type, a.entity_id, a.message
    FROM public.alerts a
    JOIN public.alert_type_catalog c ON c.type = a.type
    WHERE a.status <> 'closed' AND a.entity_type IS NOT NULL AND a.entity_id IS NOT NULL
    ORDER BY a.id
  LOOP
    PERFORM public.upsert_alert_item(
      v_row.type, v_row.entity_type, v_row.entity_id, v_row.message,
      'foundation_backfill', '{}'::jsonb, NULL
    );
  END LOOP;
END;
$backfill$;

-- The aggregate is unique for rows created by the foundation. Legacy rows
-- outside the catalog remain readable until their block migrates its producer.
WITH duplicates AS (
  SELECT id, row_number() OVER (PARTITION BY entity_type, entity_id ORDER BY id) AS position
  FROM public.alerts
  WHERE type = 'aggregate' AND status <> 'closed'
)
UPDATE public.alerts a
SET status = 'closed', closed_at = COALESCE(a.closed_at, now())
FROM duplicates d
WHERE d.id = a.id AND d.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_foundation_active_entity
  ON public.alerts(entity_type, entity_id)
  WHERE type = 'aggregate' AND status <> 'closed';

COMMENT ON TABLE public.internal_notifications IS
  'Notificação Interna: cópia congelada por destinatário; RLS por destinatário.';
