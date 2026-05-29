-- Phase 2: Transactional ledger RPCs for local-charge billing.
-- The receivable balance is the source of truth. This core RPC is shared by
-- manual payment and TXID reconciliation. Existing invoice/payment flows stay intact.

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
  v_payment_id BIGINT;
  v_total_paid NUMERIC(14,2);
  v_receivable_ids BIGINT[];
  v_covered INTEGER := 0;
  v_obsoleted INTEGER := 0;
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

  -- Idempotency guard for reconciliation: a TXID can settle only once.
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

  -- Lock the receivables backing this invoice (ordered to avoid deadlocks).
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

  -- Reject if any backing receivable was already settled (concurrency guard).
  IF EXISTS (
    SELECT 1 FROM public.bl_receivables
    WHERE id = ANY(v_receivable_ids) AND status = 'settled'
  ) THEN
    RAISE EXCEPTION 'Um ou mais B/Ls ja foram liquidados por outro documento.' USING ERRCODE = '23505';
  END IF;

  SELECT COALESCE(SUM(balance_brl), 0) INTO v_open
  FROM public.bl_receivables
  WHERE id = ANY(v_receivable_ids);

  IF ABS(p_amount_brl - v_open) > 0.01 THEN
    RAISE EXCEPTION 'Valor (%.2f) difere do saldo em aberto do documento (%.2f). Pagamento parcial nao suportado.',
      p_amount_brl, v_open USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payments (invoice_id, amount_brl, payment_method, paid_at, registered_by, notes)
  VALUES (
    p_invoice_id,
    p_amount_brl,
    COALESCE(NULLIF(TRIM(COALESCE(p_method, '')), ''), 'pix'),
    COALESCE(p_paid_at, now()),
    v_actor,
    NULLIF(TRIM(COALESCE(p_notes, '')), '')
  )
  RETURNING id INTO v_payment_id;

  -- One settlement per receivable; settle each fully.
  INSERT INTO public.ledger_settlements (payment_id, receivable_id, invoice_id, amount_brl, settled_at, method, pix_txid, source)
  SELECT
    v_payment_id,
    br.id,
    p_invoice_id,
    br.balance_brl,
    COALESCE(p_paid_at, now()),
    COALESCE(NULLIF(TRIM(COALESCE(p_method, '')), ''), 'pix'),
    NULLIF(TRIM(COALESCE(p_pix_txid, '')), ''),
    COALESCE(p_source, 'manual')
  FROM public.bl_receivables br
  WHERE br.id = ANY(v_receivable_ids)
    AND br.balance_brl > 0;

  UPDATE public.bl_receivables
  SET settled_amount_brl = original_amount_brl,
      balance_brl = 0,
      status = 'settled',
      updated_at = now()
  WHERE id = ANY(v_receivable_ids);

  UPDATE public.invoice_receivable_links
  SET status = 'settled_by_this_invoice'
  WHERE invoice_id = p_invoice_id AND status = 'active';

  SELECT COALESCE(SUM(amount_brl), 0) INTO v_total_paid
  FROM public.payments WHERE invoice_id = p_invoice_id;

  UPDATE public.invoices
  SET total_paid_brl = v_total_paid, balance_brl = 0, status = 'paid'
  WHERE id = p_invoice_id;

  IF COALESCE(v_invoice.invoice_type, 'individual') = 'consolidated' THEN
    -- The consolidated covers the individuals of the same receivables.
    WITH covered AS (
      UPDATE public.invoices ind
      SET status = 'covered', covered_by_invoice_id = p_invoice_id
      WHERE ind.id <> p_invoice_id
        AND ind.invoice_type = 'individual'
        AND COALESCE(ind.status, 'issued') IN ('issued', 'partially_paid', 'overdue')
        AND EXISTS (
          SELECT 1 FROM public.invoice_receivable_links l
          WHERE l.invoice_id = ind.id AND l.receivable_id = ANY(v_receivable_ids)
        )
      RETURNING ind.id
    )
    SELECT COUNT(*) INTO v_covered FROM covered;

    UPDATE public.invoice_receivable_links
    SET status = 'settled_elsewhere'
    WHERE invoice_id <> p_invoice_id
      AND receivable_id = ANY(v_receivable_ids)
      AND status = 'active';

    INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, related_invoice_id, actor, payload)
    SELECT ind.id, 'covered', p_invoice_id, v_actor,
      jsonb_build_object('reason', 'Coberta por consolidada', 'consolidated_invoice_id', p_invoice_id)
    FROM public.invoices ind
    WHERE ind.covered_by_invoice_id = p_invoice_id AND ind.status = 'covered';
  ELSE
    -- An individual (or granite) payment makes open consolidated documents obsolete.
    WITH obsoleted AS (
      UPDATE public.invoices con
      SET status = 'obsolete',
          obsolete_reason = 'B/L liquidado por invoice individual ' || COALESCE(v_invoice.invoice_number, p_invoice_id::TEXT)
      WHERE con.id <> p_invoice_id
        AND con.invoice_type = 'consolidated'
        AND COALESCE(con.status, 'issued') IN ('issued', 'partially_paid', 'overdue')
        AND EXISTS (
          SELECT 1 FROM public.invoice_receivable_links l
          WHERE l.invoice_id = con.id AND l.receivable_id = ANY(v_receivable_ids)
        )
      RETURNING con.id
    )
    SELECT COUNT(*) INTO v_obsoleted FROM obsoleted;

    UPDATE public.invoice_receivable_links
    SET status = 'obsolete'
    WHERE invoice_id <> p_invoice_id
      AND receivable_id = ANY(v_receivable_ids)
      AND invoice_id IN (
        SELECT id FROM public.invoices WHERE invoice_type = 'consolidated' AND status = 'obsolete'
      )
      AND status = 'active';

    INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, related_invoice_id, actor, payload)
    SELECT con.id, 'obsolete', p_invoice_id, v_actor,
      jsonb_build_object('reason', con.obsolete_reason, 'paid_invoice_id', p_invoice_id)
    FROM public.invoices con
    WHERE con.invoice_type = 'consolidated' AND con.status = 'obsolete'
      AND EXISTS (
        SELECT 1 FROM public.invoice_receivable_links l
        WHERE l.invoice_id = con.id AND l.receivable_id = ANY(v_receivable_ids)
      );
  END IF;

  -- Keep legacy BL financial_status consistent with the settled receivables.
  UPDATE public.bls b
  SET financial_status = 'paid'
  WHERE b.id IN (
    SELECT br.bl_id FROM public.bl_receivables br WHERE br.id = ANY(v_receivable_ids)
  );

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, receivable_id, actor, payload)
  VALUES (
    p_invoice_id,
    CASE WHEN COALESCE(p_source, 'manual') = 'pix_extract' THEN 'reconciled_by_txid' ELSE 'paid' END,
    NULL,
    v_actor,
    jsonb_build_object('amount_brl', p_amount_brl, 'source', COALESCE(p_source, 'manual'), 'pix_txid', NULLIF(TRIM(COALESCE(p_pix_txid, '')), ''))
  );

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES (
    'invoice', p_invoice_id::TEXT, 'ledger_payment',
    COALESCE(v_invoice.balance_brl::TEXT, '0'), v_total_paid::TEXT, auth.uid(), now(),
    'Baixa via ledger (' || COALESCE(p_source, 'manual') || ')'
  );

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'payment_id', v_payment_id,
    'status', 'paid',
    'amount_brl', p_amount_brl,
    'receivables_settled', ARRAY_LENGTH(v_receivable_ids, 1),
    'individuals_covered', v_covered,
    'consolidated_obsoleted', v_obsoleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_ledger_invoice_payment(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_ledger_invoice_payment(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, UUID) TO authenticated;
