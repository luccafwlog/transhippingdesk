CREATE OR REPLACE FUNCTION public.register_ledger_invoice_payment(
  p_invoice_id BIGINT,
  p_amount_brl NUMERIC,
  p_method TEXT DEFAULT 'pix',
  p_paid_at TIMESTAMPTZ DEFAULT now(),
  p_pix_txid TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'manual',
  p_notes TEXT DEFAULT NULL,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice RECORD;
  v_actor UUID;
  v_open NUMERIC(14,2);
  v_remaining NUMERIC(14,2);
  v_remaining_open NUMERIC(14,2);
  v_allocation NUMERIC(14,2);
  v_payment_id BIGINT;
  v_total_paid NUMERIC(14,2);
  v_all_receivable_ids BIGINT[];
  v_receivable_ids BIGINT[];
  v_receivable RECORD;
  v_next_status TEXT;
  v_covered INTEGER := 0;
  v_obsoleted INTEGER := 0;
  v_receivables_settled INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  IF COALESCE(p_source, 'manual') NOT IN ('manual', 'pix_extract') THEN
    RAISE EXCEPTION 'Origem de pagamento invalida.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_amount_brl, 0) <= 0 THEN
    RAISE EXCEPTION 'Valor de pagamento deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_pix_txid, '')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.ledger_settlements
       WHERE pix_txid IS NOT NULL
         AND UPPER(REGEXP_REPLACE(pix_txid, '[^A-Za-z0-9]', '', 'g'))
           = UPPER(REGEXP_REPLACE(p_pix_txid, '[^A-Za-z0-9]', '', 'g'))
     ) THEN
    RAISE EXCEPTION 'TXID % ja foi conciliado.', p_pix_txid USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') NOT IN ('issued', 'partially_paid', 'overdue') THEN
    RAISE EXCEPTION 'Invoice % nao esta em estado pagavel (status=%).', p_invoice_id, v_invoice.status
      USING ERRCODE = '22023';
  END IF;

  SELECT ARRAY_AGG(irl.receivable_id ORDER BY irl.receivable_id)
  INTO v_all_receivable_ids
  FROM public.invoice_receivable_links irl
  WHERE irl.invoice_id = p_invoice_id;

  SELECT ARRAY_AGG(irl.receivable_id ORDER BY irl.receivable_id)
  INTO v_receivable_ids
  FROM public.invoice_receivable_links irl
  WHERE irl.invoice_id = p_invoice_id
    AND irl.status = 'active';

  IF v_receivable_ids IS NULL OR ARRAY_LENGTH(v_receivable_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Invoice % sem receivables ativos vinculados no ledger.', p_invoice_id
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.bl_receivables WHERE id = ANY(v_receivable_ids) ORDER BY id FOR UPDATE;

  SELECT COALESCE(SUM(balance_brl), 0)
  INTO v_open
  FROM public.bl_receivables
  WHERE id = ANY(v_receivable_ids)
    AND status IN ('open', 'partially_settled');

  IF COALESCE(v_open, 0) <= 0 THEN
    RAISE EXCEPTION 'Invoice % nao possui saldo em aberto no ledger.', p_invoice_id USING ERRCODE = '22023';
  END IF;

  IF p_amount_brl - v_open > 0.01 THEN
    RAISE EXCEPTION 'Valor (%.2f) excede o saldo em aberto do documento (%.2f).',
      p_amount_brl, v_open USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payments (invoice_id, amount_brl, payment_method, paid_at, registered_by, notes)
  VALUES (
    p_invoice_id,
    ROUND(p_amount_brl::NUMERIC, 2),
    COALESCE(NULLIF(TRIM(COALESCE(p_method, '')), ''), 'pix'),
    COALESCE(p_paid_at, now()),
    v_actor,
    NULLIF(TRIM(COALESCE(p_notes, '')), '')
  )
  RETURNING id INTO v_payment_id;

  v_remaining := ROUND(p_amount_brl::NUMERIC, 2);

  FOR v_receivable IN
    SELECT id, balance_brl
    FROM public.bl_receivables
    WHERE id = ANY(v_receivable_ids)
      AND status IN ('open', 'partially_settled')
      AND balance_brl > 0
    ORDER BY id
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_allocation := ROUND(LEAST(v_receivable.balance_brl, v_remaining)::NUMERIC, 2);
    IF v_allocation <= 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.ledger_settlements (
      payment_id, receivable_id, invoice_id, amount_brl, settled_at, method, pix_txid, source
    )
    VALUES (
      v_payment_id,
      v_receivable.id,
      p_invoice_id,
      v_allocation,
      COALESCE(p_paid_at, now()),
      COALESCE(NULLIF(TRIM(COALESCE(p_method, '')), ''), 'pix'),
      NULLIF(TRIM(COALESCE(p_pix_txid, '')), ''),
      COALESCE(p_source, 'manual')
    );

    UPDATE public.bl_receivables
    SET
      settled_amount_brl = LEAST(original_amount_brl, COALESCE(settled_amount_brl, 0) + v_allocation),
      balance_brl = GREATEST(COALESCE(balance_brl, 0) - v_allocation, 0),
      status = CASE
        WHEN GREATEST(COALESCE(balance_brl, 0) - v_allocation, 0) <= 0.01 THEN 'settled'
        ELSE 'partially_settled'
      END,
      updated_at = now()
    WHERE id = v_receivable.id;

    v_remaining := ROUND((v_remaining - v_allocation)::NUMERIC, 2);
  END LOOP;

  IF v_remaining > 0.01 THEN
    RAISE EXCEPTION 'Falha ao alocar pagamento: saldo residual %.2f.', v_remaining USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.invoice_receivable_links irl
  SET status = 'settled_by_this_invoice'
  WHERE irl.invoice_id = p_invoice_id
    AND irl.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM public.bl_receivables br
      WHERE br.id = irl.receivable_id
        AND br.balance_brl <= 0.01
    );

  SELECT COALESCE(SUM(balance_brl), 0)
  INTO v_remaining_open
  FROM public.bl_receivables
  WHERE id = ANY(v_receivable_ids)
    AND status IN ('open', 'partially_settled');

  SELECT COALESCE(SUM(amount_brl), 0)
  INTO v_total_paid
  FROM public.payments
  WHERE invoice_id = p_invoice_id;

  v_next_status := CASE WHEN v_remaining_open <= 0.01 THEN 'paid' ELSE 'partially_paid' END;

  UPDATE public.invoices
  SET
    total_paid_brl = v_total_paid,
    balance_brl = GREATEST(v_remaining_open, 0),
    status = v_next_status
  WHERE id = p_invoice_id;

  UPDATE public.bls b
  SET financial_status = 'paid'
  WHERE b.id IN (
    SELECT br.bl_id
    FROM public.bl_receivables br
    WHERE br.id = ANY(v_receivable_ids)
      AND br.balance_brl <= 0.01
  );

  SELECT COUNT(*)
  INTO v_receivables_settled
  FROM public.bl_receivables
  WHERE id = ANY(v_all_receivable_ids)
    AND balance_brl <= 0.01;

  IF v_next_status = 'paid' THEN
    IF COALESCE(v_invoice.invoice_type, 'individual') = 'consolidated' THEN
      WITH covered AS (
        UPDATE public.invoices ind
        SET status = 'covered', covered_by_invoice_id = p_invoice_id
        WHERE ind.id <> p_invoice_id
          AND ind.invoice_type = 'individual'
          AND COALESCE(ind.status, 'issued') IN ('issued', 'partially_paid', 'overdue')
          AND EXISTS (
            SELECT 1
            FROM public.invoice_receivable_links l
            WHERE l.invoice_id = ind.id
              AND l.receivable_id = ANY(v_all_receivable_ids)
          )
        RETURNING ind.id
      )
      SELECT COUNT(*) INTO v_covered FROM covered;

      UPDATE public.invoice_receivable_links
      SET status = 'settled_elsewhere'
      WHERE invoice_id <> p_invoice_id
        AND receivable_id = ANY(v_all_receivable_ids)
        AND status = 'active';

      INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, related_invoice_id, actor, payload)
      SELECT ind.id, 'covered', p_invoice_id, v_actor,
        jsonb_build_object('reason', 'Coberta por consolidada', 'consolidated_invoice_id', p_invoice_id)
      FROM public.invoices ind
      WHERE ind.covered_by_invoice_id = p_invoice_id
        AND ind.status = 'covered';
    ELSE
      WITH obsoleted AS (
        UPDATE public.invoices con
        SET status = 'obsolete',
            obsolete_reason = 'B/L liquidado por invoice individual ' || COALESCE(v_invoice.invoice_number, p_invoice_id::TEXT)
        WHERE con.id <> p_invoice_id
          AND con.invoice_type = 'consolidated'
          AND COALESCE(con.status, 'issued') IN ('issued', 'partially_paid', 'overdue')
          AND EXISTS (
            SELECT 1
            FROM public.invoice_receivable_links l
            WHERE l.invoice_id = con.id
              AND l.receivable_id = ANY(v_all_receivable_ids)
          )
        RETURNING con.id
      )
      SELECT COUNT(*) INTO v_obsoleted FROM obsoleted;

      UPDATE public.invoice_receivable_links
      SET status = 'obsolete'
      WHERE invoice_id <> p_invoice_id
        AND receivable_id = ANY(v_all_receivable_ids)
        AND invoice_id IN (
          SELECT id FROM public.invoices WHERE invoice_type = 'consolidated' AND status = 'obsolete'
        )
        AND status = 'active';

      INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, related_invoice_id, actor, payload)
      SELECT con.id, 'obsolete', p_invoice_id, v_actor,
        jsonb_build_object('reason', con.obsolete_reason, 'paid_invoice_id', p_invoice_id)
      FROM public.invoices con
      WHERE con.invoice_type = 'consolidated'
        AND con.status = 'obsolete'
        AND EXISTS (
          SELECT 1
          FROM public.invoice_receivable_links l
          WHERE l.invoice_id = con.id
            AND l.receivable_id = ANY(v_all_receivable_ids)
        );
    END IF;
  END IF;

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, receivable_id, actor, payload)
  VALUES (
    p_invoice_id,
    CASE
      WHEN COALESCE(p_source, 'manual') = 'pix_extract' THEN 'reconciled_by_txid'
      WHEN v_next_status = 'paid' THEN 'paid'
      ELSE 'partially_paid'
    END,
    NULL,
    v_actor,
    jsonb_build_object(
      'amount_brl', p_amount_brl,
      'source', COALESCE(p_source, 'manual'),
      'pix_txid', NULLIF(TRIM(COALESCE(p_pix_txid, '')), ''),
      'status', v_next_status
    )
  );

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES (
    'invoice', p_invoice_id::TEXT, 'ledger_payment',
    COALESCE(v_invoice.balance_brl::TEXT, '0'), v_remaining_open::TEXT, auth.uid(), now(),
    'Baixa via ledger (' || COALESCE(p_source, 'manual') || ')'
  );

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'payment_id', v_payment_id,
    'status', v_next_status,
    'amount_brl', p_amount_brl,
    'balance_brl', GREATEST(v_remaining_open, 0),
    'receivables_settled', v_receivables_settled,
    'individuals_covered', v_covered,
    'consolidated_obsoleted', v_obsoleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_ledger_invoice_payment(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_ledger_invoice_payment(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, UUID) TO authenticated;
