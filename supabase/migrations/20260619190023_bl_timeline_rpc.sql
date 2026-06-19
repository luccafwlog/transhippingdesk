-- 20260619190023_bl_timeline_rpc.sql
--
-- Intent: expose a single read-only timeline of everything that happened to a
-- B/L (the "Histórico" tab). audit_logs rows live under heterogeneous keys, so
-- this function UNIONs the families that resolve to a B/L:
--   * entity_type='bl'             -> entity_id = bls.id (also covers field
--                                     changes like charge_status / financial_status
--                                     / customer_id, which are logged on the B/L)
--   * entity_type='bl_container'   -> bl_containers.id (resolved to bl_id)
--   * entity_type='charge_calculation' -> charge_calculations.id (resolved to bl_id)
--   * entity_type='invoice'        -> invoices.id (resolved via invoice_bls)
--   * entity_type='system_event'   -> only when entity_id IS the bl id
--                                     (e.g. bl_review_concurrent_conflict); the
--                                     generic global events (entity_id='billing')
--                                     are intentionally excluded.
-- Customer/voyage/schedule events are NOT BL-scoped and are excluded; customer
-- linking is already recorded under entity_type='bl' (field customer_id).
--
-- Additive, read-only. No table/column changes.
--
-- Security: SECURITY DEFINER with a controlled search_path and an is_active_user()
-- guard. This exposes a STRICT SUBSET of what the caller can already read: the
-- audit_logs_select_active policy already grants every active user SELECT on all
-- of audit_logs, so filtering to one B/L (resolving entity_id via joins the caller
-- might not otherwise read) adds no new exposure. PUBLIC/anon are revoked; only
-- authenticated may execute.
--
-- Rollback: DROP FUNCTION public.bl_timeline(TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.bl_timeline(
  p_bl_id TEXT,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id BIGINT,
  family TEXT,
  entity_type TEXT,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  changed_by UUID,
  changed_at TIMESTAMPTZ,
  justification TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    a.id,
    CASE
      WHEN a.entity_type = 'invoice' THEN 'fatura'
      WHEN a.entity_type = 'charge_calculation' THEN 'taxas'
      WHEN a.entity_type = 'bl_container' THEN 'container'
      WHEN a.entity_type = 'system_event' THEN 'sistema'
      WHEN a.entity_type = 'bl' AND a.field_name = 'charge_status' THEN 'taxas'
      WHEN a.entity_type = 'bl' AND a.field_name IN ('financial_status', 'billing_hold_reason', 'last_billing_run_id') THEN 'fatura'
      ELSE 'edicao'
    END AS family,
    a.entity_type,
    a.field_name,
    a.old_value,
    a.new_value,
    a.changed_by,
    a.changed_at,
    a.justification
  FROM public.audit_logs a
  WHERE public.is_active_user()
    AND (
         (a.entity_type = 'bl' AND a.entity_id = p_bl_id)
      OR (a.entity_type = 'bl_container' AND a.entity_id IN (
            SELECT c.id::text FROM public.bl_containers c WHERE c.bl_id = p_bl_id))
      OR (a.entity_type = 'charge_calculation' AND a.entity_id IN (
            SELECT cc.id::text FROM public.charge_calculations cc WHERE cc.bl_id = p_bl_id))
      OR (a.entity_type = 'invoice' AND a.entity_id IN (
            SELECT ib.invoice_id::text FROM public.invoice_bls ib WHERE ib.bl_id = p_bl_id))
      OR (a.entity_type = 'system_event' AND a.entity_id = p_bl_id)
    )
  ORDER BY a.changed_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 50), 0)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.bl_timeline(TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bl_timeline(TEXT, INT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.bl_timeline(TEXT, INT, INT) TO authenticated;
