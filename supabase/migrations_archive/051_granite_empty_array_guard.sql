-- Migration 051: ajuste de guarda para array vazio no RPC de granito
--
-- array_length(ARRAY[]::uuid[], 1) retorna NULL.
-- Sem COALESCE, a validacao inicial nao captura lista vazia.

CREATE OR REPLACE FUNCTION public.create_invoice_from_granite_bls(
  p_granite_bl_ids UUID[],
  p_customer_id    BIGINT DEFAULT NULL,
  p_due_date       DATE   DEFAULT NULL,
  p_notes          TEXT   DEFAULT NULL,
  p_actor          UUID   DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_id             BIGINT;
  v_invoice_id              BIGINT;
  v_invoice_number          TEXT;
  v_total_brl               NUMERIC(14,2);
  v_bl_count                INT;
  v_distinct_customer_count INT;
  v_missing_customer_count  INT;
BEGIN
  IF p_granite_bl_ids IS NULL OR COALESCE(array_length(p_granite_bl_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'PT409: Nenhum B/L Granito selecionado.';
  END IF;

  IF (SELECT COUNT(*) FROM public.granite_bls WHERE id = ANY(p_granite_bl_ids)) <> array_length(p_granite_bl_ids, 1) THEN
    RAISE EXCEPTION 'PT409: Um ou mais B/Ls Granito nao foram encontrados.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.granite_bls
    WHERE id = ANY(p_granite_bl_ids)
      AND charge_status <> 'ready_for_billing'
  ) THEN
    RAISE EXCEPTION 'PT409: Um ou mais B/Ls Granito nao estao prontos para faturar (charge_status != ready_for_billing).';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoice_granite_bls
    WHERE granite_bl_id = ANY(p_granite_bl_ids)
  ) THEN
    RAISE EXCEPTION 'PT409: Um ou mais B/Ls Granito ja estao vinculados a uma invoice.';
  END IF;

  SELECT
    COUNT(DISTINCT client_id) FILTER (WHERE client_id IS NOT NULL),
    COUNT(*) FILTER (WHERE client_id IS NULL)
  INTO v_distinct_customer_count, v_missing_customer_count
  FROM public.granite_bls
  WHERE id = ANY(p_granite_bl_ids);

  IF p_customer_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.granite_bls
      WHERE id = ANY(p_granite_bl_ids)
        AND client_id IS DISTINCT FROM p_customer_id
    ) THEN
      RAISE EXCEPTION 'PT409: Existem B/Ls de clientes diferentes no lote selecionado.';
    END IF;
    v_customer_id := p_customer_id;
  ELSE
    IF v_missing_customer_count > 0 THEN
      RAISE EXCEPTION 'PT409: Um ou mais B/Ls Granito nao possuem cliente vinculado.';
    END IF;

    IF v_distinct_customer_count <> 1 THEN
      RAISE EXCEPTION 'PT409: Os B/Ls selecionados precisam pertencer a um unico cliente.';
    END IF;

    SELECT DISTINCT client_id
    INTO v_customer_id
    FROM public.granite_bls
    WHERE id = ANY(p_granite_bl_ids)
    LIMIT 1;
  END IF;

  SELECT COALESCE(SUM(c.subtotal), 0)
  INTO v_total_brl
  FROM public.granite_bl_charges c
  WHERE c.bl_id = ANY(p_granite_bl_ids);

  v_bl_count := array_length(p_granite_bl_ids, 1);

  INSERT INTO public.invoices (
    customer_id, issued_at, due_date, total_brl, status,
    notes, total_paid_brl, balance_brl, issued_by
  )
  VALUES (
    v_customer_id,
    now(),
    p_due_date,
    v_total_brl,
    'issued',
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    0,
    v_total_brl,
    p_actor
  )
  RETURNING id, invoice_number
  INTO v_invoice_id, v_invoice_number;

  INSERT INTO public.invoice_granite_bls (invoice_id, granite_bl_id, subtotal_brl)
  SELECT
    v_invoice_id,
    gb.id,
    COALESCE(charges.total, 0)
  FROM public.granite_bls gb
  LEFT JOIN (
    SELECT bl_id, SUM(subtotal) AS total
    FROM public.granite_bl_charges
    WHERE bl_id = ANY(p_granite_bl_ids)
    GROUP BY bl_id
  ) charges ON charges.bl_id = gb.id
  WHERE gb.id = ANY(p_granite_bl_ids);

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_value_brl, total_value_brl)
  SELECT
    v_invoice_id,
    CONCAT('Granito BL ', gb.bl_number, ' - ', COALESCE(c.description, 'Taxa')),
    COALESCE(c.quantity, 1),
    COALESCE(c.unit_value, 0),
    COALESCE(c.subtotal, 0)
  FROM public.granite_bl_charges c
  JOIN public.granite_bls gb ON gb.id = c.bl_id
  WHERE c.bl_id = ANY(p_granite_bl_ids)
    AND COALESCE(c.subtotal, 0) > 0;

  UPDATE public.granite_bls
  SET charge_status = 'invoiced'
  WHERE id = ANY(p_granite_bl_ids);

  RETURN jsonb_build_object(
    'invoice_id',     v_invoice_id,
    'invoice_number', v_invoice_number,
    'total_brl',      v_total_brl::TEXT,
    'bl_count',       v_bl_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice_from_granite_bls(UUID[], BIGINT, DATE, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_granite_bls(UUID[], BIGINT, DATE, TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_invoice_from_granite_bls(
  p_granite_bl_ids UUID[],
  p_customer_id    BIGINT,
  p_due_date       DATE,
  p_notes          TEXT,
  p_issue_now      BOOLEAN,
  p_actor          UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(p_issue_now, true) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PT409: Emissao diferida nao suportada para faturamento de granito.';
  END IF;

  RETURN public.create_invoice_from_granite_bls(
    p_granite_bl_ids => p_granite_bl_ids,
    p_customer_id    => p_customer_id,
    p_due_date       => p_due_date,
    p_notes          => p_notes,
    p_actor          => p_actor
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice_from_granite_bls(UUID[], BIGINT, DATE, TEXT, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_granite_bls(UUID[], BIGINT, DATE, TEXT, BOOLEAN, UUID) TO authenticated;
