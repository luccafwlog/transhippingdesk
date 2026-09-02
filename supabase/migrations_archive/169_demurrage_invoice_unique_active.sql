-- Demurrage — impede faturas ativas duplicadas por B/L.
-- Intent: manter a regra "uma fatura issued/paid por B/L" no banco, cobrindo
-- concorrência e qualquer caminho de escrita que não passe pelo client.
-- Rollback: remover o índice uq_demurrage_invoices_active_bl e restaurar a
-- função da migration 156.

DO $$
DECLARE
  v_dupes TEXT;
BEGIN
  SELECT string_agg(bl_id, ', ')
  INTO v_dupes
  FROM (
    SELECT bl_id
    FROM public.demurrage_invoices
    WHERE status IN ('issued', 'paid')
    GROUP BY bl_id
    HAVING COUNT(*) > 1
  ) d;
  IF v_dupes IS NOT NULL THEN
    RAISE EXCEPTION 'Faturas de Demurrage ativas duplicadas para B/L(s): %. Cancele as duplicatas antes de aplicar esta migration.', v_dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_demurrage_invoices_active_bl
  ON public.demurrage_invoices (bl_id)
  WHERE status IN ('issued', 'paid');

DROP FUNCTION IF EXISTS public.create_demurrage_invoice_with_items(
  TEXT, TEXT, BIGINT, NUMERIC, DATE, DATE, BOOLEAN, NUMERIC, JSONB
);

CREATE OR REPLACE FUNCTION public.create_demurrage_invoice_with_items(
  p_doc_number TEXT,
  p_bl_id TEXT,
  p_customer_id BIGINT,
  p_total_usd NUMERIC,
  p_ready_at DATE,
  p_roe_manual BOOLEAN,
  p_roe NUMERIC,
  p_current_roe NUMERIC,
  p_roe_source TEXT,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice_id BIGINT;
  v_customer_id BIGINT;
  v_item_count INTEGER;
  v_invalid_container_count INTEGER;
  v_item_total NUMERIC(14,2);
  v_total_brl NUMERIC(14,2);
  v_pix_payload TEXT;
  v_ptax NUMERIC(10,4);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_doc_number, '')), '') IS NULL
     OR NULLIF(TRIM(COALESCE(p_bl_id, '')), '') IS NULL
     OR p_customer_id IS NULL
     OR COALESCE(p_total_usd, 0) <= 0
     OR p_current_roe IS NULL OR p_current_roe <= 0
     OR p_roe_source NOT IN ('bcb_live', 'cached', 'manual')
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Dados invalidos para criar invoice de Demurrage.' USING ERRCODE = '22023';
  END IF;

  SELECT b.customer_id
  INTO v_customer_id
  FROM public.bls b
  WHERE b.id = p_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.demurrage_invoices di
    WHERE di.bl_id = p_bl_id AND di.status IN ('issued', 'paid')
  ) THEN
    RAISE EXCEPTION 'Ja existe fatura de Demurrage emitida ou paga para o B/L %. Cancele a fatura atual antes de reemitir.', p_bl_id
      USING ERRCODE = '23505';
  END IF;

  IF v_customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'Cliente informado nao corresponde ao cliente do B/L %.', p_bl_id USING ERRCODE = '22023';
  END IF;

  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE bc.id IS NULL OR bc.bl_id IS DISTINCT FROM p_bl_id)::INTEGER,
    COALESCE(SUM(item.subtotal_usd), 0)
  INTO v_item_count, v_invalid_container_count, v_item_total
  FROM jsonb_to_recordset(p_items) AS item(
    container_id BIGINT,
    container_number TEXT,
    container_type TEXT,
    discharge_date DATE,
    return_date DATE,
    total_days INTEGER,
    free_days INTEGER,
    days_p1 INTEGER,
    rate_p1_usd NUMERIC,
    days_p2 INTEGER,
    rate_p2_usd NUMERIC,
    subtotal_usd NUMERIC
  )
  LEFT JOIN public.bl_containers bc ON bc.id = item.container_id;

  IF v_item_count = 0 OR v_invalid_container_count > 0 THEN
    RAISE EXCEPTION 'Itens de Demurrage invalidos para o B/L %.', p_bl_id USING ERRCODE = '22023';
  END IF;

  IF ABS(v_item_total - p_total_usd) > 0.01 THEN
    RAISE EXCEPTION 'Total dos itens diverge do total da invoice de Demurrage.' USING ERRCODE = '22023';
  END IF;

  -- Sem desconto na criação (descontos são aplicados depois, em USD).
  v_total_brl := ROUND(p_total_usd * p_current_roe, 2);
  v_pix_payload := public.build_transshipping_pix_payload(v_total_brl, TRIM(p_doc_number));
  v_ptax := ROUND(p_current_roe / 1.065, 4);

  INSERT INTO public.demurrage_invoices (
    doc_number, bl_id, customer_id, total_usd, ready_at,
    roe_manual, roe, status, billed_at, first_billed_at,
    current_roe, current_total_brl, roe_source, pix_payload
  )
  VALUES (
    TRIM(p_doc_number), p_bl_id, p_customer_id, p_total_usd, p_ready_at,
    COALESCE(p_roe_manual, false), p_roe, 'issued', CURRENT_DATE, CURRENT_DATE,
    p_current_roe, v_total_brl, p_roe_source, v_pix_payload
  )
  RETURNING id INTO v_invoice_id;

  INSERT INTO public.demurrage_invoice_items (
    invoice_id, container_id, container_number, container_type,
    discharge_date, return_date, total_days, free_days,
    days_p1, rate_p1_usd, days_p2, rate_p2_usd, subtotal_usd
  )
  SELECT
    v_invoice_id, item.container_id, item.container_number, item.container_type,
    item.discharge_date, item.return_date, item.total_days, item.free_days,
    item.days_p1, item.rate_p1_usd, item.days_p2, item.rate_p2_usd, item.subtotal_usd
  FROM jsonb_to_recordset(p_items) AS item(
    container_id BIGINT,
    container_number TEXT,
    container_type TEXT,
    discharge_date DATE,
    return_date DATE,
    total_days INTEGER,
    free_days INTEGER,
    days_p1 INTEGER,
    rate_p1_usd NUMERIC,
    days_p2 INTEGER,
    rate_p2_usd NUMERIC,
    subtotal_usd NUMERIC
  );

  -- Foto inicial de histórico (source conforme a origem da PTAX na emissão).
  INSERT INTO public.demurrage_invoice_history
    (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
  VALUES
    (v_invoice_id, CURRENT_DATE, v_ptax, p_current_roe, p_total_usd, v_total_brl, 0, p_roe_source);

  RETURN jsonb_build_object('invoice_id', v_invoice_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_demurrage_invoice_with_items(
  TEXT, TEXT, BIGINT, NUMERIC, DATE, BOOLEAN, NUMERIC, NUMERIC, TEXT, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_demurrage_invoice_with_items(
  TEXT, TEXT, BIGINT, NUMERIC, DATE, BOOLEAN, NUMERIC, NUMERIC, TEXT, JSONB
) TO authenticated;
