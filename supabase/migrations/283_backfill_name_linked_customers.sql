-- Migration 283: devolver para revisao os vinculos automaticos feitos por nome.
--
-- Diagnostico somente-leitura recomendado antes de aplicar este arquivo:
--   SELECT count(*) FROM public.bls
--   WHERE customer_reconciliation_status = 'matched_name'
--     AND customer_id IS NOT NULL AND suggested_customer_id IS NULL
--     AND COALESCE(financial_status, 'pending') <> 'invoiced';
--   SELECT count(*) FROM public.granite_bls g
--   JOIN public.customers c ON c.id = g.client_id
--   WHERE g.client_id IS NOT NULL AND g.suggested_client_id IS NULL
--     AND regexp_replace(COALESCE(g.shipper_cnpj, ''), '\D', '', 'g')
--         IS DISTINCT FROM regexp_replace(COALESCE(c.cnpj_cpf, ''), '\D', '', 'g')
--     AND NOT EXISTS (SELECT 1 FROM public.invoice_granite_bls i WHERE i.granite_bl_id = g.id)
--     AND COALESCE(g.charge_status, 'not_calculated') <> 'invoiced';
-- Preserve invoiced rows and rows with a human decision. The predicates below
-- are deliberately idempotent: a second run finds no row with a null suggestion.

SET search_path = public, pg_temp;

DO $$
DECLARE
  v_bl RECORD;
BEGIN
  FOR v_bl IN
    SELECT b.id, b.customer_id
    FROM public.bls AS b
    WHERE b.customer_reconciliation_status = 'matched_name'
      AND b.customer_id IS NOT NULL
      AND b.suggested_customer_id IS NULL
      AND COALESCE(b.financial_status, 'pending') <> 'invoiced'
  LOOP
    UPDATE public.bls
    SET suggested_customer_id = v_bl.customer_id,
        customer_id = NULL,
        review_status = 'pending_review',
        billing_hold_reason = 'Cliente sugerido por nome; confirme o documento'
    WHERE id = v_bl.id
      AND customer_reconciliation_status = 'matched_name'
      AND customer_id = v_bl.customer_id
      AND suggested_customer_id IS NULL
      AND COALESCE(financial_status, 'pending') <> 'invoiced';

    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl.id);
  END LOOP;
END $$;

DO $$
DECLARE
  v_granite RECORD;
BEGIN
  FOR v_granite IN
    SELECT g.id, g.client_id
    FROM public.granite_bls AS g
    JOIN public.customers AS c ON c.id = g.client_id
    WHERE g.client_id IS NOT NULL
      AND g.suggested_client_id IS NULL
      AND regexp_replace(COALESCE(g.shipper_cnpj, ''), '\D', '', 'g')
          IS DISTINCT FROM regexp_replace(COALESCE(c.cnpj_cpf, ''), '\D', '', 'g')
      AND NOT EXISTS (
        SELECT 1 FROM public.audit_logs AS a
        WHERE a.entity_type = 'granite_bl'
          AND a.entity_id = g.id::text
          AND a.field_name = 'client_id'
          AND a.new_value = g.client_id::text
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.invoice_granite_bls AS i
        WHERE i.granite_bl_id = g.id
      )
      AND COALESCE(g.charge_status, 'not_calculated') <> 'invoiced'
  LOOP
    UPDATE public.granite_bls
    SET suggested_client_id = v_granite.client_id,
        client_id = NULL
    WHERE id = v_granite.id
      AND client_id = v_granite.client_id
      AND suggested_client_id IS NULL
      AND COALESCE(charge_status, 'not_calculated') <> 'invoiced'
      AND NOT EXISTS (
        SELECT 1 FROM public.invoice_granite_bls AS i
        WHERE i.granite_bl_id = v_granite.id
      );
  END LOOP;
END $$;

RESET search_path;
