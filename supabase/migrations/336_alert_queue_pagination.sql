-- 336: paginação da fila coletiva sem alterar a assinatura legada.

CREATE OR REPLACE FUNCTION public.list_alert_queue_page(
  p_filter TEXT DEFAULT 'active',
  p_entity_type TEXT DEFAULT NULL,
  p_offset INTEGER DEFAULT 0,
  p_limit INTEGER DEFAULT 100
)
RETURNS SETOF JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  IF p_filter NOT IN ('active', 'dismissed', 'all') THEN RAISE EXCEPTION 'Filtro inválido.' USING ERRCODE = '22023'; END IF;
  IF p_offset < 0 OR p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'Paginação inválida.' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
  WITH queue_rows AS (
    SELECT jsonb_build_object('id', a.id, 'item_id', i.id, 'status', a.status, 'item_status', i.status,
      'type', i.item_type, 'severity', i.severity, 'department', i.department, 'message', i.message,
      'entity_type', a.entity_type, 'entity_id', a.entity_id, 'destination', i.destination,
      'created_at', a.created_at, 'updated_at', i.updated_at, 'dismissed_until', d.review_at, 'metadata', i.metadata) AS payload,
      (d.review_at > now()) AS is_dismissed, a.created_at, i.id AS item_id
    FROM public.alerts a
    JOIN public.alert_items i ON i.alert_id = a.id AND i.status = 'active'
    LEFT JOIN LATERAL (SELECT ad.review_at FROM public.alert_item_dismissals ad WHERE ad.alert_item_id = i.id AND ad.occurrence_id = i.occurrence_id ORDER BY ad.dismissed_at DESC LIMIT 1) d ON true
    WHERE a.status <> 'closed' AND (p_filter = 'all' OR (p_filter = 'dismissed' AND d.review_at > now()) OR (p_filter = 'active' AND (d.review_at IS NULL OR d.review_at <= now())))
      AND (p_entity_type IS NULL OR a.entity_type = p_entity_type)
    UNION ALL
    SELECT jsonb_build_object('id', a.id, 'item_id', NULL, 'status', a.status, 'item_status', NULL, 'type', a.type,
      'severity', COALESCE(c.severity, 'normal'), 'department', c.responsible_department, 'message', a.message,
      'entity_type', a.entity_type, 'entity_id', a.entity_id, 'destination', c.default_destination,
      'created_at', a.created_at, 'updated_at', a.created_at, 'dismissed_until', NULL, 'metadata', '{}'::jsonb) AS payload,
      false AS is_dismissed, a.created_at, a.id AS item_id
    FROM public.alerts a LEFT JOIN public.alert_type_catalog c ON c.type = a.type
    WHERE p_filter IN ('active', 'all') AND a.status <> 'closed' AND (p_entity_type IS NULL OR a.entity_type = p_entity_type)
      AND NOT EXISTS (SELECT 1 FROM public.alert_items i WHERE i.alert_id = a.id)
  )
  SELECT payload FROM queue_rows ORDER BY is_dismissed ASC, created_at DESC, item_id DESC OFFSET p_offset LIMIT p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_alert_queue_page(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_alert_queue_page(TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
