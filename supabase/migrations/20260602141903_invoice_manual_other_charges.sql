-- Other Charges manuais em faturas de Taxas Locais.
-- Permite acrescentar/remover um item manual (linha livre, BRL) direto no detalhe
-- da fatura, espelhando a aba "Cobrancas" do BL. Mantem total_brl, balance_brl e
-- o payload PIX consistentes no servidor.
--
-- Regras de negocio:
--   * Apenas faturas nao consolidadas (invoice_type <> 'consolidated'), pois o
--     total de consolidadas vem de invoice_receivable_links, nao de invoice_items.
--   * Apenas faturas sem pagamentos registrados e nao canceladas.
--   * Recalcula total_brl/balance_brl e zera pix_payload (o trigger BEFORE
--     trg_populate_local_invoice_pix_payload regenera o payload pelo novo total).
--
-- Rollback: DROP FUNCTION public.add_manual_invoice_charge(BIGINT, TEXT, NUMERIC, NUMERIC, TEXT, UUID);
--           DROP FUNCTION public.delete_manual_invoice_charge(BIGINT, UUID);

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

  IF COALESCE(v_invoice.status, 'issued') = 'cancelled' THEN
    RAISE EXCEPTION 'Nao e permitido alterar fatura cancelada.' USING ERRCODE = '22023';
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

  IF COALESCE(v_invoice.status, 'issued') = 'cancelled' THEN
    RAISE EXCEPTION 'Nao e permitido alterar fatura cancelada.' USING ERRCODE = '22023';
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

REVOKE ALL ON FUNCTION public.add_manual_invoice_charge(BIGINT, TEXT, NUMERIC, NUMERIC, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_manual_invoice_charge(BIGINT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_manual_invoice_charge(BIGINT, TEXT, NUMERIC, NUMERIC, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_manual_invoice_charge(BIGINT, UUID) TO authenticated;
