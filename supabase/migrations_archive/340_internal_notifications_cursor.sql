-- Cursor estável para a listagem de notificações internas.
-- O offset permitia saltos e duplicações quando a lista de não lidas mudava
-- entre páginas (por leitura ou pela chegada de uma nova notificação).

DROP FUNCTION IF EXISTS public.list_internal_notifications(BOOLEAN, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.list_internal_notifications(
  p_include_read BOOLEAN DEFAULT false,
  p_limit INTEGER DEFAULT 20,
  p_before_created_at TIMESTAMPTZ DEFAULT NULL,
  p_before_id BIGINT DEFAULT NULL
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
    AND (
      p_before_created_at IS NULL
      OR n.created_at < p_before_created_at
      OR (n.created_at = p_before_created_at AND n.id < p_before_id)
    )
  ORDER BY n.created_at DESC, n.id DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));
$$;

REVOKE ALL ON FUNCTION public.list_internal_notifications(BOOLEAN, INTEGER, TIMESTAMPTZ, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_internal_notifications(BOOLEAN, INTEGER, TIMESTAMPTZ, BIGINT) TO authenticated;
