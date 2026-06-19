-- Harden the canonical review gate introduced by PRs 249-251.
--
-- This migration intentionally has no top-level data backfill. Historical B/Ls
-- that are already invoiced remain untouched. The corrected gate applies when
-- new imports are persisted, a review is saved, or a B/L advances to billing.

-- ============================================================================
-- 1. Canonical gate helpers
-- ============================================================================

CREATE OR REPLACE FUNCTION public.compute_bl_review_pendencies(
  p_customer_id BIGINT,
  p_cargo_mode TEXT,
  p_bb_weight_ton NUMERIC
)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_reasons TEXT[] := ARRAY[]::TEXT[];
  v_has_email BOOLEAN := false;
  v_portal_ready BOOLEAN := false;
BEGIN
  IF p_customer_id IS NULL THEN
    v_reasons := array_append(v_reasons, 'Cliente nao vinculado');
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.customer_contacts c
      WHERE c.customer_id = p_customer_id
        AND NULLIF(btrim(c.email), '') IS NOT NULL
    )
    INTO v_has_email;

    IF NOT v_has_email THEN
      v_reasons := array_append(v_reasons, 'Cliente sem e-mail cadastrado');
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.customer_portal_accounts a
      WHERE a.customer_id = p_customer_id
        AND a.active = true
        AND a.auth_user_id IS NOT NULL
    )
    INTO v_portal_ready;

    IF NOT v_portal_ready THEN
      v_reasons := array_append(v_reasons, 'Acesso ao portal nao provisionado');
    END IF;
  END IF;

  IF p_cargo_mode = 'carga_solta'
     AND (p_bb_weight_ton IS NULL OR p_bb_weight_ton <= 0) THEN
    v_reasons := array_append(v_reasons, 'Peso BB ausente');
  END IF;

  RETURN v_reasons;
END;
$function$;

REVOKE ALL ON FUNCTION public.compute_bl_review_pendencies(BIGINT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.compute_bl_review_pendencies(p_bl_id TEXT)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bl RECORD;
BEGIN
  SELECT customer_id, cargo_mode, bb_weight_ton
  INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id;

  IF NOT FOUND THEN
    RETURN ARRAY[]::TEXT[];
  END IF;

  RETURN public.compute_bl_review_pendencies(
    v_bl.customer_id,
    v_bl.cargo_mode,
    v_bl.bb_weight_ton
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.compute_bl_review_pendencies(TEXT) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 2. Review save restores reconciliation and owns the real status transition
-- ============================================================================

DROP FUNCTION IF EXISTS public.save_bl_review(TEXT, TIMESTAMPTZ, JSONB, JSONB, UUID);

CREATE FUNCTION public.save_bl_review(
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

  RETURN jsonb_build_object(
    'updated_at', v_new_updated_at,
    'review_status', v_status,
    'pendencias', to_jsonb(v_reasons)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_bl_review(TEXT, TIMESTAMPTZ, JSONB, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_bl_review(TEXT, TIMESTAMPTZ, JSONB, JSONB, UUID) TO authenticated;

-- ============================================================================
-- 3. Apply the canonical gate only to the B/Ls participating in a new import
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_bl_review_gate_after_import(
  p_bl_ids TEXT[],
  p_changed_by UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bl RECORD;
  v_reason TEXT;
  v_reasons TEXT[];
  v_notes TEXT;
  v_changed INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para aplicar gate de importacao.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(cardinality(p_bl_ids), 0) = 0 THEN
    RETURN 0;
  END IF;

  FOR v_bl IN
    SELECT b.id, b.review_status, b.notes, b.financial_status
    FROM public.bls b
    WHERE b.id = ANY(p_bl_ids)
    ORDER BY b.id
  LOOP
    IF v_bl.financial_status = 'invoiced'
       OR EXISTS (
         SELECT 1
         FROM public.invoice_bls ib
         JOIN public.invoices i ON i.id = ib.invoice_id
         WHERE ib.bl_id = v_bl.id
           AND i.status NOT IN ('cancelled', 'obsolete')
       ) THEN
      CONTINUE;
    END IF;

    v_reasons := public.compute_bl_review_pendencies(v_bl.id);
    IF COALESCE(cardinality(v_reasons), 0) = 0 THEN
      CONTINUE;
    END IF;

    v_notes := v_bl.notes;
    FOREACH v_reason IN ARRAY v_reasons
    LOOP
      IF COALESCE(v_notes, '') NOT ILIKE '%' || v_reason || '%' THEN
        IF COALESCE(v_notes, '') ILIKE '%Pendencias de importacao:%' THEN
          v_notes := v_notes || ', ' || v_reason;
        ELSE
          v_notes := concat_ws(
            E'\n',
            NULLIF(btrim(COALESCE(v_notes, '')), ''),
            'Pendencias de importacao: ' || v_reason
          );
        END IF;
      END IF;
    END LOOP;

    UPDATE public.bls
    SET
      review_status = 'pending_review',
      notes = v_notes
    WHERE id = v_bl.id;

    IF v_bl.review_status IS DISTINCT FROM 'pending_review' THEN
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
        v_bl.id,
        'review_status',
        v_bl.review_status,
        'pending_review',
        p_changed_by,
        'Gate canonico aplicado apos importacao'
      );
    END IF;

    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl.id);
    v_changed := v_changed + 1;
  END LOOP;

  RETURN v_changed;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_bl_review_gate_after_import(TEXT[], UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_bl_review_gate_after_import(TEXT[], UUID) TO authenticated;

-- ============================================================================
-- 4. Manifest import: contacts first, canonical gate second, billing last
-- ============================================================================

CREATE OR REPLACE FUNCTION public.import_manifest_with_postprocess_transactional(
  p_filename TEXT,
  p_voyage_id BIGINT,
  p_uploaded_by UUID,
  p_cargo_mode TEXT,
  p_file_hash TEXT,
  p_total_bls INTEGER,
  p_total_containers INTEGER,
  p_bls JSONB,
  p_containers JSONB,
  p_errors JSONB,
  p_pol_etd JSONB DEFAULT '[]'::jsonb,
  p_pod_linked JSONB DEFAULT '[]'::jsonb,
  p_contact_emails JSONB DEFAULT '[]'::jsonb
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_batch_id BIGINT;
  v_bl_ids TEXT[];
BEGIN
  v_batch_id := public.import_manifest_transactional(
    p_filename,
    p_voyage_id,
    p_uploaded_by,
    p_cargo_mode,
    p_file_hash,
    p_total_bls,
    p_total_containers,
    p_bls,
    p_containers,
    p_errors
  );

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
    'voyage_pol_schedule',
    row.entity_id,
    'etd',
    latest.new_value,
    row.etd,
    p_uploaded_by,
    'ETD importado do manifesto por POL'
  FROM jsonb_to_recordset(p_pol_etd) AS row(entity_id TEXT, etd TEXT)
  LEFT JOIN LATERAL (
    SELECT al.new_value
    FROM public.audit_logs al
    WHERE al.entity_type = 'voyage_pol_schedule'
      AND al.entity_id = row.entity_id
      AND al.field_name = 'etd'
    ORDER BY al.changed_at DESC, al.id DESC
    LIMIT 1
  ) latest ON true
  WHERE NULLIF(row.etd, '') IS NOT NULL
    AND COALESCE(latest.new_value, '') IS DISTINCT FROM row.etd;

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
    'voyage_pod_schedule',
    row.entity_id,
    'linked',
    latest.new_value,
    'true',
    p_uploaded_by,
    'POD reconciliado automaticamente ao importar manifesto'
  FROM jsonb_to_recordset(p_pod_linked) AS row(entity_id TEXT)
  JOIN LATERAL (
    SELECT al.new_value
    FROM public.audit_logs al
    WHERE al.entity_type = 'voyage_pod_schedule'
      AND al.entity_id = row.entity_id
    ORDER BY al.changed_at DESC, al.id DESC
    LIMIT 1
  ) latest ON true
  WHERE latest.new_value IS DISTINCT FROM 'true';

  INSERT INTO public.customer_contacts (
    customer_id,
    name,
    email,
    purpose,
    is_primary
  )
  SELECT DISTINCT
    row.customer_id,
    'Contato manifesto',
    lower(trim(row.email)),
    'financeiro',
    false
  FROM jsonb_to_recordset(p_contact_emails) AS row(customer_id BIGINT, email TEXT)
  WHERE row.customer_id IS NOT NULL
    AND NULLIF(trim(row.email), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.customer_contacts cc
      WHERE cc.customer_id = row.customer_id
        AND lower(trim(cc.email)) = lower(trim(row.email))
    );

  SELECT COALESCE(array_agg(row.id), ARRAY[]::TEXT[])
  INTO v_bl_ids
  FROM jsonb_to_recordset(p_bls) AS row(id TEXT);

  PERFORM public.apply_bl_review_gate_after_import(v_bl_ids, p_uploaded_by);
  PERFORM public.run_billing_for_import_batch(v_batch_id, p_uploaded_by, true);

  RETURN v_batch_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_manifest_with_postprocess_transactional(
  TEXT, BIGINT, UUID, TEXT, TEXT, INTEGER, INTEGER, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_manifest_with_postprocess_transactional(
  TEXT, BIGINT, UUID, TEXT, TEXT, INTEGER, INTEGER, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB
) TO authenticated;

-- ============================================================================
-- 5. Billing boundaries cannot bypass the canonical review gate
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mark_bl_ready_for_billing(
  p_bl_id TEXT,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bl RECORD;
  v_pending_count INTEGER := 0;
  v_usd_count INTEGER := 0;
  v_table_count INTEGER := 0;
  v_invoiceable_count INTEGER := 0;
  v_review_reasons TEXT[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  SELECT
    id,
    charge_status,
    pod,
    cargo_mode,
    customer_id,
    customer_reconciliation_status
  INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.customer_id IS NULL THEN
    UPDATE public.bls
    SET billing_hold_reason = 'Cliente nao reconciliado para faturamento.'
    WHERE id = p_bl_id;

    RAISE EXCEPTION
      'B/L % nao possui cliente vinculado. Vincule um cliente antes de marcar como pronto para faturar.',
      p_bl_id
      USING ERRCODE = 'P0003';
  END IF;

  IF COALESCE(v_bl.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled') THEN
    UPDATE public.bls
    SET billing_hold_reason = 'Cliente exige reconciliacao manual antes do faturamento.'
    WHERE id = p_bl_id;

    RAISE EXCEPTION 'B/L exige reconciliacao manual antes do faturamento.' USING ERRCODE = '22023';
  END IF;

  v_review_reasons := public.compute_bl_review_pendencies(p_bl_id);
  IF COALESCE(cardinality(v_review_reasons), 0) > 0 THEN
    UPDATE public.bls
    SET billing_hold_reason =
      'B/L possui pendencias no gate de revisao: ' || array_to_string(v_review_reasons, ', ')
    WHERE id = p_bl_id;

    RAISE EXCEPTION
      'B/L possui pendencias no gate de revisao: %',
      array_to_string(v_review_reasons, ', ')
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO v_pending_count
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id
    AND status = 'review_required';

  IF v_pending_count > 0 THEN
    UPDATE public.bls
    SET billing_hold_reason = 'Ainda existem linhas com pendencia de revisao.'
    WHERE id = p_bl_id;

    RAISE EXCEPTION 'Ainda existem linhas com pendencia de revisao' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO v_usd_count
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id
    AND COALESCE(total_value_usd, 0) > 0
    AND COALESCE(status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_usd_count > 0 THEN
    UPDATE public.bls
    SET billing_hold_reason = 'Linhas em USD exigem ajuste manual antes do faturamento.'
    WHERE id = p_bl_id;

    RAISE EXCEPTION 'Existem linhas em USD que bloqueiam o ready_for_billing.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO v_invoiceable_count
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id
    AND COALESCE(total_value_brl, 0) > 0
    AND COALESCE(status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_invoiceable_count = 0 THEN
    UPDATE public.bls
    SET billing_hold_reason = 'B/L sem linhas BRL faturaveis. Recalcule as taxas antes de faturar.'
    WHERE id = p_bl_id;

    RAISE EXCEPTION 'B/L sem linhas BRL faturaveis.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO v_table_count
  FROM public.charge_tables
  WHERE public.normalize_port_code(pod) = public.normalize_port_code(v_bl.pod)
    AND cargo_mode = v_bl.cargo_mode
    AND active = true
    AND valid_from <= CURRENT_DATE
    AND (valid_to IS NULL OR valid_to >= CURRENT_DATE);

  IF v_table_count = 0 THEN
    RAISE EXCEPTION
      'Nenhuma tabela de cobranca vigente para POD "%" (modo: %). Configure em /taxas-locais antes de prosseguir.',
      v_bl.pod, v_bl.cargo_mode
      USING ERRCODE = 'P0004';
  END IF;

  UPDATE public.charge_calculations
  SET status = 'ready_for_billing'
  WHERE bl_id = p_bl_id
    AND status IN ('calculated', 'reviewed');

  UPDATE public.bls
  SET
    charge_status = 'ready_for_billing',
    billing_hold_reason = NULL
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
    'bl',
    p_bl_id,
    'charge_status',
    COALESCE(v_bl.charge_status, 'null'),
    'ready_for_billing',
    auth.uid(),
    NOW(),
    'Marcado como pronto para faturar no modulo de Taxas Locais'
  );

  RETURN jsonb_build_object('bl_id', p_bl_id, 'status', 'ready_for_billing', 'changed', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_bl_ready_for_billing(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_bl_ready_for_billing(TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.promote_calculated_bl_ready_for_billing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_pending_count INTEGER := 0;
  v_usd_count INTEGER := 0;
  v_invoiceable_count INTEGER := 0;
BEGIN
  IF COALESCE(NEW.charge_status, 'not_calculated') <> 'calculated' THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS NULL
     OR COALESCE(NEW.customer_reconciliation_status, 'missing_customer')
        NOT IN ('matched_document', 'reconciled') THEN
    RETURN NEW;
  END IF;

  IF COALESCE(cardinality(public.compute_bl_review_pendencies(
    NEW.customer_id,
    NEW.cargo_mode,
    NEW.bb_weight_ton
  )), 0) > 0 THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
  INTO v_pending_count
  FROM public.charge_calculations
  WHERE bl_id = NEW.id
    AND status = 'review_required';

  IF v_pending_count > 0 THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
  INTO v_invoiceable_count
  FROM public.charge_calculations
  WHERE bl_id = NEW.id
    AND COALESCE(total_value_brl, 0) > 0
    AND status IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_invoiceable_count = 0 THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
  INTO v_usd_count
  FROM public.charge_calculations
  WHERE bl_id = NEW.id
    AND COALESCE(total_value_usd, 0) > 0
    AND COALESCE(status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_usd_count > 0 THEN
    RETURN NEW;
  END IF;

  UPDATE public.charge_calculations
  SET status = 'ready_for_billing'
  WHERE bl_id = NEW.id
    AND status IN ('calculated', 'reviewed');

  NEW.charge_status := 'ready_for_billing';
  NEW.billing_hold_reason := NULL;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.promote_calculated_bl_ready_for_billing() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_promote_calculated_bl_ready ON public.bls;
CREATE TRIGGER trg_promote_calculated_bl_ready
BEFORE INSERT OR UPDATE OF charge_status, customer_id, customer_reconciliation_status
ON public.bls
FOR EACH ROW
EXECUTE FUNCTION public.promote_calculated_bl_ready_for_billing();

CREATE OR REPLACE FUNCTION public.prevent_pending_review_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_review_reasons TEXT[];
BEGIN
  IF NEW.financial_status = 'invoiced' THEN
    v_review_reasons := public.compute_bl_review_pendencies(
      NEW.customer_id,
      NEW.cargo_mode,
      NEW.bb_weight_ton
    );

    IF NEW.review_status = 'pending_review'
       OR COALESCE(cardinality(v_review_reasons), 0) > 0 THEN
      RAISE EXCEPTION
        'B/L em revisao manual nao pode ser faturado: %',
        COALESCE(array_to_string(v_review_reasons, ', '), 'revisao pendente')
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.prevent_pending_review_invoice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_pending_review_invoice ON public.bls;
CREATE TRIGGER prevent_pending_review_invoice
BEFORE INSERT OR UPDATE OF financial_status ON public.bls
FOR EACH ROW
EXECUTE FUNCTION public.prevent_pending_review_invoice();

-- Rollback:
--   Reapply the function definitions from:
--   - 20260618163840_guard_invoiceable_ready_state.sql
--   - 20260618145508_preserve_customer_billing_block_reason.sql
--   - 20260619120000_review_gate_canonical_pendencies.sql
--   No data rollback is required because this migration performs no top-level
--   update or backfill.
