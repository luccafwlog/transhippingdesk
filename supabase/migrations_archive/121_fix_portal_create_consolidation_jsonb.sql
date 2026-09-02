-- Renumbered from 20260615200000 (original timestamped migration: 20260615200000_fix_portal_create_consolidation_jsonb.sql).
-- Fix: portal consolidation failed with "Falha ao consolidar cobrancas".
--
-- 20260615000004_portal_fase3_rate_limiting.sql redefined
-- portal_create_consolidation to call create_local_consolidated_invoice_core
-- with "SELECT ... INTO v_invoice_id", where v_invoice_id is BIGINT. But the
-- core function RETURNS jsonb (e.g. {"invoice_id": 42, "invoice_number": ...}),
-- so assigning that jsonb object into a bigint variable raises at runtime and
-- the whole consolidation rolls back.
--
-- Capture the jsonb result, extract invoice_id from it, and return the full
-- object (the portal frontend reads payload.invoice_id). Rate limiting, the
-- operations alert and the customer notification are preserved.
--
-- Rollback: restore the definition from
-- 20260615000004_portal_fase3_rate_limiting.sql.

CREATE OR REPLACE FUNCTION public.portal_create_consolidation(p_receivable_ids BIGINT[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_result JSONB;
  v_invoice_id BIGINT;
BEGIN
  PERFORM public.check_portal_rate_limit('create_consolidation', 3, 10);

  v_result := public.create_local_consolidated_invoice_core(
    v_customer_id,
    p_receivable_ids,
    auth.uid(),
    'portal'
  );

  v_invoice_id := (v_result->>'invoice_id')::BIGINT;

  INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
  VALUES (
    'portal_invoice_created',
    'invoice',
    v_invoice_id::text,
    'Cliente gerou fatura consolidada #' || v_invoice_id || ' com ' || array_length(p_receivable_ids, 1) || ' B/L(s).',
    'open'
  );

  INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
  VALUES (
    v_customer_id,
    'system',
    'Fatura consolidada criada',
    'Sua fatura consolidada foi gerada com ' || array_length(p_receivable_ids, 1) || ' B/L(s).',
    '/portal/billing'
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.portal_create_consolidation(BIGINT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_create_consolidation(BIGINT[]) TO authenticated;
