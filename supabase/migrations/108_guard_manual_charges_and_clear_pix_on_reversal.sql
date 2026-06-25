-- Renumbered from 20260614120000 (original timestamped migration: 20260614120000_guard_manual_charges_and_clear_pix_on_reversal.sql).
-- Correcoes de logica de faturamento/conciliacao (auditoria da pagina Conciliacao).
--
-- A) add/update/delete_manual_bl_charge: bloquear lancamento de taxa manual em B/L
--    cujo estado financeiro ja avancou para faturado/pago. Antes, o RPC ignorava
--    bls.financial_status, permitindo divergir o "calculado no B/L" da fatura ja emitida.
--
-- B) add/delete_manual_invoice_charge: restringir edicao de itens manuais a faturas
--    realmente em aberto (issued/overdue/draft). A trava anterior ('status <> cancelled'
--    + sem pagamentos) deixava passar faturas 'covered'/'obsolete' (quitadas via
--    consolidada/individual), que nao tem linha em payments.
--
-- C) reverse_invoice_payment: ao estornar a baixa, limpar invoices.pix_txid e
--    conciliated_by_extract para que o mesmo PIX possa ser reconciliado novamente
--    (espelha o comportamento ja existente em reverse_demurrage_payment).
--
-- Rollback: reaplicar as definicoes anteriores das funcoes
--   (migrations 019_local_charges_manual_and_status_workflow.sql,
--    20260602141903_invoice_manual_other_charges.sql,
--    20260613170000_reverse_invoice_payment.sql).

-- ===========================================================================
-- A) Taxas manuais por B/L: travar quando o B/L ja foi faturado/pago
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.add_manual_bl_charge(
  p_bl_id TEXT,
  p_charge_item_id BIGINT,
  p_quantity NUMERIC DEFAULT 1,
  p_notes TEXT DEFAULT NULL,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bl RECORD;
  v_item RECORD;
  v_actor UUID;
  v_qty NUMERIC(12,6);
  v_unit_brl NUMERIC(12,2);
  v_unit_usd NUMERIC(12,2);
  v_total_brl NUMERIC(14,2);
  v_total_usd NUMERIC(14,2);
  v_key TEXT;
  v_calc_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT
    b.id,
    b.customer_id,
    COALESCE(b.cargo_mode, 'container') AS cargo_mode,
    b.pod,
    b.charge_status,
    b.financial_status,
    COALESCE(ib.uploaded_at::DATE, b.created_at::DATE, CURRENT_DATE) AS reference_date
  INTO v_bl
  FROM public.bls AS b
  LEFT JOIN public.import_batches AS ib ON ib.id = b.batch_id
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_bl.financial_status, 'open') IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % ja foi faturado (status financeiro=%); nao e permitido lancar taxa manual.',
      p_bl_id, v_bl.financial_status USING ERRCODE = '22023';
  END IF;

  SELECT
    cti.id,
    cti.name,
    COALESCE(cti.currency, 'BRL') AS currency,
    cti.unit_value_brl,
    cti.unit_value_usd,
    cti.value_brl,
    ct.id AS charge_table_id,
    ct.name AS charge_table_name,
    ct.cargo_mode,
    ct.pod,
    cro.override_value
  INTO v_item
  FROM public.charge_table_items AS cti
  JOIN public.charge_tables AS ct
    ON ct.id = cti.charge_table_id
   AND ct.active = true
   AND ct.cargo_mode = v_bl.cargo_mode
   AND (
     public.normalize_port_code(ct.pod) = public.normalize_port_code(v_bl.pod)
     OR UPPER(TRIM(COALESCE(ct.pod, ''))) = 'ANY'
   )
   AND ct.valid_from <= v_bl.reference_date
   AND (ct.valid_to IS NULL OR ct.valid_to >= v_bl.reference_date)
  LEFT JOIN LATERAL (
    SELECT cro.override_value
    FROM public.customer_rate_overrides AS cro
    WHERE cro.customer_id = v_bl.customer_id
      AND cro.charge_item_id = cti.id
      AND (cro.valid_from IS NULL OR cro.valid_from <= v_bl.reference_date)
      AND (cro.valid_to IS NULL OR cro.valid_to >= v_bl.reference_date)
    ORDER BY cro.created_at DESC
    LIMIT 1
  ) AS cro ON TRUE
  WHERE cti.id = p_charge_item_id
    AND COALESCE(cti.active, true) = true
    AND COALESCE(cti.manual_only, false) = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item manual % nao elegivel para este B/L', p_charge_item_id USING ERRCODE = '22023';
  END IF;

  v_qty := COALESCE(p_quantity, 1);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero' USING ERRCODE = '22023';
  END IF;

  IF v_item.currency = 'USD' THEN
    v_unit_brl := NULL;
    v_unit_usd := COALESCE(v_item.override_value, v_item.unit_value_usd, 0);
    v_total_brl := NULL;
    v_total_usd := ROUND(v_qty * COALESCE(v_unit_usd, 0), 2);
  ELSE
    v_unit_brl := COALESCE(v_item.override_value, v_item.unit_value_brl, v_item.value_brl, 0);
    v_unit_usd := NULL;
    v_total_brl := ROUND(v_qty * COALESCE(v_unit_brl, 0), 2);
    v_total_usd := NULL;
  END IF;

  v_key := CONCAT(
    'manual:item:', p_charge_item_id, ':',
    EXTRACT(EPOCH FROM clock_timestamp())::BIGINT, ':',
    FLOOR(RANDOM() * 100000)::INT
  );

  INSERT INTO public.charge_calculations (
    bl_id,
    charge_table_id,
    charge_item_id,
    quantity,
    unit_value_brl,
    unit_value_usd,
    total_value_brl,
    total_value_usd,
    override_applied,
    source,
    status,
    calculation_key,
    notes,
    manual_reason,
    created_by,
    calculated_at
  )
  VALUES (
    p_bl_id,
    v_item.charge_table_id,
    p_charge_item_id,
    v_qty,
    v_unit_brl,
    v_unit_usd,
    v_total_brl,
    v_total_usd,
    v_item.override_value IS NOT NULL,
    'manual',
    'reviewed',
    v_key,
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    'other_charge_manual',
    v_actor,
    NOW()
  )
  RETURNING id INTO v_calc_id;

  UPDATE public.bls
  SET
    charge_status = CASE
      WHEN charge_status IN ('not_calculated', 'exempt') THEN 'reviewed'
      ELSE charge_status
    END,
    charges_calculated_at = COALESCE(charges_calculated_at, NOW()),
    charges_reviewed_at = CASE
      WHEN charge_status IN ('not_calculated', 'exempt') THEN NOW()
      ELSE charges_reviewed_at
    END
  WHERE id = p_bl_id;

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    changed_at,
    justification
  )
  VALUES (
    'charge_calculation',
    v_calc_id::TEXT,
    'manual_insert',
    NULL,
    CONCAT(v_item.name, ' | qty=', v_qty, ' | total=', COALESCE(v_total_brl::TEXT, v_total_usd::TEXT)),
    auth.uid(),
    NOW(),
    COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Lancamento manual de other charge')
  );

  RETURN jsonb_build_object(
    'id', v_calc_id,
    'bl_id', p_bl_id,
    'status', 'reviewed',
    'currency', v_item.currency,
    'quantity', v_qty,
    'unit_value_brl', v_unit_brl,
    'unit_value_usd', v_unit_usd,
    'total_value_brl', v_total_brl,
    'total_value_usd', v_total_usd
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_manual_bl_charge(
  p_charge_calculation_id BIGINT,
  p_quantity NUMERIC,
  p_notes TEXT DEFAULT NULL,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row RECORD;
  v_qty NUMERIC(12,6);
  v_total_brl NUMERIC(14,2);
  v_total_usd NUMERIC(14,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  SELECT
    cc.id,
    cc.bl_id,
    cc.source,
    cc.quantity,
    cc.unit_value_brl,
    cc.unit_value_usd,
    cc.total_value_brl,
    cc.total_value_usd,
    cc.notes,
    b.financial_status AS bl_financial_status
  INTO v_row
  FROM public.charge_calculations AS cc
  LEFT JOIN public.bls AS b ON b.id = cc.bl_id
  WHERE cc.id = p_charge_calculation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha de calculo % nao encontrada', p_charge_calculation_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_row.source, '') <> 'manual' THEN
    RAISE EXCEPTION 'Somente linhas manuais podem ser editadas' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_row.bl_financial_status, 'open') IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % ja foi faturado; nao e permitido editar taxa manual.', v_row.bl_id
      USING ERRCODE = '22023';
  END IF;

  v_qty := COALESCE(p_quantity, v_row.quantity, 1);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero' USING ERRCODE = '22023';
  END IF;

  v_total_brl := CASE WHEN v_row.unit_value_brl IS NULL THEN NULL ELSE ROUND(v_qty * v_row.unit_value_brl, 2) END;
  v_total_usd := CASE WHEN v_row.unit_value_usd IS NULL THEN NULL ELSE ROUND(v_qty * v_row.unit_value_usd, 2) END;

  UPDATE public.charge_calculations
  SET
    quantity = v_qty,
    total_value_brl = v_total_brl,
    total_value_usd = v_total_usd,
    notes = NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    calculated_at = NOW()
  WHERE id = p_charge_calculation_id;

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    changed_at,
    justification
  )
  VALUES (
    'charge_calculation',
    p_charge_calculation_id::TEXT,
    'manual_update',
    CONCAT('qty=', COALESCE(v_row.quantity::TEXT, '0'), ' | note=', COALESCE(v_row.notes, '')),
    CONCAT('qty=', v_qty, ' | note=', COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), '')),
    auth.uid(),
    NOW(),
    COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Atualizacao manual de other charge')
  );

  RETURN jsonb_build_object(
    'id', p_charge_calculation_id,
    'bl_id', v_row.bl_id,
    'quantity', v_qty,
    'total_value_brl', v_total_brl,
    'total_value_usd', v_total_usd
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_manual_bl_charge(
  p_charge_calculation_id BIGINT,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row RECORD;
  v_bl_id TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  SELECT
    cc.id,
    cc.bl_id,
    cc.source,
    cc.charge_item_id,
    cc.quantity,
    cc.total_value_brl,
    cc.total_value_usd,
    b.financial_status AS bl_financial_status
  INTO v_row
  FROM public.charge_calculations AS cc
  LEFT JOIN public.bls AS b ON b.id = cc.bl_id
  WHERE cc.id = p_charge_calculation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha de calculo % nao encontrada', p_charge_calculation_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_row.source, '') <> 'manual' THEN
    RAISE EXCEPTION 'Somente linhas manuais podem ser removidas' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_row.bl_financial_status, 'open') IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % ja foi faturado; nao e permitido remover taxa manual.', v_row.bl_id
      USING ERRCODE = '22023';
  END IF;

  v_bl_id := v_row.bl_id;

  DELETE FROM public.charge_calculations
  WHERE id = p_charge_calculation_id;

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    changed_at,
    justification
  )
  VALUES (
    'charge_calculation',
    p_charge_calculation_id::TEXT,
    'manual_delete',
    CONCAT('charge_item_id=', COALESCE(v_row.charge_item_id::TEXT, '-'), ' | qty=', COALESCE(v_row.quantity::TEXT, '0')),
    NULL,
    auth.uid(),
    NOW(),
    'Remocao manual de other charge'
  );

  RETURN jsonb_build_object(
    'deleted', true,
    'id', p_charge_calculation_id,
    'bl_id', v_bl_id
  );
END;
$$;

-- ===========================================================================
-- B) Taxas manuais por fatura: restringir a faturas realmente em aberto
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.add_manual_invoice_charge(
  p_invoice_id BIGINT,
  p_description TEXT,
  p_quantity NUMERIC,
  p_unit_value_brl NUMERIC,
  p_notes TEXT DEFAULT NULL,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice RECORD;
  v_actor UUID;
  v_desc TEXT;
  v_qty NUMERIC;
  v_unit NUMERIC;
  v_total NUMERIC;
  v_item_id BIGINT;
  v_payment_count INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  v_desc := NULLIF(TRIM(COALESCE(p_description, '')), '');
  IF v_desc IS NULL THEN
    RAISE EXCEPTION 'Descricao do item e obrigatoria.' USING ERRCODE = '22023';
  END IF;

  v_qty := COALESCE(p_quantity, 0);
  v_unit := COALESCE(p_unit_value_brl, 0);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;
  IF v_unit <= 0 THEN
    RAISE EXCEPTION 'Valor unitario deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;
  v_total := ROUND(v_qty * v_unit, 2);

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.invoice_type, 'individual') = 'consolidated' THEN
    RAISE EXCEPTION 'Nao e permitido adicionar itens manuais em fatura consolidada.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') NOT IN ('issued', 'overdue', 'draft') THEN
    RAISE EXCEPTION 'So e permitido adicionar itens em faturas em aberto (status atual: %).',
      COALESCE(v_invoice.status, 'issued') USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_payment_count FROM public.payments WHERE invoice_id = p_invoice_id;
  IF v_payment_count > 0 THEN
    RAISE EXCEPTION 'Nao e permitido adicionar itens em fatura com pagamentos registrados.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.invoice_items (
    invoice_id, description, quantity, unit_value_brl, total_value_brl, source, currency, snapshot_payload
  )
  VALUES (
    p_invoice_id, v_desc, v_qty, v_unit, v_total, 'manual', 'BRL',
    jsonb_build_object(
      'manual', true,
      'notes', NULLIF(TRIM(COALESCE(p_notes, '')), ''),
      'added_by', v_actor,
      'added_at', now()
    )
  )
  RETURNING id INTO v_item_id;

  UPDATE public.invoices
  SET
    total_brl = COALESCE(total_brl, 0) + v_total,
    balance_brl = GREATEST(COALESCE(total_brl, 0) + v_total - COALESCE(total_paid_brl, 0), 0),
    pix_payload = NULL
  WHERE id = p_invoice_id;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES (
    'invoice', p_invoice_id::text, 'manual_charge_added',
    NULL, format('%s: %s x %s = %s BRL', v_desc, v_qty, v_unit, v_total), v_actor,
    NULLIF(TRIM(COALESCE(p_notes, '')), '')
  );

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'item_id', v_item_id, 'total_value_brl', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_manual_invoice_charge(
  p_item_id BIGINT,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item RECORD;
  v_invoice RECORD;
  v_actor UUID;
  v_payment_count INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT * INTO v_item FROM public.invoice_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % nao encontrado.', p_item_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_item.source, '') <> 'manual' THEN
    RAISE EXCEPTION 'Apenas itens manuais podem ser removidos.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = v_item.invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice nao encontrada para o item %.', p_item_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') NOT IN ('issued', 'overdue', 'draft') THEN
    RAISE EXCEPTION 'So e permitido remover itens de faturas em aberto (status atual: %).',
      COALESCE(v_invoice.status, 'issued') USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_payment_count FROM public.payments WHERE invoice_id = v_invoice.id;
  IF v_payment_count > 0 THEN
    RAISE EXCEPTION 'Nao e permitido remover itens em fatura com pagamentos registrados.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.invoice_items WHERE id = p_item_id;

  UPDATE public.invoices
  SET
    total_brl = GREATEST(COALESCE(total_brl, 0) - COALESCE(v_item.total_value_brl, 0), 0),
    balance_brl = GREATEST(COALESCE(total_brl, 0) - COALESCE(v_item.total_value_brl, 0) - COALESCE(total_paid_brl, 0), 0),
    pix_payload = NULL
  WHERE id = v_invoice.id;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
  VALUES (
    'invoice', v_invoice.id::text, 'manual_charge_removed',
    format('%s = %s BRL', v_item.description, v_item.total_value_brl), NULL, v_actor
  );

  RETURN jsonb_build_object('invoice_id', v_invoice.id, 'item_id', p_item_id, 'removed', true);
END;
$$;

-- ===========================================================================
-- C) Estorno de baixa local: liberar o TXID para nova conciliacao
-- ===========================================================================

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
    COALESCE(NULLIF(TRIM(COALESCE(p_reason, '')), ''), 'Estorno de pagamento')
  );

  DELETE FROM public.payments WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'payment_id', p_payment_id,
    'invoice_id', v_payment.invoice_id,
    'new_status', (SELECT status FROM public.invoices WHERE id = v_payment.invoice_id)
  );
END;
$$;

-- Reaplica grants (CREATE OR REPLACE preserva, mas mantemos explicitos por seguranca).
REVOKE ALL ON FUNCTION public.add_manual_bl_charge(TEXT, BIGINT, NUMERIC, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_manual_bl_charge(TEXT, BIGINT, NUMERIC, TEXT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.update_manual_bl_charge(BIGINT, NUMERIC, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_manual_bl_charge(BIGINT, NUMERIC, TEXT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_manual_bl_charge(BIGINT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_manual_bl_charge(BIGINT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.add_manual_invoice_charge(BIGINT, TEXT, NUMERIC, NUMERIC, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_manual_invoice_charge(BIGINT, TEXT, NUMERIC, NUMERIC, TEXT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_manual_invoice_charge(BIGINT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_manual_invoice_charge(BIGINT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.reverse_invoice_payment(BIGINT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_invoice_payment(BIGINT, TEXT, UUID) TO authenticated;
