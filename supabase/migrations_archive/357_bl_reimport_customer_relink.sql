-- 357: reimportação de B/L troca o consignatário e leva a fatura junto.
--
-- Dois furos da reimportação, ambos silenciosos:
--
-- 1. `customer_id` só era adotado quando o B/L estava sem vínculo
--    (`bls.customer_id IS NULL`, migration 163). Reimportar um B/L com outro
--    consignatário trocava `consignee` e `manifest_customer_cnpj_cpf`, mas o
--    B/L continuava pertencendo ao cliente errado — e a fatura emitida também.
--    O lançamento errado do consignatário é justamente o motivo mais comum de
--    reimportar, e acontece depois do CE Mercante (que não muda) e depois da
--    fatura (cujo valor não muda; só o pagador).
--
-- 2. `voyage_id`, `pol`, `pod` e `cargo_mode` eram descartados em silêncio em
--    B/L faturado (guarda `v_unlocked_bls`, migration 205): o preview mostrava
--    a mudança e a RPC não gravava, sem override possível. Passam a seguir a
--    mesma regra dos demais campos de faturamento da ADR 0017 — bloqueados por
--    padrão, sobrescrevíveis com `override_billing` e auditoria.
--
-- Rollback: restaurar o wrapper da migration 322 e remover
-- `public.relink_bl_customer`; não desfazer vínculos ou faturas já transferidos.

-- ---------------------------------------------------------------------------
-- 1. Troca de dono do B/L e do que já foi faturado nele
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.relink_bl_customer(
  p_bl_id TEXT,
  p_customer_id BIGINT,
  p_changed_by UUID,
  p_reason TEXT DEFAULT 'Troca de consignatario na reimportacao do B/L'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_blockers TEXT[] := ARRAY[]::TEXT[];
  v_invoice RECORD;
  v_moved_invoices TEXT[] := ARRAY[]::TEXT[];
  v_has_financials BOOLEAN;
  v_status TEXT;
BEGIN
  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('bl_id', p_bl_id, 'applied', false, 'blockers', ARRAY['B/L nao encontrado.']);
  END IF;

  IF v_bl.customer_id IS NOT DISTINCT FROM p_customer_id THEN
    RETURN jsonb_build_object('bl_id', p_bl_id, 'applied', false, 'blockers', ARRAY[]::TEXT[], 'unchanged', true);
  END IF;

  IF p_customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
    RETURN jsonb_build_object(
      'bl_id', p_bl_id,
      'applied', false,
      'blockers', ARRAY['Cliente de destino nao existe.']
    );
  END IF;

  -- Uma fatura só troca de dono enquanto ninguém pagou nada nela e ela cobre
  -- apenas este B/L. Consolidada ou com pagamento, transferir reescreveria
  -- histórico de recebimento — vira trabalho manual do financeiro.
  FOR v_invoice IN
    SELECT
      i.id,
      i.invoice_number,
      i.status,
      i.total_paid_brl,
      (SELECT COUNT(*) FROM public.invoice_bls AS ib2 WHERE ib2.invoice_id = i.id) AS bl_count
    FROM public.invoice_bls AS ib
    JOIN public.invoices AS i ON i.id = ib.invoice_id
    WHERE ib.bl_id = p_bl_id
      AND i.status NOT IN ('cancelled', 'obsolete')
    ORDER BY i.id
  LOOP
    IF v_invoice.bl_count > 1 THEN
      v_blockers := array_append(
        v_blockers,
        format('Fatura %s e consolidada com outros B/Ls.', v_invoice.invoice_number)
      );
    ELSIF COALESCE(v_invoice.total_paid_brl, 0) > 0 OR v_invoice.status = 'paid' THEN
      v_blockers := array_append(
        v_blockers,
        format('Fatura %s ja tem pagamento registrado.', v_invoice.invoice_number)
      );
    END IF;
  END LOOP;

  FOR v_invoice IN
    SELECT id, doc_number, status
    FROM public.demurrage_invoices
    WHERE bl_id = p_bl_id
      AND COALESCE(status, '') NOT IN ('cancelled', 'obsolete')
    ORDER BY id
  LOOP
    IF v_invoice.status = 'paid' THEN
      v_blockers := array_append(
        v_blockers,
        format('Demurrage %s ja esta quitada.', v_invoice.doc_number)
      );
    END IF;
  END LOOP;

  v_has_financials :=
    EXISTS (
      SELECT 1
      FROM public.invoice_bls AS ib
      JOIN public.invoices AS i ON i.id = ib.invoice_id
      WHERE ib.bl_id = p_bl_id AND i.status NOT IN ('cancelled', 'obsolete')
    )
    OR EXISTS (SELECT 1 FROM public.bl_receivables WHERE bl_id = p_bl_id AND status <> 'void')
    OR EXISTS (
      SELECT 1 FROM public.demurrage_invoices
      WHERE bl_id = p_bl_id AND COALESCE(status, '') NOT IN ('cancelled', 'obsolete')
    );

  -- Sem cliente de destino cadastrado não há para onde mover a cobrança:
  -- `bl_receivables.customer_id` e `invoices.customer_id` são NOT NULL.
  IF p_customer_id IS NULL AND v_has_financials THEN
    v_blockers := array_append(
      v_blockers,
      'Novo consignatario nao esta cadastrado como cliente; cadastre-o antes de trocar o B/L faturado.'
    );
  END IF;

  IF cardinality(v_blockers) > 0 THEN
    RETURN jsonb_build_object('bl_id', p_bl_id, 'applied', false, 'blockers', v_blockers);
  END IF;

  UPDATE public.bls
  SET
    customer_id = p_customer_id,
    customer_reconciliation_status = CASE WHEN p_customer_id IS NULL THEN 'missing_customer' ELSE 'reconciled' END,
    customer_reconciliation_notes = CASE
      WHEN p_customer_id IS NULL THEN 'Consignatario reimportado ainda sem cliente cadastrado.'
      ELSE 'Cliente trocado pela reimportacao do B/L (novo consignatario).'
    END,
    billing_hold_reason = CASE
      WHEN p_customer_id IS NULL THEN 'Aguardando reconciliacao de cliente antes do faturamento.'
      ELSE NULL
    END
  WHERE id = p_bl_id;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bl', p_bl_id, 'customer_id', v_bl.customer_id::TEXT, p_customer_id::TEXT, p_changed_by, p_reason);

  IF p_customer_id IS NOT NULL THEN
    -- O valor devido não muda; muda o cliente vinculado à fatura.
    FOR v_invoice IN
      SELECT i.id, i.invoice_number, i.customer_id
      FROM public.invoice_bls AS ib
      JOIN public.invoices AS i ON i.id = ib.invoice_id
      WHERE ib.bl_id = p_bl_id
        AND i.status NOT IN ('cancelled', 'obsolete')
        AND i.customer_id IS DISTINCT FROM p_customer_id
      ORDER BY i.id
    LOOP
      UPDATE public.invoices SET customer_id = p_customer_id, updated_at = now() WHERE id = v_invoice.id;
      v_moved_invoices := array_append(v_moved_invoices, v_invoice.invoice_number);

      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('invoice', v_invoice.id::TEXT, 'customer_id', v_invoice.customer_id::TEXT, p_customer_id::TEXT, p_changed_by, p_reason);
    END LOOP;

    FOR v_invoice IN
      SELECT id, doc_number, customer_id
      FROM public.demurrage_invoices
      WHERE bl_id = p_bl_id
        AND COALESCE(status, '') NOT IN ('cancelled', 'obsolete')
        AND customer_id IS DISTINCT FROM p_customer_id
      ORDER BY id
    LOOP
      UPDATE public.demurrage_invoices SET customer_id = p_customer_id, updated_at = now() WHERE id = v_invoice.id;
      v_moved_invoices := array_append(v_moved_invoices, v_invoice.doc_number);

      -- `bl_timeline` (migration 130) só resolve 'bl', 'invoice', 'bl_container',
      -- 'charge_calculation' e 'system_event'; a linha própria da demurrage já
      -- é gravada pelo trigger genérico (294), e esta entra sob o B/L para a
      -- troca aparecer no Histórico com a justificativa.
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('bl', p_bl_id, format('demurrage_%s_customer_id', v_invoice.doc_number), v_invoice.customer_id::TEXT, p_customer_id::TEXT, p_changed_by, p_reason);
    END LOOP;

    UPDATE public.bl_receivables
    SET customer_id = p_customer_id, updated_at = now()
    WHERE bl_id = p_bl_id
      AND customer_id IS DISTINCT FROM p_customer_id;
  END IF;

  PERFORM public.sync_customer_reconciliation_queue_for_bl(p_bl_id);

  SELECT review_status INTO v_status FROM public.bls WHERE id = p_bl_id;

  RETURN jsonb_build_object(
    'bl_id', p_bl_id,
    'applied', true,
    'blockers', ARRAY[]::TEXT[],
    'from_customer_id', v_bl.customer_id,
    'to_customer_id', p_customer_id,
    'moved_invoices', to_jsonb(v_moved_invoices),
    'review_status', v_status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.relink_bl_customer(TEXT, BIGINT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Wrapper da importação: campos de rota com override e troca de cliente
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.import_bl_freight_transactional(JSONB, UUID)
  RENAME TO import_bl_freight_transactional_legacy_322;

REVOKE ALL ON FUNCTION public.import_bl_freight_transactional_legacy_322(JSONB, UUID)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional(p_bls JSONB, p_changed_by UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result JSONB;
  v_item JSONB;
  v_bl_id TEXT;
  v_billed BOOLEAN;
  v_before public.bls%ROWTYPE;
  v_relinks JSONB := '[]'::JSONB;
  v_relink JSONB;
  v_route_fields TEXT[] := ARRAY['voyage_id', 'pol', 'pod', 'cargo_mode'];
BEGIN
  v_result := public.import_bl_freight_transactional_legacy_322(p_bls, p_changed_by);

  FOR v_item IN SELECT item FROM jsonb_array_elements(COALESCE(p_bls, '[]'::JSONB)) AS item
  LOOP
    v_bl_id := v_item->>'id';
    CONTINUE WHEN v_bl_id IS NULL;

    SELECT * INTO v_before FROM public.bls WHERE id = v_bl_id;
    CONTINUE WHEN NOT FOUND;

    v_billed :=
      EXISTS (SELECT 1 FROM public.charge_calculations WHERE bl_id = v_bl_id)
      OR EXISTS (SELECT 1 FROM public.invoice_bls WHERE bl_id = v_bl_id);

    -- Rota e viagem de B/L faturado: a 205 as descartava mesmo com override.
    IF v_billed AND COALESCE((v_item->>'override_billing')::BOOLEAN, false) THEN
      UPDATE public.bls
      SET
        voyage_id  = CASE WHEN v_item ? 'voyage_id'  THEN NULLIF(v_item->>'voyage_id', '')::BIGINT ELSE voyage_id END,
        pol        = CASE WHEN v_item ? 'pol'        THEN NULLIF(v_item->>'pol', '') ELSE pol END,
        pod        = CASE WHEN v_item ? 'pod'        THEN NULLIF(v_item->>'pod', '') ELSE pod END,
        cargo_mode = CASE WHEN v_item ? 'cargo_mode' THEN COALESCE(NULLIF(v_item->>'cargo_mode', ''), cargo_mode) ELSE cargo_mode END
      WHERE id = v_bl_id;

      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      SELECT
        'bl',
        v_bl_id,
        audited.field_name,
        to_jsonb(v_before)->>audited.field_name,
        to_jsonb(b)->>audited.field_name,
        p_changed_by,
        'Reimportacao de B/L faturado com override: rota/viagem sobrescritas'
      FROM public.bls AS b
      CROSS JOIN unnest(v_route_fields) AS audited(field_name)
      WHERE b.id = v_bl_id
        AND COALESCE(to_jsonb(v_before)->>audited.field_name, '')
            IS DISTINCT FROM COALESCE(to_jsonb(b)->>audited.field_name, '');
    END IF;

    -- Troca de consignatário aceita pelo operador no preview.
    IF COALESCE((v_item->>'relink_customer')::BOOLEAN, false) THEN
      v_relink := public.relink_bl_customer(
        v_bl_id,
        NULLIF(v_item->>'customer_id', '')::BIGINT,
        p_changed_by
      );
      v_relinks := v_relinks || jsonb_build_array(v_relink);

      -- Aceitar a troca autoriza também o documento do consignatário: a `205`
      -- protege `manifest_customer_cnpj_cpf`/`_name` em B/L faturado sem
      -- `override_billing`, e sem isto o B/L ficaria com o cliente novo e o
      -- CNPJ antigo.
      IF COALESCE((v_relink->>'applied')::BOOLEAN, false) THEN
        UPDATE public.bls
        SET
          manifest_customer_cnpj_cpf = CASE
            WHEN v_item ? 'manifest_customer_cnpj_cpf'
              THEN public.normalize_document_text(v_item->>'manifest_customer_cnpj_cpf')
            ELSE manifest_customer_cnpj_cpf
          END,
          manifest_customer_name = CASE
            WHEN v_item ? 'manifest_customer_name'
              THEN COALESCE(NULLIF(v_item->>'manifest_customer_name', ''), manifest_customer_name)
            ELSE manifest_customer_name
          END
        WHERE id = v_bl_id;
      END IF;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_relinks) > 0 THEN
    PERFORM public.apply_bl_review_gate_after_import(
      ARRAY(SELECT entry->>'bl_id' FROM jsonb_array_elements(v_relinks) AS entry),
      p_changed_by
    );
  END IF;

  RETURN COALESCE(v_result, '{}'::JSONB) || jsonb_build_object('customer_relinks', v_relinks);
END;
$function$;

REVOKE ALL ON FUNCTION public.import_bl_freight_transactional(JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bl_freight_transactional(JSONB, UUID) TO authenticated;
