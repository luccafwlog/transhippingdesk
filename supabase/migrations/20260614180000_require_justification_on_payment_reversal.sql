-- Cancelamento de baixa (estorno) so pode ocorrer mediante justificativa e por
-- administrador. O is_admin() ja era exigido; aqui adicionamos a obrigatoriedade
-- da justificativa (p_reason nao pode ser vazio) em ambos os RPCs de estorno.
--
-- Rollback: restaurar reverse_invoice_payment da migration
-- 20260614120000_guard_manual_charges_and_clear_pix_on_reversal.sql e
-- reverse_demurrage_payment da migration 20260613170000_reverse_invoice_payment.sql.

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

  -- Atualiza financial_status dos BLs vinculados
  UPDATE public.bls b
  SET financial_status = (
    SELECT CASE
      WHEN COUNT(*) FILTER (WHERE br.balance_brl > 0.01) = 0 THEN 'paid'
      WHEN COUNT(*) FILTER (WHERE br.balance_brl > 0.01) < COUNT(*) THEN 'partially_paid'
      ELSE 'open'
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

CREATE OR REPLACE FUNCTION public.reverse_demurrage_payment(
  p_invoice_id BIGINT,
  p_reason TEXT DEFAULT NULL,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_old_status TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao.' USING ERRCODE = '42501';
  END IF;

  -- Justificativa obrigatoria para cancelar a baixa.
  IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa para cancelar a baixa.' USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT status INTO v_old_status
  FROM public.demurrage_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demurrage invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_old_status, '') <> 'paid' THEN
    RAISE EXCEPTION 'Demurrage invoice % nao esta paga (status=%).', p_invoice_id, COALESCE(v_old_status, '?')
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.demurrage_invoices
  SET
    status = 'issued',
    paid_at = NULL,
    pix_txid = NULL
  WHERE id = p_invoice_id;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES (
    'demurrage_invoice', p_invoice_id::TEXT, 'payment_reversed',
    v_old_status,
    'issued',
    v_actor, now(),
    TRIM(p_reason)
  );

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'new_status', 'issued'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_demurrage_payment(BIGINT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_demurrage_payment(BIGINT, TEXT, UUID) TO authenticated;
