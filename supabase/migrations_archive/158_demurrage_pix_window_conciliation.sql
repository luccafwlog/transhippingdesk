-- Renumbered from 20260624140000 (original timestamped migration: 20260624140000_demurrage_pix_window_conciliation.sql).
-- Demurrage Fase 7 — Conciliação PIX por txid + janela das duas PTAX (ADR 0015).
-- Intent: o QR PIX é estático e regenerado quando a PTAX muda; o cliente pode
--   pagar com um QR de um dia anterior. A conciliação identifica a fatura pelo
--   txid (= doc_number) e valida o valor pago contra as DUAS entradas de recálculo
--   mais recentes em demurrage_invoice_history com event_date <= data do pagamento.
--   No pagamento, congela o valor casado (source='payment') e encerra o recálculo.
-- Escopo: reescrita da validação de valor (antes contra current_total_brl único).
-- Rollback: restaurar confirm_demurrage_pix_matches e confirm_unified_pix_matches
--   das migrações 20260610094207 e 20260624121000; DROP get_demurrage_recent_values.

-- 7.1 — Janela das duas PTAX mais recentes na/antes da data do pagamento.
CREATE OR REPLACE FUNCTION public.get_demurrage_recent_values(p_invoice_id BIGINT, p_date DATE)
RETURNS TABLE(total_brl NUMERIC, event_date DATE, ptax_used NUMERIC)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT total_brl, event_date, ptax_used
  FROM public.demurrage_invoice_history
  WHERE invoice_id = p_invoice_id AND event_date <= p_date
  ORDER BY event_date DESC, id DESC
  LIMIT 2;
$$;

REVOKE ALL ON FUNCTION public.get_demurrage_recent_values(BIGINT, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_demurrage_recent_values(BIGINT, DATE) TO authenticated;

-- 7.3 — Lote de baixa: congela o valor casado, encerra o recálculo (paid_at) e
-- grava a foto de pagamento no histórico. Recebe total_brl/ptax_used já validados.
CREATE OR REPLACE FUNCTION public.confirm_demurrage_pix_matches(p_matches jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer := 0;
  r RECORD;
  v_roe NUMERIC(10,4);
BEGIN
  FOR r IN
    SELECT (m->>'invoice_id')::bigint AS invoice_id,
           (m->>'paid_at')::date      AS paid_at,
           NULLIF(m->>'pix_txid', '') AS pix_txid,
           (m->>'total_brl')::numeric AS total_brl,
           (m->>'ptax_used')::numeric AS ptax_used
    FROM jsonb_array_elements(p_matches) AS m
  LOOP
    v_roe := ROUND(COALESCE(r.ptax_used, 0) * 1.065, 4);

    UPDATE public.demurrage_invoices d
    SET status = 'paid',
        paid_at = r.paid_at,
        pix_txid = r.pix_txid,
        conciliated_by_extract = true,
        current_total_brl = COALESCE(r.total_brl, d.current_total_brl),
        current_roe = CASE WHEN v_roe > 0 THEN v_roe ELSE d.current_roe END
    WHERE d.id = r.invoice_id;

    IF FOUND THEN
      INSERT INTO public.demurrage_invoice_history
        (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
      SELECT d.id, r.paid_at,
             COALESCE(r.ptax_used, ROUND(d.current_roe / 1.065, 4)),
             COALESCE(NULLIF(v_roe, 0), d.current_roe),
             d.total_usd,
             COALESCE(r.total_brl, d.current_total_brl),
             GREATEST(0, ROUND(d.total_usd - COALESCE(r.total_brl, d.current_total_brl) / NULLIF(COALESCE(NULLIF(v_roe, 0), d.current_roe), 0), 2)),
             'payment'
      FROM public.demurrage_invoices d
      WHERE d.id = r.invoice_id;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_demurrage_pix_matches(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_demurrage_pix_matches(jsonb) TO authenticated;

-- 7.2 — Wrapper unificado: valida o valor da demurrage pela janela das duas PTAX
-- ancorada na data do pagamento; casa por txid (já feito no frontend por doc_number).
CREATE OR REPLACE FUNCTION public.confirm_unified_pix_matches(p_matches JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item RECORD;
  v_result JSONB;
  v_items JSONB := '[]'::jsonb;
  v_local_count INTEGER := 0;
  v_demurrage_count INTEGER := 0;
  v_demurrage_updates JSONB := '[]'::jsonb;
  v_updated_demurrage INTEGER := 0;
  v_paid_date DATE;
  v_match_brl NUMERIC;
  v_match_ptax NUMERIC;
BEGIN
  FOR v_item IN
    SELECT *
    FROM jsonb_to_recordset(p_matches) AS row(
      source TEXT,
      invoice_id BIGINT,
      doc_number TEXT,
      txid TEXT,
      amount NUMERIC,
      expected_amount NUMERIC,
      paid_at TIMESTAMPTZ
    )
  LOOP
    IF v_item.paid_at IS NULL THEN
      RAISE EXCEPTION 'Data do extrato nao parseada para %.', COALESCE(v_item.doc_number, v_item.txid, v_item.invoice_id::TEXT)
        USING ERRCODE = '22007';
    END IF;

    IF v_item.source = 'local' THEN
      v_result := public.reconcile_invoice_payment_by_txid(v_item.txid, v_item.amount, v_item.paid_at);
      IF COALESCE((v_result->>'matched')::BOOLEAN, false) IS NOT TRUE
         OR COALESCE((v_result->>'settled')::BOOLEAN, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Falha ao conciliar fatura local %: %.',
          COALESCE(v_item.doc_number, v_item.txid),
          COALESCE(v_result->>'reason', 'erro desconhecido')
          USING ERRCODE = 'P0001';
      END IF;
      v_local_count := v_local_count + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'source', 'local', 'invoice_id', v_item.invoice_id, 'doc_number', v_item.doc_number, 'status', 'ok'));

    ELSIF v_item.source = 'demurrage' THEN
      v_paid_date := (v_item.paid_at AT TIME ZONE 'UTC')::date;

      -- Janela das duas PTAX mais recentes com event_date <= data do pagamento.
      SELECT w.total_brl, w.ptax_used
      INTO v_match_brl, v_match_ptax
      FROM public.get_demurrage_recent_values(v_item.invoice_id, v_paid_date) AS w
      WHERE ABS(w.total_brl - COALESCE(v_item.amount, 0)) <= 0.01
      ORDER BY w.event_date DESC
      LIMIT 1;

      IF NOT FOUND THEN
        -- Fallback: sem histórico (legado) compara com o valor corrente.
        SELECT d.current_total_brl, ROUND(d.current_roe / 1.065, 4)
        INTO v_match_brl, v_match_ptax
        FROM public.demurrage_invoices d
        WHERE d.id = v_item.invoice_id
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Demurrage % nao encontrada.', v_item.doc_number USING ERRCODE = 'P0002';
        END IF;
        IF v_match_brl IS NULL OR ABS(v_match_brl - COALESCE(v_item.amount, 0)) > 0.01 THEN
          RAISE EXCEPTION 'Valor divergente para demurrage %.', v_item.doc_number USING ERRCODE = '22003';
        END IF;
      END IF;

      v_demurrage_updates := v_demurrage_updates || jsonb_build_array(jsonb_build_object(
        'invoice_id', v_item.invoice_id,
        'paid_at', v_paid_date,
        'pix_txid', v_item.txid,
        'total_brl', v_match_brl,
        'ptax_used', v_match_ptax));
      v_demurrage_count := v_demurrage_count + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'source', 'demurrage', 'invoice_id', v_item.invoice_id, 'doc_number', v_item.doc_number, 'status', 'ok'));
    ELSE
      RAISE EXCEPTION 'Origem de conciliacao PIX invalida: %.', v_item.source USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF v_demurrage_count > 0 THEN
    v_updated_demurrage := public.confirm_demurrage_pix_matches(v_demurrage_updates);
    IF v_updated_demurrage <> v_demurrage_count THEN
      RAISE EXCEPTION 'Conciliacao de demurrage atualizou % de % faturas.', v_updated_demurrage, v_demurrage_count
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN jsonb_build_object('local', v_local_count, 'demurrage', v_demurrage_count, 'items', v_items);
END;
$$;
