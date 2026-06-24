-- Demurrage Fase 8 — Portal push: expor data/PTAX de referência do último recálculo.
-- Intent: o portal exibe sempre o último recálculo armazenado (push), com USD fixo
--   (total_usd) e BRL dinâmico (current_total_brl) e a data/fonte de referência.
--   portal_get_demurrage_invoice_detail já retorna di.* (inclui updated_at/roe_source);
--   aqui só ampliamos a lista. Sem recálculo on-demand (ADR 0014).
-- Escopo: aditivo (mais colunas no JSON da lista). CREATE OR REPLACE preserva grants.
-- Rollback: restaurar portal_list_demurrage_invoices de 20260624121000.

CREATE OR REPLACE FUNCTION public.portal_list_demurrage_invoices()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint := public.current_portal_customer_id();
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.doc_date DESC), '[]'::jsonb)
    FROM (
      SELECT
        di.id, di.doc_number, di.doc_date, di.due_date, di.billed_at, di.paid_at,
        di.total_usd, di.current_roe, di.current_total_brl, di.roe_source, di.updated_at,
        di.status, di.pix_payload,
        di.dispute_open, di.discount_type, di.discount_value, di.discount_mode,
        b.id AS bl_id, b.pol, b.pod, v.voyage_number, vs.name AS vessel_name
      FROM public.demurrage_invoices di
      JOIN public.bls b ON b.id = di.bl_id
      LEFT JOIN public.voyages v ON v.id = b.voyage_id
      LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
      WHERE di.customer_id = v_customer_id AND di.status IN ('issued', 'overdue', 'paid') AND public.bl_has_portal_release(di.bl_id)
    ) t
  );
END;
$function$;
