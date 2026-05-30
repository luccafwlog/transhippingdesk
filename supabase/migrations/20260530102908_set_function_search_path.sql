-- Migration: fixar search_path nas funções sinalizadas pelo lint 0011
--
-- Intent: prevenir sequestro de search_path em funções (várias SECURITY DEFINER).
-- Affected: 11 funções em `public` listadas pelo advisor de segurança.
-- Breaking?: não — apenas define search_path explícito.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'normalize_document_text',
        'resolve_local_charge_table_id',
        'set_container_discharge_date',
        'touch_demurrage_invoice_updated_at',
        'set_updated_at',
        'assign_invoice_number',
        'prevent_pending_review_invoice',
        'validate_vehicle_relationships',
        'validate_bl_breakbulk_item_parent',
        'detect_overdue_invoices',
        'normalize_port_code'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.sig);
  END LOOP;
END $$;

-- Rollback:
--   ALTER FUNCTION public.<fn>(<args>) RESET search_path;  -- por função
