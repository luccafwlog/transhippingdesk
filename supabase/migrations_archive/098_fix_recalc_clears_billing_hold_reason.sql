-- Renumbered from 20260612144751 (original timestamped migration: 20260612144751_fix_recalc_clears_billing_hold_reason.sql).
-- QA E2E Fase 3 / achado R3: o recalculo per-B/L (calculate_bl_local_charges)
-- gravava as linhas de taxa mas NAO atualizava bls.billing_hold_reason, deixando
-- um bloqueio obsoleto ("Nenhuma tabela de preco encontrada") mesmo apos um
-- calculo bem-sucedido. Esta migracao recria a funcao atualizando o hold_reason
-- conforme o desfecho do calculo (limpa quando calcula OK / isento).
-- Rollback: reaplicar a definicao anterior (migration 016) sem as linhas
-- billing_hold_reason adicionadas nos dois UPDATE public.bls.

CREATE OR REPLACE FUNCTION public.calculate_bl_local_charges(
  p_bl_id TEXT,
  p_actor UUID DEFAULT NULL,
  p_recalculate BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bl RECORD;
  v_table_id BIGINT;
  v_ref_date DATE;
  v_actor UUID;
  v_has_vehicles BOOLEAN := false;
  v_is_exempt BOOLEAN := false;
  v_auto_review BOOLEAN := false;
  v_line_count INTEGER := 0;
  v_total_brl NUMERIC(14,2) := 0;
  v_total_usd NUMERIC(14,2) := 0;
  v_status TEXT := 'calculated';
  v_reason TEXT := NULL;
  v_qty_total NUMERIC(12,6) := 0;
  v_qty_std NUMERIC(12,6) := 0;
  v_qty_imo NUMERIC(12,6) := 0;
  v_qty_oog NUMERIC(12,6) := 0;
  v_qty_dual NUMERIC(12,6) := 0;
  v_weight_ton NUMERIC(12,3) := 0;
  item RECORD;
  v_qty NUMERIC(12,6);
  v_unit_brl NUMERIC(12,2);
  v_unit_usd NUMERIC(12,2);
  v_total_line_brl NUMERIC(14,2);
  v_total_line_usd NUMERIC(14,2);
  v_is_thd BOOLEAN;
  v_override BOOLEAN;
  v_calculation_key TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT
    b.id,
    b.voyage_id,
    b.batch_id,
    COALESCE(b.cargo_mode, 'container') AS cargo_mode,
    b.customer_id,
    b.pod,
    NULLIF((to_jsonb(b)->>'bb_weight_ton'), '')::NUMERIC AS bb_weight_ton,
    b.total_weight_kg,
    b.container_load_type,
    b.created_at,
    ib.uploaded_at
  INTO v_bl
  FROM public.bls AS b
  LEFT JOIN public.import_batches AS ib ON ib.id = b.batch_id
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());
  v_ref_date := COALESCE((v_bl.uploaded_at)::DATE, (v_bl.created_at)::DATE, CURRENT_DATE);

  IF p_recalculate THEN
    DELETE FROM public.charge_calculations
    WHERE bl_id = p_bl_id
      AND COALESCE(source, 'auto') = 'auto';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.vehicles WHERE bl_id = p_bl_id)
  INTO v_has_vehicles;

  IF v_bl.cargo_mode = 'container' AND v_has_vehicles THEN
    UPDATE public.bls
    SET container_load_type = 'LCL'
    WHERE id = p_bl_id;
    v_bl.container_load_type := 'LCL';
  END IF;

  IF v_bl.cargo_mode = 'container' AND v_has_vehicles AND COALESCE(v_bl.container_load_type, 'FCL') = 'LCL' THEN
    v_is_exempt := true;
    v_reason := 'Carga de veiculos / LCL com taxas pagas na origem';

    INSERT INTO public.charge_calculations (
      bl_id, source, status, calculation_key, quantity,
      unit_value_brl, total_value_brl, notes, review_reason, created_by, calculated_at
    )
    VALUES (
      p_bl_id, 'auto', 'exempt', 'exempt:lcl_vehicle', 1,
      0, 0, 'Linha sintetica de isencao', v_reason, v_actor, NOW()
    )
    ON CONFLICT (bl_id, calculation_key) DO UPDATE
      SET status = EXCLUDED.status,
          quantity = EXCLUDED.quantity,
          unit_value_brl = EXCLUDED.unit_value_brl,
          total_value_brl = EXCLUDED.total_value_brl,
          notes = EXCLUDED.notes,
          review_reason = EXCLUDED.review_reason,
          created_by = EXCLUDED.created_by,
          calculated_at = NOW();

    UPDATE public.bls
    SET
      charge_status = 'exempt',
      charges_calculated_at = NOW(),
      charge_exemption_reason = v_reason,
      billing_hold_reason = NULL
    WHERE id = p_bl_id;

    RETURN jsonb_build_object(
      'bl_id', p_bl_id,
      'status', 'exempt',
      'table_id', NULL,
      'line_count', 1,
      'total_brl', 0,
      'total_usd', 0,
      'review_required', false,
      'exempt', true,
      'reason', v_reason
    );
  END IF;

  v_table_id := public.resolve_local_charge_table_id(v_bl.cargo_mode, v_bl.pod, v_ref_date);

  IF v_table_id IS NULL THEN
    v_reason := 'Nao existe tabela ativa para POD/mode na data de referencia';
    v_auto_review := true;

    INSERT INTO public.charge_calculations (
      bl_id, source, status, calculation_key, quantity, total_value_brl,
      review_reason, notes, created_by, calculated_at
    )
    VALUES (
      p_bl_id, 'auto', 'review_required', 'review:no_table', 1, 0,
      v_reason, 'Revisao manual obrigatoria', v_actor, NOW()
    )
    ON CONFLICT (bl_id, calculation_key) DO UPDATE
      SET status = EXCLUDED.status,
          quantity = EXCLUDED.quantity,
          total_value_brl = EXCLUDED.total_value_brl,
          review_reason = EXCLUDED.review_reason,
          notes = EXCLUDED.notes,
          created_by = EXCLUDED.created_by,
          calculated_at = NOW();
  END IF;

  IF v_bl.cargo_mode = 'container' THEN
    WITH current_containers AS (
      SELECT
        UPPER(TRIM(bc.container_number)) AS cn,
        BOOL_OR(COALESCE(bc.is_imo, false)) AS has_imo,
        BOOL_OR(COALESCE(bc.is_oog, false)) AS has_oog
      FROM public.bl_containers AS bc
      WHERE bc.bl_id = p_bl_id
        AND TRIM(COALESCE(bc.container_number, '')) <> ''
      GROUP BY UPPER(TRIM(bc.container_number))
    ),
    shares AS (
      SELECT
        cc.cn,
        cc.has_imo,
        cc.has_oog,
        (
          SELECT COUNT(DISTINCT b2.id)::NUMERIC
          FROM public.bls AS b2
          JOIN public.bl_containers AS bc2 ON bc2.bl_id = b2.id
          WHERE b2.voyage_id = v_bl.voyage_id
            AND COALESCE(b2.cargo_mode, 'container') = 'container'
            AND UPPER(TRIM(COALESCE(bc2.container_number, ''))) = cc.cn
        ) AS share_count
      FROM current_containers AS cc
    )
    SELECT
      COALESCE(SUM(CASE WHEN share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN NOT has_imo AND NOT has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_imo AND NOT has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_oog AND NOT has_imo AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_imo AND has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0)
    INTO v_qty_total, v_qty_std, v_qty_imo, v_qty_oog, v_qty_dual
    FROM shares;

    IF v_qty_dual > 0 THEN
      v_auto_review := true;
      INSERT INTO public.charge_calculations (
        bl_id, charge_table_id, source, status, calculation_key, quantity,
        total_value_brl, review_reason, notes, created_by, calculated_at
      )
      VALUES (
        p_bl_id, v_table_id, 'auto', 'review_required', 'review:imo_oog_thd', v_qty_dual,
        0, 'Container com IMO e OOG ao mesmo tempo exige revisao manual de THD', 'THD nao calculado automaticamente', v_actor, NOW()
      )
      ON CONFLICT (bl_id, calculation_key) DO UPDATE
        SET
          status = EXCLUDED.status,
          quantity = EXCLUDED.quantity,
          total_value_brl = EXCLUDED.total_value_brl,
          review_reason = EXCLUDED.review_reason,
          notes = EXCLUDED.notes,
          created_by = EXCLUDED.created_by,
          calculated_at = NOW();
    END IF;
  END IF;

  IF v_table_id IS NOT NULL THEN
    FOR item IN
      SELECT
        cti.id,
        cti.name,
        cti.category,
        cti.application_basis,
        COALESCE(cti.cargo_profile, 'any') AS cargo_profile,
        COALESCE(cti.currency, 'BRL') AS currency,
        cti.unit_value_brl,
        cti.unit_value_usd,
        ov.override_value
      FROM public.charge_table_items AS cti
      LEFT JOIN LATERAL (
        SELECT cro.override_value
        FROM public.customer_rate_overrides AS cro
        WHERE cro.customer_id = v_bl.customer_id
          AND cro.charge_item_id = cti.id
          AND (cro.valid_from IS NULL OR cro.valid_from <= v_ref_date)
          AND (cro.valid_to IS NULL OR cro.valid_to >= v_ref_date)
        ORDER BY cro.created_at DESC
        LIMIT 1
      ) AS ov ON TRUE
      WHERE cti.charge_table_id = v_table_id
        AND COALESCE(cti.active, true)
        AND NOT COALESCE(cti.manual_only, false)
      ORDER BY COALESCE(cti.sort_order, 100), cti.id
    LOOP
      v_qty := 0;
      v_is_thd := UPPER(COALESCE(item.name, '')) LIKE 'THD%';

      IF item.application_basis = 'bl' THEN
        v_qty := 1;
      ELSIF item.application_basis = 'weight_ton' THEN
        v_weight_ton := COALESCE(v_bl.bb_weight_ton, CASE WHEN v_bl.total_weight_kg IS NULL THEN NULL ELSE v_bl.total_weight_kg / 1000 END, 0);
        IF v_weight_ton <= 0 THEN
          v_auto_review := true;
          INSERT INTO public.charge_calculations (
            bl_id, charge_table_id, charge_item_id, source, status, calculation_key, quantity,
            total_value_brl, review_reason, notes, created_by, calculated_at
          )
          VALUES (
            p_bl_id, v_table_id, item.id, 'auto', 'review_required',
            CONCAT('review:weight_missing:', item.id), 0,
            0, 'Weight ton ausente/invalido para calculo', 'Revisao manual obrigatoria', v_actor, NOW()
          )
          ON CONFLICT (bl_id, calculation_key) DO UPDATE
            SET
              status = EXCLUDED.status,
              quantity = EXCLUDED.quantity,
              total_value_brl = EXCLUDED.total_value_brl,
              review_reason = EXCLUDED.review_reason,
              notes = EXCLUDED.notes,
              created_by = EXCLUDED.created_by,
              calculated_at = NOW();
          CONTINUE;
        END IF;
        v_qty := v_weight_ton;
      ELSIF item.application_basis = 'container_distinct_voyage' THEN
        IF v_bl.cargo_mode = 'container' THEN
          IF v_is_thd THEN
            IF item.cargo_profile = 'standard' THEN
              v_qty := v_qty_std;
            ELSIF item.cargo_profile = 'imo' THEN
              v_qty := v_qty_imo;
            ELSIF item.cargo_profile = 'oog' THEN
              v_qty := v_qty_oog;
            ELSE
              v_qty := 0;
            END IF;
          ELSE
            v_qty := v_qty_total;
          END IF;
        ELSE
          v_qty := 0;
        END IF;
      END IF;

      IF COALESCE(v_qty, 0) <= 0 THEN
        CONTINUE;
      END IF;

      v_override := item.override_value IS NOT NULL;
      v_unit_brl := COALESCE(item.override_value, item.unit_value_brl, 0);
      v_unit_usd := item.unit_value_usd;
      v_total_line_brl := CASE WHEN item.currency = 'USD' THEN NULL ELSE ROUND(v_qty * COALESCE(v_unit_brl, 0), 2) END;
      v_total_line_usd := CASE WHEN item.currency = 'USD' THEN ROUND(v_qty * COALESCE(v_unit_usd, 0), 2) ELSE NULL END;
      v_calculation_key := CONCAT('auto:item:', item.id);

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
        created_by,
        calculated_at
      )
      VALUES (
        p_bl_id,
        v_table_id,
        item.id,
        v_qty,
        CASE WHEN item.currency = 'USD' THEN NULL ELSE v_unit_brl END,
        CASE WHEN item.currency = 'USD' THEN v_unit_usd ELSE NULL END,
        v_total_line_brl,
        v_total_line_usd,
        v_override,
        'auto',
        'calculated',
        v_calculation_key,
        v_actor,
        NOW()
      )
      ON CONFLICT (bl_id, calculation_key) DO UPDATE
      SET
        charge_table_id = EXCLUDED.charge_table_id,
        charge_item_id = EXCLUDED.charge_item_id,
        quantity = EXCLUDED.quantity,
        unit_value_brl = EXCLUDED.unit_value_brl,
        unit_value_usd = EXCLUDED.unit_value_usd,
        total_value_brl = EXCLUDED.total_value_brl,
        total_value_usd = EXCLUDED.total_value_usd,
        override_applied = EXCLUDED.override_applied,
        source = EXCLUDED.source,
        status = EXCLUDED.status,
        created_by = EXCLUDED.created_by,
        calculated_at = NOW();
    END LOOP;
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(COALESCE(total_value_brl, 0)), 0),
    COALESCE(SUM(COALESCE(total_value_usd, 0)), 0)
  INTO v_line_count, v_total_brl, v_total_usd
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id;

  IF v_is_exempt THEN
    v_status := 'exempt';
  ELSIF v_auto_review THEN
    v_status := 'review_required';
  ELSIF v_line_count > 0 THEN
    v_status := 'calculated';
  ELSE
    v_status := 'not_calculated';
  END IF;

  UPDATE public.bls
  SET
    charge_status = v_status,
    charges_calculated_at = NOW(),
    charge_exemption_reason = CASE WHEN v_status = 'exempt' THEN v_reason ELSE NULL END,
    billing_hold_reason = CASE
      WHEN COALESCE(v_total_usd, 0) > 0 THEN 'Linhas em USD exigem ajuste manual antes do faturamento.'
      WHEN v_status = 'review_required' THEN COALESCE(v_reason, 'Pendencia de revisao nas taxas locais.')
      WHEN v_status = 'not_calculated' THEN 'Nenhuma tabela de preco ou tarifa encontrada. Adicione os precos e recalcule.'
      ELSE NULL
    END
  WHERE id = p_bl_id;

  RETURN jsonb_build_object(
    'bl_id', p_bl_id,
    'status', v_status,
    'table_id', v_table_id,
    'line_count', v_line_count,
    'total_brl', v_total_brl,
    'total_usd', v_total_usd,
    'review_required', v_auto_review,
    'exempt', (v_status = 'exempt'),
    'reason', COALESCE(v_reason, '')
  );
END;
$$;


REVOKE ALL ON FUNCTION public.calculate_bl_local_charges(TEXT, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_bl_local_charges(TEXT, UUID, BOOLEAN) TO authenticated;
