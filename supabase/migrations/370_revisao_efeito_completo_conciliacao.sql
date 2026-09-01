-- 370: a Revisao passa a produzir o efeito completo da conciliacao de cliente
-- (ADR 0061, item 1 da issue #639).
--
-- A ADR 0061 decidiu que a conciliacao de cliente tem casa unica: a Revisao. A
-- Validacao passa a exibir e apontar, sem decidir. Mas a Revisao ainda nao faz
-- o efeito completo — vincular o cliente por `save_bl_review` sincroniza a fila
-- e nada mais, enquanto `approve_customer_reconciliation` (a rota da Validacao)
-- tambem importa o e-mail do manifesto como contato financeiro do cliente e
-- registra quem resolveu. Remover os botoes da Validacao antes disto seria
-- perder capacidade de produto, nao simplificar tela.
--
-- Tres mudancas, nesta ordem:
--
--   1. `capture_manifest_financial_contact(BIGINT, TEXT)` — a regra de captura
--      do contato vira funcao unica: normaliza o e-mail, ignora vazio e nao
--      duplica contato ja cadastrado para aquele cliente. Antes existia so
--      inline dentro de `approve_customer_reconciliation`; duas copias
--      divergiriam na primeira alteracao, e o ponto desta entrega e justamente
--      os dois caminhos produzirem o MESMO efeito ate a Validacao deixar de
--      decidir.
--
--   2. `approve_customer_reconciliation` — passa a chamar a funcao unica no
--      lugar do INSERT inline. Nenhuma mudanca de comportamento: mesma regra,
--      mesmo texto de contato, mesma checagem de duplicidade.
--
--   3. `save_bl_review` — ao vincular um cliente, captura o contato do
--      manifesto pela mesma funcao e grava `approved_by` na fila com o revisor
--      que salvou. O `approved_by` fica aqui, e nao em
--      `sync_customer_reconciliation_queue_for_bl`, porque o sync tambem roda
--      na importacao, onde nao ha revisor humano decidindo coisa alguma.
--
-- Helper interno: chamado apenas por funcoes SECURITY DEFINER do mesmo owner,
-- entao `authenticated` tambem perde EXECUTE direto. As duas RPCs mantem
-- assinatura, atributos e grants — `CREATE OR REPLACE` preserva a ACL.
--
-- Rollback: reaplicar `approve_customer_reconciliation` da migration 284 e
-- `save_bl_review` da 358 (ambas com o corpo de la), e
-- `DROP FUNCTION public.capture_manifest_financial_contact(BIGINT, TEXT);`.

-- 1. A regra de captura, em um lugar so.
CREATE OR REPLACE FUNCTION public.capture_manifest_financial_contact(
  p_customer_id BIGINT,
  p_email TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_email TEXT;
  v_rowcount INT;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN false;
  END IF;

  v_email := lower(NULLIF(TRIM(COALESCE(p_email, '')), ''));
  IF v_email IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
  SELECT p_customer_id, 'Contato manifesto', v_email, 'financeiro', false
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.customer_contacts AS cc
    WHERE cc.customer_id = p_customer_id
      AND lower(trim(cc.email)) = v_email
  );

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  RETURN v_rowcount > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.capture_manifest_financial_contact(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;

-- 2. A rota da Validacao passa a usar a funcao unica.
CREATE OR REPLACE FUNCTION public.approve_customer_reconciliation(
  p_queue_id BIGINT,
  p_customer_id BIGINT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_queue RECORD;
  v_actor UUID;
  v_target_customer_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT * INTO v_queue
  FROM public.customer_reconciliation_queue
  WHERE id = p_queue_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de reconciliacao % nao encontrado.', p_queue_id USING ERRCODE = 'P0002';
  END IF;

  v_target_customer_id := COALESCE(p_customer_id, v_queue.customer_id);
  IF v_target_customer_id IS NULL THEN
    RAISE EXCEPTION 'Informe um cliente para aprovar a reconciliacao.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bls
  SET
    customer_id = v_target_customer_id,
    suggested_customer_id = NULL,
    customer_reconciliation_status = 'reconciled',
    customer_reconciliation_notes = COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.'),
    billing_hold_reason = NULL
  WHERE id = v_queue.bl_id;

  UPDATE public.customer_reconciliation_queue
  SET
    customer_id = v_target_customer_id,
    status = 'approved',
    resolution_notes = COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.'),
    approved_by = v_actor,
    approved_at = now(),
    rejected_by = NULL,
    rejected_at = NULL
  WHERE id = p_queue_id;

  -- A captura do contato do manifesto agora mora na funcao compartilhada: a
  -- Revisao (`save_bl_review`) precisa do mesmo efeito, e duas copias da regra
  -- divergiriam na primeira alteracao.
  PERFORM public.capture_manifest_financial_contact(
    v_target_customer_id,
    v_queue.manifest_customer_email
  );

  PERFORM public.sync_customer_reconciliation_queue_for_bl(v_queue.bl_id);

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES (
    'bl', v_queue.bl_id, 'customer_reconciliation_status', COALESCE(v_queue.status, 'pending'), 'reconciled',
    v_actor, now(), COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.')
  );

  RETURN jsonb_build_object('queue_id', p_queue_id, 'bl_id', v_queue.bl_id, 'customer_id', v_target_customer_id, 'status', 'approved');
END;
$function$;


REVOKE ALL ON FUNCTION public.approve_customer_reconciliation(BIGINT, BIGINT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_customer_reconciliation(BIGINT, BIGINT, TEXT, UUID) TO authenticated;

-- 3. A Revisao produz o efeito completo.
CREATE OR REPLACE FUNCTION public.save_bl_review(
  p_bl_id TEXT,
  p_expected_updated_at TIMESTAMPTZ,
  p_update_payload JSONB,
  p_audit_rows JSONB,
  p_changed_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_new_updated_at TIMESTAMPTZ;
  v_current_updated_at TIMESTAMPTZ;
  v_next_customer_id BIGINT;
  v_previous_status TEXT;
  v_input_notes TEXT;
  v_human_notes TEXT;
  v_rowcount INT;
  v_reasons TEXT[];
  v_status TEXT;
  v_notes TEXT;
  v_justification TEXT := 'Revisao manual';
  v_manifest_email TEXT;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para revisar B/L.'
      USING ERRCODE = '42501';
  END IF;

  IF p_bl_id IS NULL OR p_bl_id = '' THEN
    RAISE EXCEPTION 'bl_id obrigatorio' USING ERRCODE = '22004';
  END IF;

  SELECT updated_at
  INTO v_current_updated_at
  FROM public.bls
  WHERE id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BL % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND v_current_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuario; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;

  v_next_customer_id := CASE
    WHEN p_update_payload ? 'customer_id'
      THEN NULLIF(p_update_payload->>'customer_id', '')::BIGINT
    ELSE NULL
  END;

  UPDATE public.bls AS b
  SET
    shipper            = CASE WHEN p_update_payload ? 'shipper' THEN p_update_payload->>'shipper' ELSE b.shipper END,
    consignee          = CASE WHEN p_update_payload ? 'consignee' THEN p_update_payload->>'consignee' ELSE b.consignee END,
    notify_party       = CASE WHEN p_update_payload ? 'notify_party' THEN p_update_payload->>'notify_party' ELSE b.notify_party END,
    ce_mercante        = CASE WHEN p_update_payload ? 'ce_mercante' THEN p_update_payload->>'ce_mercante' ELSE b.ce_mercante END,
    pol                = CASE WHEN p_update_payload ? 'pol' THEN p_update_payload->>'pol' ELSE b.pol END,
    pod                = CASE WHEN p_update_payload ? 'pod' THEN p_update_payload->>'pod' ELSE b.pod END,
    place_of_delivery  = CASE WHEN p_update_payload ? 'place_of_delivery' THEN p_update_payload->>'place_of_delivery' ELSE b.place_of_delivery END,
    place_of_receipt   = CASE WHEN p_update_payload ? 'place_of_receipt' THEN p_update_payload->>'place_of_receipt' ELSE b.place_of_receipt END,
    movement_from      = CASE WHEN p_update_payload ? 'movement_from' THEN p_update_payload->>'movement_from' ELSE b.movement_from END,
    movement_to        = CASE WHEN p_update_payload ? 'movement_to' THEN p_update_payload->>'movement_to' ELSE b.movement_to END,
    issue_place        = CASE WHEN p_update_payload ? 'issue_place' THEN p_update_payload->>'issue_place' ELSE b.issue_place END,
    bl_emission_date   = CASE WHEN p_update_payload ? 'bl_emission_date' THEN NULLIF(p_update_payload->>'bl_emission_date', '')::DATE ELSE b.bl_emission_date END,
    cargo_description  = CASE WHEN p_update_payload ? 'cargo_description' THEN p_update_payload->>'cargo_description' ELSE b.cargo_description END,
    total_weight_kg    = CASE WHEN p_update_payload ? 'total_weight_kg' THEN NULLIF(p_update_payload->>'total_weight_kg', '')::NUMERIC ELSE b.total_weight_kg END,
    total_cbm          = CASE WHEN p_update_payload ? 'total_cbm' THEN NULLIF(p_update_payload->>'total_cbm', '')::NUMERIC ELSE b.total_cbm END,
    bb_machine_qty     = CASE WHEN p_update_payload ? 'bb_machine_qty' THEN NULLIF(p_update_payload->>'bb_machine_qty', '')::NUMERIC ELSE b.bb_machine_qty END,
    bb_packages_qty    = CASE WHEN p_update_payload ? 'bb_packages_qty' THEN NULLIF(p_update_payload->>'bb_packages_qty', '')::NUMERIC ELSE b.bb_packages_qty END,
    bb_packages_total  = CASE WHEN p_update_payload ? 'bb_packages_total' THEN NULLIF(p_update_payload->>'bb_packages_total', '')::NUMERIC ELSE b.bb_packages_total END,
    bb_weight_ton      = CASE WHEN p_update_payload ? 'bb_weight_ton' THEN NULLIF(p_update_payload->>'bb_weight_ton', '')::NUMERIC ELSE b.bb_weight_ton END,
    incoterm           = CASE WHEN p_update_payload ? 'incoterm' THEN p_update_payload->>'incoterm' ELSE b.incoterm END,
    payment_type       = CASE WHEN p_update_payload ? 'payment_type' THEN NULLIF(p_update_payload->>'payment_type', '') ELSE b.payment_type END,
    free_time_override = CASE WHEN p_update_payload ? 'free_time_override' THEN NULLIF(p_update_payload->>'free_time_override', '')::INT ELSE b.free_time_override END,
    notes              = CASE WHEN p_update_payload ? 'notes' THEN p_update_payload->>'notes' ELSE b.notes END,
    -- NCM cadastrado a mão na ficha (migration 358). Chega como array JSON de
    -- códigos; `[]` é uma decisão do operador de limpar, não um valor ausente.
    ncm_codes          = CASE
      WHEN p_update_payload ? 'ncm_codes'
        THEN public.normalize_ncm_codes(p_update_payload->'ncm_codes')
      ELSE b.ncm_codes
    END,
    customer_id        = CASE WHEN p_update_payload ? 'customer_id' THEN v_next_customer_id ELSE b.customer_id END,
    customer_reconciliation_status = CASE
      WHEN p_update_payload ? 'customer_reconciliation_status'
        THEN p_update_payload->>'customer_reconciliation_status'
      WHEN p_update_payload ? 'customer_id'
        THEN CASE WHEN v_next_customer_id IS NULL THEN 'missing_customer' ELSE 'reconciled' END
      ELSE b.customer_reconciliation_status
    END,
    customer_reconciliation_notes = CASE
      WHEN p_update_payload ? 'customer_reconciliation_notes'
        THEN NULLIF(p_update_payload->>'customer_reconciliation_notes', '')
      WHEN p_update_payload ? 'customer_id'
        THEN CASE
          WHEN v_next_customer_id IS NULL THEN 'Cliente removido manualmente do B/L.'
          ELSE 'Cliente reconciliado manualmente na revisao do B/L.'
        END
      ELSE b.customer_reconciliation_notes
    END,
    billing_hold_reason = CASE
      WHEN p_update_payload ? 'billing_hold_reason'
        THEN NULLIF(p_update_payload->>'billing_hold_reason', '')
      WHEN p_update_payload ? 'customer_id'
        THEN CASE
          WHEN v_next_customer_id IS NULL
            THEN COALESCE(b.billing_hold_reason, 'Cliente sem reconciliacao aprovada.')
          ELSE NULL
        END
      ELSE b.billing_hold_reason
    END
  WHERE b.id = p_bl_id
    AND (p_expected_updated_at IS NULL OR b.updated_at = p_expected_updated_at)
  RETURNING b.review_status, b.notes
  INTO v_previous_status, v_input_notes;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount = 0 THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuario; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;

  v_reasons := public.compute_bl_review_pendencies(p_bl_id);
  v_status := CASE
    WHEN COALESCE(cardinality(v_reasons), 0) = 0 THEN 'reviewed'
    ELSE 'pending_review'
  END;

  -- The machine-owned line always stays at the end. Human notes remain intact.
  v_human_notes := btrim(
    regexp_replace(
      COALESCE(v_input_notes, ''),
      E'(^|\\n)Pendencias de importacao:[^\\n]*$',
      '',
      'i'
    )
  );

  v_notes := CASE
    WHEN COALESCE(cardinality(v_reasons), 0) > 0 THEN concat_ws(
      E'\n',
      NULLIF(v_human_notes, ''),
      'Pendencias de importacao: ' || array_to_string(v_reasons, ', ')
    )
    ELSE NULLIF(v_human_notes, '')
  END;

  UPDATE public.bls AS b
  SET
    review_status = v_status,
    notes = v_notes
  WHERE b.id = p_bl_id
  RETURNING b.updated_at INTO v_new_updated_at;

  IF p_audit_rows IS NOT NULL
     AND jsonb_typeof(p_audit_rows) = 'array'
     AND jsonb_array_length(p_audit_rows) > 0 THEN
    SELECT COALESCE(NULLIF(a->>'justification', ''), v_justification)
    INTO v_justification
    FROM jsonb_array_elements(p_audit_rows) AS a
    LIMIT 1;

    INSERT INTO public.audit_logs (
      entity_type,
      entity_id,
      field_name,
      old_value,
      new_value,
      changed_by,
      justification
    )
    SELECT
      COALESCE(a->>'entity_type', 'bl'),
      COALESCE(a->>'entity_id', p_bl_id),
      a->>'field_name',
      a->>'old_value',
      a->>'new_value',
      p_changed_by,
      COALESCE(NULLIF(a->>'justification', ''), v_justification)
    FROM jsonb_array_elements(p_audit_rows) AS a
    WHERE a->>'field_name' IS DISTINCT FROM 'review_status';
  END IF;

  IF v_previous_status IS DISTINCT FROM v_status THEN
    INSERT INTO public.audit_logs (
      entity_type,
      entity_id,
      field_name,
      old_value,
      new_value,
      changed_by,
      justification
    )
    VALUES (
      'bl',
      p_bl_id,
      'review_status',
      v_previous_status,
      v_status,
      p_changed_by,
      v_justification
    );
  END IF;

  PERFORM public.sync_customer_reconciliation_queue_for_bl(p_bl_id);

  -- ADR 0061: a conciliacao de cliente tem casa unica na Revisao, e por isso a
  -- Revisao precisa produzir aqui o efeito completo que a Validacao produzia —
  -- vincular o cliente E capturar o e-mail do manifesto como contato
  -- financeiro. Sem isto, remover os botoes da Validacao seria regressao.
  --
  -- Roda depois do sync porque e ele quem fecha a fila (`status = 'approved'`)
  -- para o B/L recem-vinculado; a fila e tambem quem guarda o e-mail do
  -- manifesto que a Validacao usava. `approved_by` fica com o revisor: quem
  -- resolveu foi quem salvou a revisao, e o sync nao conhece o ator (roda
  -- tambem na importacao, sem revisor humano).
  IF p_update_payload ? 'customer_id' AND v_next_customer_id IS NOT NULL THEN
    UPDATE public.customer_reconciliation_queue AS q
    SET approved_by = COALESCE(q.approved_by, p_changed_by)
    WHERE q.bl_id = p_bl_id
      AND q.status = 'approved'
    RETURNING q.manifest_customer_email INTO v_manifest_email;

    PERFORM public.capture_manifest_financial_contact(v_next_customer_id, v_manifest_email);
  END IF;

  RETURN jsonb_build_object(
    'updated_at', v_new_updated_at,
    'review_status', v_status,
    'pendencias', to_jsonb(v_reasons)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_bl_review(TEXT, TIMESTAMPTZ, JSONB, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_bl_review(TEXT, TIMESTAMPTZ, JSONB, JSONB, UUID) TO authenticated;
