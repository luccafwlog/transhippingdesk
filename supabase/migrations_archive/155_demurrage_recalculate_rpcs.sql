-- Renumbered from 20260624122000 (original timestamped migration: 20260624122000_demurrage_recalculate_rpcs.sql).
-- Demurrage Fase 1.3/1.4 — Recálculo diário do valor em BRL (ADR 0014).
-- Intent: para cada fatura emitida e não paga, recalcular current_total_brl com a
--   PTAX mais recente, gravar a foto em demurrage_invoice_history e regenerar o QR
--   PIX — somente quando a PTAX (ROE) muda. O USD é travado na emissão; o recálculo
--   nunca recomputa dias.
-- Escopo: aditivo (novas funções). Núcleo roda como service_role (cron/Edge);
--   wrapper manual exige usuário autenticado ativo.
-- Rollback: DROP das duas funções.

-- 1.065 = spread fixo do armador (ponto canônico no backend; ver ADR 0014).
CREATE OR REPLACE FUNCTION public.recalculate_demurrage_invoices(
  p_ptax        NUMERIC,
  p_quote_date  DATE,
  p_source      TEXT DEFAULT 'bcb_live'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_roe NUMERIC; v_updated INT := 0; v_inv RECORD;
  v_total_brl NUMERIC(14,2); v_pix_payload TEXT; v_discount_usd NUMERIC(12,2);
BEGIN
  IF p_ptax IS NULL OR p_ptax <= 0 OR p_quote_date IS NULL THEN
    RAISE EXCEPTION 'PTAX e data de cotacao sao obrigatorias.' USING ERRCODE = '22023';
  END IF;
  IF p_source NOT IN ('bcb_live', 'cached', 'manual') THEN
    RAISE EXCEPTION 'Origem de PTAX invalida: %.', p_source USING ERRCODE = '22023';
  END IF;

  v_roe := ROUND(p_ptax * 1.065, 4);

  FOR v_inv IN
    SELECT id, total_usd, COALESCE(discount_value, 0) AS discount_value,
           discount_mode, doc_number, current_roe
    FROM public.demurrage_invoices
    WHERE status = 'issued' AND paid_at IS NULL
    FOR UPDATE
  LOOP
    -- Só recalcula quando a PTAX (roe) realmente mudou.
    CONTINUE WHEN v_inv.current_roe IS NOT NULL AND v_inv.current_roe = v_roe;

    v_discount_usd := 0;
    IF v_inv.discount_value > 0 THEN
      IF v_inv.discount_mode = 'percent'
        THEN v_discount_usd := ROUND(v_inv.total_usd * (v_inv.discount_value / 100), 2);
        ELSE v_discount_usd := v_inv.discount_value;   -- fixo em USD
      END IF;
    END IF;

    v_total_brl   := ROUND((v_inv.total_usd - v_discount_usd) * v_roe, 2);
    v_pix_payload := public.build_transshipping_pix_payload(v_total_brl, v_inv.doc_number);

    UPDATE public.demurrage_invoices
    SET current_roe = v_roe, current_total_brl = v_total_brl,
        roe_source = p_source, pix_payload = v_pix_payload, updated_at = now()
    WHERE id = v_inv.id;

    INSERT INTO public.demurrage_invoice_history
      (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
    VALUES
      (v_inv.id, p_quote_date, p_ptax, v_roe, v_inv.total_usd, v_total_brl, v_discount_usd, p_source);

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated, 'roe', v_roe, 'quote_date', p_quote_date);
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_demurrage_invoices(NUMERIC, DATE, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_demurrage_invoices(NUMERIC, DATE, TEXT) TO service_role;

-- Wrapper manual (autenticado): usado pelo botão "Informar PTAX" quando o BCB
-- está fora ou o job falhou. Registra como 'manual' na data corrente.
CREATE OR REPLACE FUNCTION public.recalculate_demurrage_invoices_manual(p_ptax NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  RETURN public.recalculate_demurrage_invoices(p_ptax, CURRENT_DATE, 'manual');
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_demurrage_invoices_manual(NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_demurrage_invoices_manual(NUMERIC) TO authenticated;
