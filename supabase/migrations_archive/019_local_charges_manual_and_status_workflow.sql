-- Etapa A - complemento operacional
-- 1) Other Charges manuais no detalhe de B/L
-- 2) Transicoes de status financeiro local (reviewed / ready_for_billing)

-- ---------------------------------------------------------------------------
-- RPC: lista itens manuais elegiveis para um B/L com valor efetivo (override)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_manual_charge_items_for_bl(p_bl_id TEXT)
RETURNS TABLE (
  charge_item_id BIGINT,
  charge_item_name TEXT,
  charge_table_id BIGINT,
  charge_table_name TEXT,
  cargo_mode TEXT,
  pod TEXT,
  currency TEXT,
  default_unit_value_brl NUMERIC,
  default_unit_value_usd NUMERIC,
  effective_unit_value_brl NUMERIC,
  effective_unit_value_usd NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH bl_ctx AS (
    SELECT
      b.id,
      COALESCE(b.cargo_mode, 'container') AS cargo_mode,
      b.customer_id,
      b.pod,
      COALESCE(ib.uploaded_at::DATE, b.created_at::DATE, CURRENT_DATE) AS reference_date
    FROM public.bls AS b
    LEFT JOIN public.import_batches AS ib ON ib.id = b.batch_id
    WHERE b.id = p_bl_id
  )
  SELECT
    cti.id AS charge_item_id,
    cti.name AS charge_item_name,
    ct.id AS charge_table_id,
    ct.name AS charge_table_name,
    ct.cargo_mode,
    ct.pod,
    COALESCE(cti.currency, 'BRL') AS currency,
    cti.unit_value_brl AS default_unit_value_brl,
    cti.unit_value_usd AS default_unit_value_usd,
    CASE
      WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN NULL
      ELSE COALESCE(cro.override_value, cti.unit_value_brl, cti.value_brl, 0)
    END AS effective_unit_value_brl,
    CASE
      WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN COALESCE(cro.override_value, cti.unit_value_usd, 0)
      ELSE NULL
    END AS effective_unit_value_usd
  FROM bl_ctx
  JOIN public.charge_tables AS ct
    ON ct.active = true
   AND ct.cargo_mode = bl_ctx.cargo_mode
   AND (
     public.normalize_port_code(ct.pod) = public.normalize_port_code(bl_ctx.pod)
     OR UPPER(TRIM(COALESCE(ct.pod, ''))) = 'ANY'
   )
   AND ct.valid_from <= bl_ctx.reference_date
   AND (ct.valid_to IS NULL OR ct.valid_to >= bl_ctx.reference_date)
  JOIN public.charge_table_items AS cti
    ON cti.charge_table_id = ct.id
   AND COALESCE(cti.active, true) = true
   AND COALESCE(cti.manual_only, false) = true
  LEFT JOIN LATERAL (
    SELECT cro.override_value
    FROM public.customer_rate_overrides AS cro
    WHERE cro.customer_id = bl_ctx.customer_id
      AND cro.charge_item_id = cti.id
      AND (cro.valid_from IS NULL OR cro.valid_from <= bl_ctx.reference_date)
      AND (cro.valid_to IS NULL OR cro.valid_to >= bl_ctx.reference_date)
    ORDER BY cro.created_at DESC
    LIMIT 1
  ) AS cro ON TRUE
  ORDER BY ct.valid_from DESC, ct.id DESC, COALESCE(cti.sort_order, 100), cti.id;
$$;

REVOKE ALL ON FUNCTION public.list_manual_charge_items_for_bl(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_manual_charge_items_for_bl(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: adiciona linha manual (Other Charge) em B/L
-- ---------------------------------------------------------------------------

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
    COALESCE(ib.uploaded_at::DATE, b.created_at::DATE, CURRENT_DATE) AS reference_date
  INTO v_bl
  FROM public.bls AS b
  LEFT JOIN public.import_batches AS ib ON ib.id = b.batch_id
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
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

REVOKE ALL ON FUNCTION public.add_manual_bl_charge(TEXT, BIGINT, NUMERIC, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_manual_bl_charge(TEXT, BIGINT, NUMERIC, TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: atualiza linha manual existente
-- ---------------------------------------------------------------------------

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
    cc.notes
  INTO v_row
  FROM public.charge_calculations AS cc
  WHERE cc.id = p_charge_calculation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha de calculo % nao encontrada', p_charge_calculation_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_row.source, '') <> 'manual' THEN
    RAISE EXCEPTION 'Somente linhas manuais podem ser editadas' USING ERRCODE = '22023';
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

REVOKE ALL ON FUNCTION public.update_manual_bl_charge(BIGINT, NUMERIC, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_manual_bl_charge(BIGINT, NUMERIC, TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: exclui linha manual existente
-- ---------------------------------------------------------------------------

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
    cc.total_value_usd
  INTO v_row
  FROM public.charge_calculations AS cc
  WHERE cc.id = p_charge_calculation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha de calculo % nao encontrada', p_charge_calculation_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_row.source, '') <> 'manual' THEN
    RAISE EXCEPTION 'Somente linhas manuais podem ser removidas' USING ERRCODE = '22023';
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

REVOKE ALL ON FUNCTION public.delete_manual_bl_charge(BIGINT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_manual_bl_charge(BIGINT, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: transicao para reviewed
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_bl_charges_reviewed(
  p_bl_id TEXT,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bl RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  SELECT id, charge_status
  INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.charge_status = 'ready_for_billing' THEN
    RETURN jsonb_build_object('bl_id', p_bl_id, 'status', v_bl.charge_status, 'changed', false);
  END IF;

  UPDATE public.charge_calculations
  SET status = 'reviewed'
  WHERE bl_id = p_bl_id
    AND status IN ('calculated', 'review_required');

  UPDATE public.bls
  SET
    charge_status = 'reviewed',
    charges_reviewed_at = NOW()
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
    'reviewed',
    auth.uid(),
    NOW(),
    'Marcado como revisado no modulo de Taxas Locais'
  );

  RETURN jsonb_build_object('bl_id', p_bl_id, 'status', 'reviewed', 'changed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_bl_charges_reviewed(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_bl_charges_reviewed(TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: transicao para ready_for_billing
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_bl_ready_for_billing(
  p_bl_id TEXT,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bl RECORD;
  v_pending_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  SELECT id, charge_status
  INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*)
  INTO v_pending_count
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id
    AND status = 'review_required';

  IF v_pending_count > 0 THEN
    RAISE EXCEPTION 'Ainda existem linhas com pendencia de revisao' USING ERRCODE = '22023';
  END IF;

  UPDATE public.charge_calculations
  SET status = 'ready_for_billing'
  WHERE bl_id = p_bl_id
    AND status IN ('calculated', 'reviewed');

  UPDATE public.bls
  SET charge_status = 'ready_for_billing'
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
$$;

REVOKE ALL ON FUNCTION public.mark_bl_ready_for_billing(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_bl_ready_for_billing(TEXT, UUID) TO authenticated;

