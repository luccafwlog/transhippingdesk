-- Migration 033: Portal demurrage RPCs — list invoices and detail with line items

-- ── portal_list_demurrage_invoices ────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_list_demurrage_invoices(
  p_session_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_id BIGINT;
BEGIN
  SELECT customer_id INTO v_customer_id
  FROM public.resolve_customer_portal_session(p_session_token);

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida ou expirada' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.doc_date DESC), '[]'::jsonb)
    FROM (
      SELECT
        di.id,
        di.doc_number,
        di.doc_date,
        di.due_date,
        di.billed_at,
        di.paid_at,
        di.total_usd,
        di.frozen_roe,
        di.frozen_total_brl,
        di.status,
        di.pix_payload,
        di.dispute_open,
        di.discount_type,
        di.discount_value,
        di.discount_mode,
        b.id AS bl_id,
        b.pol,
        b.pod,
        v.voyage_number,
        vs.name AS vessel_name
      FROM public.demurrage_invoices di
      JOIN public.bls b ON b.id = di.bl_id
      LEFT JOIN public.voyages v ON v.id = b.voyage_id
      LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
      WHERE di.customer_id = v_customer_id
        AND di.status IN ('issued', 'overdue', 'paid')
    ) t
  );
END;
$$;

REVOKE ALL ON FUNCTION public.portal_list_demurrage_invoices(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_list_demurrage_invoices(TEXT) TO anon, authenticated;

-- ── portal_get_demurrage_invoice_detail ───────────────────────────
CREATE OR REPLACE FUNCTION public.portal_get_demurrage_invoice_detail(
  p_session_token TEXT,
  p_invoice_id    BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_id BIGINT;
  v_invoice     JSONB;
  v_items       JSONB;
BEGIN
  SELECT customer_id INTO v_customer_id
  FROM public.resolve_customer_portal_session(p_session_token);

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida ou expirada' USING ERRCODE = '42501';
  END IF;

  SELECT row_to_json(t)::jsonb INTO v_invoice
  FROM (
    SELECT
      di.*,
      c.name  AS customer_name,
      c.cnpj_cpf AS customer_cnpj_cpf,
      b.pol,
      b.pod,
      v.voyage_number,
      vs.name AS vessel_name
    FROM public.demurrage_invoices di
    JOIN public.customers c ON c.id = di.customer_id
    JOIN public.bls b ON b.id = di.bl_id
    LEFT JOIN public.voyages v ON v.id = b.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE di.id = p_invoice_id
      AND di.customer_id = v_customer_id
      AND di.status IN ('issued', 'overdue', 'paid')
  ) t;

  IF v_invoice IS NULL THEN
    RAISE EXCEPTION 'Invoice % nao encontrada ou acesso negado', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.id), '[]'::jsonb) INTO v_items
  FROM (
    SELECT *
    FROM public.demurrage_invoice_items
    WHERE invoice_id = p_invoice_id
  ) t;

  RETURN jsonb_build_object('invoice', v_invoice, 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_get_demurrage_invoice_detail(TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_get_demurrage_invoice_detail(TEXT, BIGINT) TO anon, authenticated;
