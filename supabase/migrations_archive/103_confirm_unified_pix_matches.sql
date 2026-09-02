-- Renumbered from 20260612161000 (original timestamped migration: 20260612161000_confirm_unified_pix_matches.sql).
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
  v_expected_amount NUMERIC;
  v_demurrage_updates JSONB := '[]'::jsonb;
  v_updated_demurrage INTEGER := 0;
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
      v_result := public.reconcile_invoice_payment_by_txid(
        v_item.txid,
        v_item.amount,
        v_item.paid_at
      );

      IF COALESCE((v_result->>'matched')::BOOLEAN, false) IS NOT TRUE
         OR COALESCE((v_result->>'settled')::BOOLEAN, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Falha ao conciliar fatura local %: %.',
          COALESCE(v_item.doc_number, v_item.txid),
          COALESCE(v_result->>'reason', 'erro desconhecido')
          USING ERRCODE = 'P0001';
      END IF;

      v_local_count := v_local_count + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'source', 'local',
        'invoice_id', v_item.invoice_id,
        'doc_number', v_item.doc_number,
        'status', 'ok'
      ));
    ELSIF v_item.source = 'demurrage' THEN
      SELECT frozen_total_brl
      INTO v_expected_amount
      FROM public.demurrage_invoices
      WHERE id = v_item.invoice_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Demurrage % nao encontrada.', v_item.doc_number USING ERRCODE = 'P0002';
      END IF;

      IF ABS(COALESCE(v_item.amount, 0) - COALESCE(v_expected_amount, 0)) > 0.01 THEN
        RAISE EXCEPTION 'Valor divergente para demurrage %.', v_item.doc_number USING ERRCODE = '22003';
      END IF;

      v_demurrage_updates := v_demurrage_updates || jsonb_build_array(jsonb_build_object(
        'invoice_id', v_item.invoice_id,
        'paid_at', (v_item.paid_at AT TIME ZONE 'UTC')::date,
        'pix_txid', v_item.txid
      ));
      v_demurrage_count := v_demurrage_count + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'source', 'demurrage',
        'invoice_id', v_item.invoice_id,
        'doc_number', v_item.doc_number,
        'status', 'ok'
      ));
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

  RETURN jsonb_build_object(
    'local', v_local_count,
    'demurrage', v_demurrage_count,
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_unified_pix_matches(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_unified_pix_matches(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_demurrage_pix_matches(JSONB) TO authenticated;
