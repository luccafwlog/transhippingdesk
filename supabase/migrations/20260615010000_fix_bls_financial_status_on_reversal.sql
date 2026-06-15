-- Bug: ao cancelar a baixa de uma fatura local, reverse_invoice_payment
-- recalculava bls.financial_status usando 'partially_paid'/'open', valores que
-- NAO existem no constraint bls_financial_status_check
-- (permitidos: 'pending','invoiced','paid','cancelled'). Isso disparava
-- "new row for relation \"bls\" violates check constraint
-- \"bls_financial_status_check\"" e abortava o cancelamento.
--
-- Correcao: mapear para o vocabulario valido de bls -> 'paid' quando todos os
-- receivables do BL estao liquidados, senao 'invoiced' (o BL continua faturado,
-- com saldo em aberto). Demais comportamentos inalterados.
--
-- Rollback: restaurar reverse_invoice_payment da migration
-- 20260614180000_require_justification_on_payment_reversal.sql.

CREATE OR REPLACE FUNCTION public.reverse_invoice_payment(
  p_payment_id BIGINT,
  p_reason TEXT DEFAULT NULL,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
        WHEN GREATEST(COALESCE(balance_brl, 0) + v_settlement.amount_brl, 0) >= original_amount_brl - 0.01 THEN 'open'
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
        AND br.balance_brl > 0.01
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
      WHEN v_total_paid <= 0.01 AND GREATEST(v_balance, 0) >= (SELECT COALESCE(SUM(original_amount_brl), 0) FROM public.bl_receivables WHERE id IN (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = v_payment.invoice_id)) - 0.01 THEN 'issued'
      WHEN v_total_paid <= 0.01 THEN 'issued'
      WHEN GREATEST(v_balance, 0) <= 0.01 THEN 'paid'
      ELSE 'partially_paid'
    END
  WHERE id = v_payment.invoice_id;

  -- Se a invoice estava 'paid' e agora tem saldo > 0, reverte coberturas/obsolescencia
  IF COALESCE(v_invoice.status, '') IN ('paid') AND v_balance > 0.01 THEN
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
      WHEN COUNT(*) FILTER (WHERE br.balance_brl > 0.01) = 0 THEN 'paid'
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

REVOKE ALL ON FUNCTION public.reverse_invoice_payment(BIGINT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_invoice_payment(BIGINT, TEXT, UUID) TO authenticated;
