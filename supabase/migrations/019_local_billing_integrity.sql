-- 019: ledger local em centavos e fronteira de prontidao financeira.
-- Pagamento de R$ 99,99 em uma cobranca de R$ 100,00 permanece parcialmente
-- pago; nenhum caminho inventa um centavo quitado. PIX e manual compartilham
-- o mesmo nucleo transacional.

CREATE OR REPLACE FUNCTION public.register_ledger_invoice_payment(p_invoice_id bigint, p_amount_brl numeric, p_method text DEFAULT 'pix'::text, p_paid_at timestamp with time zone DEFAULT now(), p_pix_txid text DEFAULT NULL::text, p_source text DEFAULT 'manual'::text, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_invoice RECORD;
  v_actor UUID;
  v_payment_amount NUMERIC(14,2);
  v_open NUMERIC(14,2);
  v_excess NUMERIC(14,2) := 0;
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

  v_payment_amount := ROUND(COALESCE(p_amount_brl, 0)::NUMERIC, 2);
  IF v_payment_amount <= 0 THEN
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

  -- Pagamentos manuais e PIX podem liquidar parcialmente.
  -- Qualquer excedente continua proibido para PIX e gera restituição somente
  -- no caminho manual.
  v_excess := ROUND(GREATEST(v_payment_amount - v_open, 0)::NUMERIC, 2);
  IF v_excess > 0 AND COALESCE(p_source, 'manual') <> 'manual' THEN
    RAISE EXCEPTION 'Valor (%) excede o saldo em aberto do documento (%).',
      v_payment_amount, v_open USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payments (invoice_id, amount_brl, payment_method, paid_at, registered_by, notes)
  VALUES (
    p_invoice_id,
    v_payment_amount,
    COALESCE(NULLIF(TRIM(COALESCE(p_method, '')), ''), 'pix'),
    COALESCE(p_paid_at, now()),
    v_actor,
    NULLIF(TRIM(COALESCE(p_notes, '')), '')
  )
  RETURNING id INTO v_payment_id;

  -- Aloca no maximo o saldo aberto; o que passar disso e excedente (restituicao).
  v_remaining := ROUND(LEAST(v_payment_amount, v_open)::NUMERIC, 2);

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
        WHEN GREATEST(COALESCE(balance_brl, 0) - v_allocation, 0) <= 0 THEN 'settled'
        ELSE 'partially_settled'
      END,
      updated_at = now()
    WHERE id = v_receivable.id;

    v_remaining := ROUND((v_remaining - v_allocation)::NUMERIC, 2);
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Falha ao alocar pagamento: saldo residual %.', v_remaining USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.invoice_receivable_links irl
  SET status = 'settled_by_this_invoice'
  WHERE irl.invoice_id = p_invoice_id
    AND irl.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM public.bl_receivables br
      WHERE br.id = irl.receivable_id
        AND br.balance_brl <= 0
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

  v_next_status := CASE WHEN v_remaining_open <= 0 THEN 'paid' ELSE 'partially_paid' END;

  UPDATE public.invoices
  SET
    total_paid_brl = v_total_paid,
    balance_brl = GREATEST(v_remaining_open, 0),
    status = v_next_status
  WHERE id = p_invoice_id;

  -- Excedente da baixa manual: registra restituicao pendente ao cliente.
  IF v_excess > 0 THEN
    INSERT INTO public.invoice_refunds (invoice_id, payment_id, amount_brl, status, registered_by, notes)
    VALUES (p_invoice_id, v_payment_id, v_excess, 'pending', v_actor, NULLIF(TRIM(COALESCE(p_notes, '')), ''));
  END IF;

  UPDATE public.bls b
  SET financial_status = 'paid'
  WHERE b.id IN (
    SELECT br.bl_id
    FROM public.bl_receivables br
    WHERE br.id = ANY(v_receivable_ids)
      AND br.balance_brl <= 0
  );

  SELECT COUNT(*)
  INTO v_receivables_settled
  FROM public.bl_receivables
  WHERE id = ANY(v_all_receivable_ids)
    AND balance_brl <= 0;

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
      'amount_brl', v_payment_amount,
      'source', COALESCE(p_source, 'manual'),
      'pix_txid', NULLIF(TRIM(COALESCE(p_pix_txid, '')), ''),
      'status', v_next_status,
      'refund_due_brl', v_excess
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
    'amount_brl', v_payment_amount,
    'balance_brl', GREATEST(v_remaining_open, 0),
    'refund_due_brl', v_excess,
    'receivables_settled', v_receivables_settled,
    'individuals_covered', v_covered,
    'consolidated_obsoleted', v_obsoleted
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_invoice_payment(p_payment_id bigint, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_payment RECORD;
  v_invoice RECORD;
  v_settlement RECORD;
  v_unsettled_invoice_ids BIGINT[];
  v_total_paid NUMERIC(14,2);
  v_balance NUMERIC(14,2);
  v_actor UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao.' USING ERRCODE = '42501';
  END IF;

  -- Justificativa obrigatoria para cancelar a baixa.
  IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa para cancelar a baixa.' USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pagamento % nao encontrado.', p_payment_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = v_payment.invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', v_payment.invoice_id USING ERRCODE = 'P0002';
  END IF;

  -- Reverte cada settlement, restaurando o receivable
  FOR v_settlement IN
    SELECT * FROM public.ledger_settlements
    WHERE payment_id = p_payment_id
    ORDER BY id
  LOOP
    UPDATE public.bl_receivables
    SET
      settled_amount_brl = GREATEST(COALESCE(settled_amount_brl, 0) - v_settlement.amount_brl, 0),
      balance_brl = COALESCE(balance_brl, 0) + v_settlement.amount_brl,
      status = CASE
        WHEN GREATEST(COALESCE(balance_brl, 0) + v_settlement.amount_brl, 0) >= original_amount_brl THEN 'open'
        ELSE 'partially_settled'
      END,
      updated_at = now()
    WHERE id = v_settlement.receivable_id;
  END LOOP;

  DELETE FROM public.ledger_settlements WHERE payment_id = p_payment_id;

  -- Restaura invoice_receivable_links que foram afetados por este pagamento
  UPDATE public.invoice_receivable_links irl
  SET status = 'active'
  WHERE irl.invoice_id = v_payment.invoice_id
    AND irl.status = 'settled_by_this_invoice'
    AND EXISTS (
      SELECT 1 FROM public.bl_receivables br
      WHERE br.id = irl.receivable_id
        AND br.balance_brl > 0
    );

  -- Recalcula totais da invoice
  SELECT COALESCE(SUM(COALESCE(balance_brl, 0)), 0)
  INTO v_balance
  FROM public.bl_receivables
  WHERE id IN (
    SELECT receivable_id FROM public.invoice_receivable_links
    WHERE invoice_id = v_payment.invoice_id
  );

  SELECT COALESCE(SUM(amount_brl), 0)
  INTO v_total_paid
  FROM public.payments
  WHERE invoice_id = v_payment.invoice_id
    AND id <> p_payment_id;

  UPDATE public.invoices
  SET
    total_paid_brl = v_total_paid,
    balance_brl = GREATEST(v_balance, 0),
    -- Libera o TXID conciliado para que o mesmo PIX possa ser reconciliado de novo.
    pix_txid = NULL,
    conciliated_by_extract = false,
    status = CASE
      WHEN COALESCE(v_invoice.status, '') = 'covered' THEN 'covered'
      WHEN v_total_paid <= 0 AND GREATEST(v_balance, 0) >= (SELECT COALESCE(SUM(original_amount_brl), 0) FROM public.bl_receivables WHERE id IN (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = v_payment.invoice_id)) THEN 'issued'
      WHEN v_total_paid <= 0 THEN 'issued'
      WHEN GREATEST(v_balance, 0) <= 0 THEN 'paid'
      ELSE 'partially_paid'
    END
  WHERE id = v_payment.invoice_id;

  -- Se a invoice estava 'paid' e agora tem saldo > 0, reverte coberturas/obsolescencia
  IF COALESCE(v_invoice.status, '') IN ('paid') AND v_balance > 0 THEN
    -- Reverte invoices individuais que foram cobertas por esta consolidada
    UPDATE public.invoices ind
    SET status = 'issued', covered_by_invoice_id = NULL
    WHERE ind.covered_by_invoice_id = v_payment.invoice_id
      AND ind.status = 'covered';

    -- Reverte links de outras invoices que foram 'settled_elsewhere'
    UPDATE public.invoice_receivable_links irl
    SET status = 'active'
    WHERE irl.receivable_id IN (
      SELECT receivable_id FROM public.invoice_receivable_links
      WHERE invoice_id = v_payment.invoice_id
    )
      AND irl.invoice_id <> v_payment.invoice_id
      AND irl.status = 'settled_elsewhere';

    -- Reverte consolidations que foram obsoletadas por esta individual
    UPDATE public.invoices con
    SET status = 'issued', obsolete_reason = NULL
    WHERE con.id IN (
      SELECT con2.id FROM public.invoices con2
      WHERE con2.invoice_type = 'consolidated'
        AND con2.status = 'obsolete'
        AND EXISTS (
          SELECT 1 FROM public.invoice_receivable_links l
          WHERE l.invoice_id = con2.id
            AND l.receivable_id IN (
              SELECT receivable_id FROM public.invoice_receivable_links
              WHERE invoice_id = v_payment.invoice_id
            )
        )
    );

    -- Reverte links obsoletos
    UPDATE public.invoice_receivable_links irl
    SET status = 'active'
    WHERE irl.status = 'obsolete'
      AND irl.invoice_id IN (
        SELECT id FROM public.invoices WHERE invoice_type = 'consolidated' AND status = 'issued'
      )
      AND irl.receivable_id IN (
        SELECT receivable_id FROM public.invoice_receivable_links
        WHERE invoice_id = v_payment.invoice_id
      );
  END IF;

  -- Atualiza financial_status dos BLs vinculados.
  -- bls.financial_status so aceita 'pending','invoiced','paid','cancelled'
  -- (constraint bls_financial_status_check). Ao cancelar a baixa, o BL volta a
  -- 'invoiced' quando ainda ha saldo, ou 'paid' se tudo continua liquidado.
  UPDATE public.bls b
  SET financial_status = (
    SELECT CASE
      WHEN COUNT(*) FILTER (WHERE br.balance_brl > 0) = 0 THEN 'paid'
      ELSE 'invoiced'
    END
    FROM public.bl_receivables br
    WHERE br.bl_id = b.id
  )
  WHERE b.id IN (
    SELECT br.bl_id FROM public.bl_receivables br
    WHERE br.id IN (
      SELECT receivable_id FROM public.invoice_receivable_links
      WHERE invoice_id = v_payment.invoice_id
    )
  );

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES (
    'invoice', v_payment.invoice_id::TEXT, 'payment_reversed',
    COALESCE(v_invoice.status, '?') || ' total_paid=' || COALESCE(v_invoice.total_paid_brl::TEXT, '?'),
    (SELECT COALESCE(status, '?') || ' total_paid=' || COALESCE(total_paid_brl::TEXT, '?') FROM public.invoices WHERE id = v_payment.invoice_id),
    v_actor, now(),
    TRIM(p_reason)
  );

  DELETE FROM public.payments WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'payment_id', p_payment_id,
    'invoice_id', v_payment.invoice_id,
    'new_status', (SELECT status FROM public.invoices WHERE id = v_payment.invoice_id)
  );
END;
$$;

-- Critério único de conta Portal utilizável para emissão interna.
CREATE OR REPLACE FUNCTION public.customer_billing_access_ready(p_customer_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.customer_portal_accounts a
    WHERE a.customer_id = p_customer_id
      AND a.active = true
      AND a.account_situation = 'ativo'
      AND a.auth_user_id IS NOT NULL
      AND NULLIF(btrim(a.recovery_email), '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
      AND COALESCE(a.recovery_email_status, 'ok') = 'ok'
      AND NOT EXISTS (
        SELECT 1 FROM public.portal_suppressed_emails s
        WHERE s.email = lower(btrim(a.recovery_email))
      )
  );
$$;

REVOKE ALL ON FUNCTION public.customer_billing_access_ready(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_billing_access_ready(bigint) TO service_role;

-- Núcleo de emissão individual: conjunto elegível exclui linhas isentas e exige
-- o gate completo de acesso antes de criar o documento.
CREATE OR REPLACE FUNCTION public.create_invoice_from_bls_core(p_bl_ids text[], p_customer_id bigint, p_notes text DEFAULT NULL::text, p_issue_now boolean DEFAULT true, p_actor uuid DEFAULT NULL::uuid, p_origin text DEFAULT 'internal'::text, p_portal_account_id bigint DEFAULT NULL::bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_requested_bls TEXT[];
  v_bl_count INTEGER;
  v_missing_bls TEXT;
  v_customer_id BIGINT;
  v_max_customer_id BIGINT;
  v_conflict_count INTEGER;
  v_usd_count INTEGER;
  v_invoice_id BIGINT;
  v_invoice_number TEXT;
  v_total_brl NUMERIC(14,2);
  v_item_count INTEGER;
  v_status TEXT;
  v_batch_id BIGINT;
  v_roe NUMERIC(10,4);
  v_roe_effective_date DATE;
BEGIN
  v_status := CASE WHEN COALESCE(p_issue_now, true) THEN 'issued' ELSE 'draft' END;

  SELECT ARRAY_AGG(DISTINCT UPPER(TRIM(bl_id)) ORDER BY UPPER(TRIM(bl_id)))
  INTO v_requested_bls
  FROM UNNEST(COALESCE(p_bl_ids, ARRAY[]::TEXT[])) AS input(bl_id)
  WHERE TRIM(COALESCE(bl_id, '')) <> '';

  IF COALESCE(ARRAY_LENGTH(v_requested_bls, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado para emissao.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.bls
  WHERE id = ANY(v_requested_bls)
  FOR UPDATE;

  SELECT COUNT(*) INTO v_bl_count
  FROM public.bls
  WHERE id = ANY(v_requested_bls);

  IF v_bl_count <> ARRAY_LENGTH(v_requested_bls, 1) THEN
    SELECT STRING_AGG(req.bl_id, ', ' ORDER BY req.bl_id)
    INTO v_missing_bls
    FROM UNNEST(v_requested_bls) AS req(bl_id)
    LEFT JOIN public.bls AS b ON b.id = req.bl_id
    WHERE b.id IS NULL;

    RAISE EXCEPTION 'B/L(s) nao encontrado(s): %', COALESCE(v_missing_bls, '-')
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = ANY(v_requested_bls)
      AND COALESCE(b.charge_status, 'not_calculated') <> 'ready_for_billing'
  ) THEN
    RAISE EXCEPTION 'Todos os B/Ls devem estar como ready_for_billing.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = ANY(v_requested_bls)
      AND COALESCE(b.financial_status, 'pending') <> 'pending'
  ) THEN
    RAISE EXCEPTION 'Existe B/L ja faturado/pago/cancelado na selecao.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = ANY(v_requested_bls)
      AND (b.customer_id IS NULL OR COALESCE(b.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled'))
  ) THEN
    RAISE EXCEPTION 'Todos os B/Ls precisam de cliente reconciliado para faturar.' USING ERRCODE = '22023';
  END IF;

  SELECT MIN(b.customer_id), MAX(b.customer_id)
  INTO v_customer_id, v_max_customer_id
  FROM public.bls AS b
  WHERE b.id = ANY(v_requested_bls);

  IF v_customer_id IS NULL OR v_customer_id <> v_max_customer_id THEN
    RAISE EXCEPTION 'Selecao contem B/Ls de clientes diferentes.' USING ERRCODE = '22023';
  END IF;

  IF p_customer_id IS NOT NULL AND p_customer_id <> v_customer_id THEN
    RAISE EXCEPTION 'Cliente informado nao corresponde aos B/Ls selecionados.' USING ERRCODE = '22023';
  END IF;

  IF NOT public.customer_billing_access_ready(v_customer_id) THEN
    RAISE EXCEPTION 'Emissao bloqueada: conta do Portal do cliente nao esta pronta para receber a fatura.' USING ERRCODE = 'P0003';
  END IF;

  SELECT COUNT(*)
  INTO v_conflict_count
  FROM public.invoice_bls AS ib
  JOIN public.invoices AS inv ON inv.id = ib.invoice_id
  WHERE ib.bl_id = ANY(v_requested_bls)
    AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue');

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Existe B/L vinculado a invoice ativa.' USING ERRCODE = '23505';
  END IF;

  SELECT COUNT(*)
  INTO v_usd_count
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = ANY(v_requested_bls)
    AND COALESCE(cc.total_value_usd, 0) > 0
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_usd_count > 0 THEN
    SELECT roe, effective_date INTO v_roe, v_roe_effective_date
    FROM public.exchange_rate_reference WHERE id = 1;

    IF v_roe IS NULL THEN
      RAISE EXCEPTION 'Cambio (ROE) nao configurado; nao e possivel converter linhas em USD para emitir a fatura.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF ARRAY_LENGTH(v_requested_bls, 1) > 1 THEN
    INSERT INTO public.billing_batches (
      customer_id,
      origin,
      status,
      notes,
      requested_by,
      portal_account_id
    )
    VALUES (
      v_customer_id,
      COALESCE(p_origin, 'internal'),
      'requested',
      NULLIF(TRIM(COALESCE(p_notes, '')), ''),
      p_actor,
      p_portal_account_id
    )
    RETURNING id INTO v_batch_id;
  END IF;

  INSERT INTO public.invoices (
    customer_id,
    bl_id,
    issued_at,
    total_brl,
    status,
    notes,
    total_paid_brl,
    balance_brl,
    issued_by
  )
  VALUES (
    v_customer_id,
    CASE WHEN ARRAY_LENGTH(v_requested_bls, 1) = 1 THEN v_requested_bls[1] ELSE NULL END,
    CASE WHEN v_status = 'issued' THEN now() ELSE NULL END,
    0,
    v_status,
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    0,
    0,
    p_actor
  )
  RETURNING id, invoice_number
  INTO v_invoice_id, v_invoice_number;

  INSERT INTO public.invoice_bls (
    invoice_id,
    bl_id,
    charge_status_snapshot,
    financial_status_snapshot,
    subtotal_brl,
    subtotal_usd
  )
  SELECT
    v_invoice_id,
    b.id,
    b.charge_status,
    b.financial_status,
    COALESCE(calc.total_brl, 0),
    COALESCE(calc.total_usd, 0)
  FROM public.bls AS b
  LEFT JOIN (
    -- Bug da review da PR 501 (achado 1): subtotal_brl precisa somar o MESMO
    -- valor convertido que alimenta invoice_items/invoices.total_brl (mesma
    -- conversao USD->BRL feita no INSERT de invoice_items abaixo), e nao
    -- apenas cc.total_value_brl -- que fica NULL para linhas em USD e
    -- deixava o subtotal do B/L zerado/nulo mesmo com fatura cobrando valor
    -- convertido. link_invoice_to_ledger usa esse subtotal para sobrescrever
    -- bl_receivables.original_amount_brl, entao um subtotal errado aqui
    -- zerava o receivable de B/Ls 100% em USD.
    SELECT
      cc.bl_id,
      SUM(COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.total_value_usd, 0) * v_roe, 2) END, 0)) AS total_brl,
      SUM(COALESCE(cc.total_value_usd, 0)) AS total_usd
    FROM public.charge_calculations AS cc
    LEFT JOIN public.charge_table_items AS cti ON cti.id = cc.charge_item_id
    WHERE cc.bl_id = ANY(v_requested_bls)
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
    GROUP BY cc.bl_id
  ) AS calc ON calc.bl_id = b.id
  WHERE b.id = ANY(v_requested_bls);

  INSERT INTO public.invoice_items (
    invoice_id,
    charge_calculation_id,
    description,
    quantity,
    unit_value_brl,
    total_value_brl,
    bl_id,
    manifest_id,
    charge_table_id,
    charge_item_id,
    source,
    currency,
    unit_value_usd,
    total_value_usd,
    pricing_rule_version_id,
    billing_run_id,
    calculation_key,
    snapshot_payload
  )
  SELECT
    v_invoice_id,
    cc.id,
    CONCAT('BL ', cc.bl_id, ' - ', COALESCE(cti.name, cc.calculation_key, 'Linha de taxa')),
    COALESCE(cc.quantity, 1),
    COALESCE(cc.unit_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.unit_value_usd, 0) * v_roe, 2) END, 0),
    COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.total_value_usd, 0) * v_roe, 2) END, 0),
    cc.bl_id,
    cc.manifest_id,
    cc.charge_table_id,
    cc.charge_item_id,
    cc.source,
    COALESCE(cti.currency, CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN 'USD' ELSE 'BRL' END),
    cc.unit_value_usd,
    cc.total_value_usd,
    cc.pricing_rule_version_id,
    cc.billing_run_id,
    cc.calculation_key,
    jsonb_build_object(
      'manifest_id', cc.manifest_id,
      'bl_id', cc.bl_id,
      'charge_table_id', cc.charge_table_id,
      'charge_item_id', cc.charge_item_id,
      'source', cc.source,
      'currency', COALESCE(cti.currency, CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN 'USD' ELSE 'BRL' END),
      'pricing_rule_version_id', cc.pricing_rule_version_id,
      'calculation_key', cc.calculation_key,
      'charge_name', cti.name,
      'shared_quantity_label', CASE
        WHEN cti.application_basis = 'container_distinct_voyage'
          AND cc.quantity > 0 AND cc.quantity < 1
        THEN CONCAT('1/', ROUND(1 / cc.quantity)::INTEGER)
        ELSE NULL
      END,
      'roe', CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN v_roe ELSE NULL END,
      'roe_effective_date', CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN v_roe_effective_date ELSE NULL END
    )
  FROM public.charge_calculations AS cc
  LEFT JOIN public.charge_table_items AS cti ON cti.id = cc.charge_item_id
  WHERE cc.bl_id = ANY(v_requested_bls)
    AND (COALESCE(cc.total_value_brl, 0) > 0 OR COALESCE(cc.total_value_usd, 0) > 0)
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  GET DIAGNOSTICS v_item_count = ROW_COUNT;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Nenhuma linha BRL elegivel para faturamento.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(total_value_brl), 0)
  INTO v_total_brl
  FROM public.invoice_items
  WHERE invoice_id = v_invoice_id;

  UPDATE public.invoices
  SET
    total_brl = v_total_brl,
    total_paid_brl = 0,
    balance_brl = v_total_brl
  WHERE id = v_invoice_id;

  IF v_status = 'issued' THEN
    UPDATE public.bls
    SET financial_status = 'invoiced'
    WHERE id = ANY(v_requested_bls);
  END IF;

  IF v_batch_id IS NOT NULL THEN
    UPDATE public.billing_batches
    SET
      status = CASE WHEN v_status = 'issued' THEN 'issued' ELSE 'requested' END,
      invoice_id = v_invoice_id,
      notes = NULLIF(TRIM(COALESCE(p_notes, '')), '')
    WHERE id = v_batch_id;
  END IF;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
  )
  VALUES (
    'invoice',
    v_invoice_id::TEXT,
    'create_invoice',
    NULL,
    CONCAT('invoice=', v_invoice_number, ' | bl_count=', ARRAY_LENGTH(v_requested_bls, 1), ' | total=', v_total_brl),
    p_actor,
    now(),
    CASE WHEN COALESCE(p_origin, 'internal') = 'portal' THEN 'Emissao consolidada via portal do cliente' ELSE 'Emissao de invoice por B/L' END
  );

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'status', v_status,
    'customer_id', v_customer_id,
    'bl_count', ARRAY_LENGTH(v_requested_bls, 1),
    'total_brl', v_total_brl,
    'balance_brl', v_total_brl,
    'billing_batch_id', v_batch_id
  );
END;
$$;

-- Núcleo de consolidação: mesma elegibilidade e mesmo gate da emissão individual.
CREATE OR REPLACE FUNCTION public.create_local_consolidated_invoice_core(p_customer_id bigint, p_receivable_ids bigint[], p_actor uuid DEFAULT NULL::uuid, p_origin text DEFAULT 'internal'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_ids BIGINT[];
  v_count INTEGER;
  v_invoice_id BIGINT;
  v_invoice_number TEXT;
  v_total NUMERIC(14,2);
  v_missing_roe_count INTEGER;
BEGIN
  SELECT ARRAY_AGG(DISTINCT id ORDER BY id)
  INTO v_ids
  FROM UNNEST(COALESCE(p_receivable_ids, ARRAY[]::BIGINT[])) AS u(id)
  WHERE id IS NOT NULL;

  IF COALESCE(ARRAY_LENGTH(v_ids, 1), 0) < 1 THEN
    RAISE EXCEPTION 'Nenhum receivable informado para consolidar.' USING ERRCODE = '22023';
  END IF;

  IF NOT public.customer_billing_access_ready(p_customer_id) THEN
    RAISE EXCEPTION 'Emissao consolidada bloqueada: conta do Portal do cliente nao esta pronta para receber a fatura.' USING ERRCODE = 'P0003';
  END IF;

  PERFORM 1 FROM public.bl_receivables WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;

  SELECT COUNT(*) INTO v_count FROM public.bl_receivables WHERE id = ANY(v_ids);
  IF v_count <> ARRAY_LENGTH(v_ids, 1) THEN
    RAISE EXCEPTION 'Receivable(s) inexistente(s) na selecao.' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_receivables WHERE id = ANY(v_ids) AND customer_id <> p_customer_id
  ) THEN
    RAISE EXCEPTION 'Selecao contem receivables de clientes diferentes.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_receivables
    WHERE id = ANY(v_ids) AND (status NOT IN ('open', 'partially_settled') OR balance_brl <= 0)
  ) THEN
    RAISE EXCEPTION 'Todos os receivables precisam estar abertos com saldo positivo.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_receivable_links l
    JOIN public.invoices inv ON inv.id = l.invoice_id
    WHERE l.receivable_id = ANY(v_ids)
      AND inv.invoice_type = 'consolidated'
      AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
  ) THEN
    RAISE EXCEPTION 'Um ou mais B/Ls ja estao em consolidada aberta.' USING ERRCODE = '23505';
  END IF;

  SELECT COALESCE(SUM(balance_brl), 0) INTO v_total
  FROM public.bl_receivables WHERE id = ANY(v_ids);

  INSERT INTO public.invoices (
    customer_id, bl_id, issued_at, total_brl, status, invoice_type,
    notes, total_paid_brl, balance_brl, issued_by
  )
  VALUES (
    p_customer_id, NULL, now(), v_total, 'issued', 'consolidated',
    NULL, 0, v_total, p_actor
  )
  RETURNING id, invoice_number INTO v_invoice_id, v_invoice_number;

  INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id, subtotal_brl, status, bl_snapshot)
  SELECT
    v_invoice_id, br.id, br.bl_id, br.balance_brl, 'active',
    jsonb_build_object('bl_id', br.bl_id, 'voyage_id', br.voyage_id, 'cargo_mode', br.cargo_mode, 'pol', br.pol, 'pod', br.pod)
  FROM public.bl_receivables br
  WHERE br.id = ANY(v_ids);

  -- Achado 4 da review da PR 501: garante que todo receivable USD selecionado
  -- tem ROE congelado antes de montar o detalhamento (evita usar um ROE
  -- global "current" como fallback silencioso).
  SELECT COUNT(*)
  INTO v_missing_roe_count
  FROM public.bl_receivables br
  JOIN public.charge_calculations cc ON cc.bl_id = br.bl_id
  LEFT JOIN public.charge_table_items cti ON cti.id = cc.charge_item_id
  WHERE br.id = ANY(v_ids)
    AND br.roe_frozen IS NULL
    AND COALESCE(cti.currency, 'BRL') = 'USD'
    AND COALESCE(cc.total_value_usd, 0) > 0
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_missing_roe_count > 0 THEN
    RAISE EXCEPTION 'Um ou mais receivables selecionados nao tem ROE congelado para linhas em USD; recalcule/atualize o B/L antes de consolidar.' USING ERRCODE = '22023';
  END IF;

  WITH links AS (
    SELECT l.bl_id, l.subtotal_brl, br.roe_frozen, br.roe_effective_date_frozen
    FROM public.invoice_receivable_links l
    JOIN public.bl_receivables br ON br.id = l.receivable_id
    WHERE l.invoice_id = v_invoice_id
  ),
  calcs AS (
    SELECT
      cc.bl_id, cc.id AS charge_calculation_id, cc.charge_table_id, cc.charge_item_id,
      cc.quantity,
      COALESCE(cc.unit_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.unit_value_usd, 0) * links.roe_frozen, 2) END) AS unit_value_brl,
      COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.total_value_usd, 0) * links.roe_frozen, 2) END, 0) AS total_value_brl,
      cti.currency, cti.application_basis,
      cc.unit_value_usd, cc.total_value_usd, cc.calculation_key, cti.name AS charge_name,
      links.roe_frozen, links.roe_effective_date_frozen
    FROM public.charge_calculations cc
    JOIN links ON links.bl_id = cc.bl_id
    LEFT JOIN public.charge_table_items cti ON cti.id = cc.charge_item_id
    WHERE (COALESCE(cc.total_value_brl, 0) > 0 OR COALESCE(cc.total_value_usd, 0) > 0)
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
  ),
  bl_recon AS (
    SELECT links.bl_id, links.subtotal_brl,
      COUNT(calcs.charge_calculation_id) AS calc_count,
      COALESCE(SUM(calcs.total_value_brl), 0) AS detailed_sum
    FROM links
    LEFT JOIN calcs ON calcs.bl_id = links.bl_id
    GROUP BY links.bl_id, links.subtotal_brl
  )
  INSERT INTO public.invoice_items (
    invoice_id, charge_calculation_id, description, quantity, unit_value_brl,
    total_value_brl, bl_id, charge_table_id, charge_item_id, source, currency,
    unit_value_usd, total_value_usd, calculation_key, snapshot_payload
  )
  SELECT
    v_invoice_id, calcs.charge_calculation_id,
    CONCAT('BL ', calcs.bl_id, ' - ', COALESCE(calcs.charge_name, calcs.calculation_key, 'Linha de taxa')),
    COALESCE(calcs.quantity, 1), calcs.unit_value_brl, calcs.total_value_brl,
    calcs.bl_id, calcs.charge_table_id, calcs.charge_item_id, 'ledger',
    COALESCE(calcs.currency, 'BRL'), calcs.unit_value_usd, calcs.total_value_usd,
    calcs.calculation_key,
    jsonb_build_object(
      'reconciled', true,
      'shared_quantity_label', CASE
        WHEN calcs.application_basis = 'container_distinct_voyage'
          AND calcs.quantity > 0 AND calcs.quantity < 1
        THEN CONCAT('1/', ROUND(1 / calcs.quantity)::INTEGER)
        ELSE NULL
      END,
      'roe', CASE WHEN COALESCE(calcs.currency, 'BRL') = 'USD' THEN calcs.roe_frozen ELSE NULL END,
      'roe_effective_date', CASE WHEN COALESCE(calcs.currency, 'BRL') = 'USD' THEN calcs.roe_effective_date_frozen ELSE NULL END
    )
  FROM calcs
  JOIN bl_recon ON bl_recon.bl_id = calcs.bl_id
  WHERE bl_recon.calc_count > 0 AND ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01
  UNION ALL
  SELECT
    v_invoice_id, NULL, CONCAT('BL ', bl_recon.bl_id, ' - Taxas locais'),
    1, bl_recon.subtotal_brl, bl_recon.subtotal_brl,
    bl_recon.bl_id, NULL, NULL, 'ledger', 'BRL', NULL, NULL, NULL,
    jsonb_build_object('reconciled', false)
  FROM bl_recon
  WHERE NOT (bl_recon.calc_count > 0 AND ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01);

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
  VALUES (v_invoice_id, 'issued', p_actor,
    jsonb_build_object('invoice_type', 'consolidated', 'receivable_count', ARRAY_LENGTH(v_ids, 1), 'total_brl', v_total, 'origin', COALESCE(p_origin, 'internal')));

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('invoice', v_invoice_id::TEXT, 'create_consolidated', NULL,
    CONCAT('invoice=', v_invoice_number, ' | receivables=', ARRAY_LENGTH(v_ids, 1), ' | total=', v_total),
    p_actor, now(),
    CASE WHEN COALESCE(p_origin, 'internal') = 'portal' THEN 'Emissao de consolidada via portal do cliente' ELSE 'Emissao de consolidada via ledger' END);

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'status', 'issued',
    'invoice_type', 'consolidated',
    'receivable_count', ARRAY_LENGTH(v_ids, 1),
    'total_brl', v_total
  );
END;
$$;

-- O recebível acompanha apenas linhas efetivamente faturáveis.
CREATE OR REPLACE FUNCTION public.sync_local_charge_receivable(p_bl_id text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_bl RECORD;
  v_amount NUMERIC(14,2);
  v_roe NUMERIC(10,4);
  v_roe_effective_date DATE;
  v_paid_amount NUMERIC(14,2);
  v_receivable_id BIGINT;
  v_status TEXT;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT id, customer_id, voyage_id, cargo_mode, pol, pod
  INTO v_bl
  FROM public.bls
  WHERE id = UPPER(TRIM(p_bl_id));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.customer_id IS NULL THEN
    RAISE EXCEPTION 'B/L % sem cliente vinculado.', p_bl_id USING ERRCODE = '22023';
  END IF;

  SELECT roe, effective_date INTO v_roe, v_roe_effective_date
  FROM public.exchange_rate_reference WHERE id = 1;

  IF v_roe IS NULL AND EXISTS (
    SELECT 1 FROM public.charge_calculations AS cc
    WHERE cc.bl_id = v_bl.id
      AND COALESCE(cc.total_value_usd, 0) > 0
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
  ) THEN
    RAISE EXCEPTION 'Cambio (ROE) nao configurado; nao e possivel calcular o saldo de linhas em USD.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(
    COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN ROUND(cc.total_value_usd * v_roe, 2) END, 0)
  ), 0)
  INTO v_amount
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = v_bl.id
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  SELECT COALESCE(SUM(p.amount_brl), 0)
  INTO v_paid_amount
  FROM public.invoice_bls ib
  JOIN public.invoices i ON i.id = ib.invoice_id
  JOIN public.payments p ON p.invoice_id = i.id
  WHERE ib.bl_id = v_bl.id
    AND COALESCE(i.status, 'issued') = 'paid';

  v_paid_amount := LEAST(v_paid_amount, v_amount);
  v_status := CASE
    WHEN v_amount <= 0 THEN 'void'
    WHEN v_paid_amount >= v_amount THEN 'settled'
    WHEN v_paid_amount > 0 THEN 'partially_settled'
    ELSE 'open'
  END;

  INSERT INTO public.bl_receivables (
    bl_id, customer_id, source, original_amount_brl, settled_amount_brl, balance_brl,
    status, voyage_id, cargo_mode, pol, pod, roe_frozen, roe_effective_date_frozen, updated_at
  )
  VALUES (
    v_bl.id, v_bl.customer_id, 'local_charges', v_amount, v_paid_amount,
    GREATEST(v_amount - v_paid_amount, 0), v_status, v_bl.voyage_id,
    v_bl.cargo_mode, v_bl.pol, v_bl.pod, v_roe, v_roe_effective_date, now()
  )
  ON CONFLICT (source, bl_id)
  DO UPDATE SET
    customer_id = EXCLUDED.customer_id,
    original_amount_brl = EXCLUDED.original_amount_brl,
    settled_amount_brl = EXCLUDED.settled_amount_brl,
    balance_brl = EXCLUDED.balance_brl,
    status = EXCLUDED.status,
    voyage_id = EXCLUDED.voyage_id,
    cargo_mode = EXCLUDED.cargo_mode,
    pol = EXCLUDED.pol,
    pod = EXCLUDED.pod,
    roe_frozen = EXCLUDED.roe_frozen,
    roe_effective_date_frozen = EXCLUDED.roe_effective_date_frozen,
    updated_at = now()
  RETURNING id INTO v_receivable_id;

  RETURN v_receivable_id;
END;
$$;

-- Readiness de comunicado mede CE, revisão e financeiro; Portal é gate de
-- emissão e não uma pré-condição disfarçada da comunicação.
CREATE OR REPLACE FUNCTION public.customer_local_charges_communication_readiness(p_voyage_id bigint, p_customer_id bigint) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_active_read_user()) THEN
    RAISE EXCEPTION 'Usuário interno ativo é obrigatório.' USING ERRCODE = '42501';
  END IF;

  IF p_voyage_id IS NULL OR p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Viagem e cliente são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  WITH bl_state AS (
    SELECT
      b.id AS bl_id,
      NULLIF(btrim(b.ce_mercante), '') AS ce_mercante,
      COALESCE(b.financial_status, 'pending') AS financial_status,
      COALESCE(b.cargo_mode, 'container') AS cargo_mode,
      b.bb_weight_ton,
      array_remove(ARRAY[
        CASE WHEN b.review_status = 'pending_review' THEN 'revisao_pendente'::TEXT END,
        CASE WHEN COALESCE(b.cargo_mode, 'container') = 'carga_solta'
                  AND (b.bb_weight_ton IS NULL OR b.bb_weight_ton <= 0)
             THEN 'peso_bb_ausente'::TEXT END
      ], NULL) AS review_pendencies
    FROM public.bls AS b
    WHERE b.voyage_id = p_voyage_id
      AND b.customer_id = p_customer_id
      -- B/L cancelado não participa do resumo nem pode bloquear o cliente.
      AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
  ), annotated AS (
    SELECT
      bl_state.*,
      array_remove(ARRAY[
        CASE WHEN bl_state.ce_mercante IS NULL THEN 'ce_mercante_ausente'::TEXT END,
        CASE WHEN COALESCE(cardinality(bl_state.review_pendencies), 0) > 0 THEN 'revisao_pendente'::TEXT END,
        CASE WHEN bl_state.financial_status NOT IN ('invoiced', 'paid') THEN 'faturamento_pendente'::TEXT END
      ], NULL) AS blocked_reasons
    FROM bl_state
  ), aggregate AS (
    SELECT
      count(*)::INTEGER AS bl_count,
      count(*) FILTER (WHERE cardinality(blocked_reasons) > 0)::INTEGER AS blocked_bl_count,
      COALESCE(bool_and(cardinality(blocked_reasons) = 0), false) AS ready,
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'bl_id', bl_id,
          'ce_mercante', ce_mercante,
          'financial_status', financial_status,
          'cargo_mode', cargo_mode,
          'review_pendencies', to_jsonb(review_pendencies),
          'blocked_reasons', to_jsonb(blocked_reasons)
        ) ORDER BY bl_id
      ), '[]'::JSONB) AS bls
    FROM annotated
  ), reason_aggregate AS (
    SELECT COALESCE(jsonb_agg(DISTINCT reason ORDER BY reason), '[]'::JSONB) AS reasons
    FROM annotated
    CROSS JOIN LATERAL unnest(annotated.blocked_reasons) AS reason
  )
  SELECT jsonb_build_object(
    'voyage_id', p_voyage_id,
    'customer_id', p_customer_id,
    'ready', CASE WHEN bl_count = 0 THEN false ELSE ready END,
    'reason_code', CASE
      WHEN bl_count = 0 THEN 'no_bls'
      WHEN ready THEN 'ready'
      ELSE COALESCE(reasons ->> 0, 'readiness_blocked')
    END,
    'bl_count', bl_count,
    'blocked_bl_count', blocked_bl_count,
    'reasons', reasons,
    'bls', bls
  )
  INTO v_result
  FROM aggregate CROSS JOIN reason_aggregate;

  RETURN v_result;
END;
$$;
