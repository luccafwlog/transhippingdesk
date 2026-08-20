-- 311: extrai a resolução de itens de Taxa Local para uma prévia pura.
--
-- A função auxiliar recebe o POD explicitamente porque a Task 6b precisa
-- comparar o destino anterior com o destino já gravado no B/L. Ela resolve a
-- mesma tabela, condição de cliente, quantidade, rateio e arredondamento que
-- o motor de 274, mas não conhece ator, faturamento ou persistência.
--
-- Rollback: reaplicar a definição de calculate_bl_local_charges da migration
-- 274 e remover resolve_bl_local_charge_items(TEXT, TEXT) em ambiente
-- descartável. Não há backfill nem alteração de dados nesta migration.
--
-- Mapa dos quatro ramos de INSERT da 274:
--   * bl: item/tabela resolvidos, quantidade 1, tarifa/override aplicados;
--   * weight_missing: item/tabela resolvidos, quantidade e total zero,
--     revisão obrigatória;
--   * thd_any_profile: item/tabela resolvidos, quantidade e total zero,
--     revisão obrigatória;
--   * unsupported_basis: item/tabela resolvidos, quantidade e total zero,
--     revisão obrigatória. O ramo calculado também cobre weight_ton válido e
--     container_distinct_voyage com o rateio por container.

CREATE OR REPLACE FUNCTION public.resolve_bl_local_charge_items(
  p_bl_id TEXT,
  p_pod TEXT
)
RETURNS TABLE (
  charge_table_id BIGINT,
  charge_item_id BIGINT,
  quantity NUMERIC(12,6),
  unit_value_brl NUMERIC(12,2),
  unit_value_usd NUMERIC(12,2),
  total_value_brl NUMERIC(14,2),
  total_value_usd NUMERIC(14,2),
  override_applied BOOLEAN,
  source TEXT,
  status TEXT,
  calculation_key TEXT,
  review_reason TEXT,
  notes TEXT
)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bl RECORD;
  v_table_id BIGINT;
  v_ref_date DATE;
  v_qty_total NUMERIC(12,6) := 0;
  v_qty_std NUMERIC(12,6) := 0;
  v_qty_imo NUMERIC(12,6) := 0;
  v_qty_oog NUMERIC(12,6) := 0;
  v_qty_dual NUMERIC(12,6) := 0;
  v_container_shares JSONB;
  v_weight_ton NUMERIC(12,3);
  v_qty NUMERIC(12,6);
  v_unit_brl NUMERIC(12,2);
  v_unit_usd NUMERIC(12,2);
  v_total_line_brl NUMERIC(14,2);
  v_total_line_usd NUMERIC(14,2);
  v_is_thd BOOLEAN;
  v_override BOOLEAN;
  item RECORD;
BEGIN
  SELECT
    b.id,
    b.voyage_id,
    COALESCE(b.cargo_mode, 'container') AS cargo_mode,
    b.customer_id,
    NULLIF((to_jsonb(b)->>'bb_weight_ton'), '')::NUMERIC AS bb_weight_ton,
    b.total_weight_kg
  INTO v_bl
  FROM public.bls AS b
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

-- A vigência da tabela é informativa; a data só participa do override.
  SELECT v_eta_raw.eta_text::DATE
  INTO v_ref_date
  FROM public.voyages AS v
  CROSS JOIN LATERAL (
    SELECT NULLIF(TRIM(v.pod_schedule_snapshot -> p_pod ->> 'eta'), '') AS eta_text
  ) AS v_eta_raw
  WHERE v.id = v_bl.voyage_id
    AND v_eta_raw.eta_text ~ '^\d{4}-\d{2}-\d{2}$';

  IF v_ref_date IS NULL THEN
    SELECT v.eta::DATE
    INTO v_ref_date
    FROM public.voyages AS v
    WHERE v.id = v_bl.voyage_id
      AND v.eta IS NOT NULL;
  END IF;

  v_ref_date := COALESCE(v_ref_date, CURRENT_DATE);
  v_table_id := public.resolve_local_charge_table_id(v_bl.cargo_mode, p_pod, v_ref_date);

  IF v_table_id IS NULL THEN
    RETURN;
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
        sh.share_count,
        sh.last_bl_id
      FROM current_containers AS cc
      JOIN LATERAL (
        SELECT
          COUNT(DISTINCT b2.id)::NUMERIC AS share_count,
          MAX(b2.id) AS last_bl_id
        FROM public.bls AS b2
        JOIN public.bl_containers AS bc2 ON bc2.bl_id = b2.id
        WHERE b2.voyage_id = v_bl.voyage_id
          AND COALESCE(b2.cargo_mode, 'container') = 'container'
          AND UPPER(TRIM(COALESCE(bc2.container_number, ''))) = cc.cn
      ) AS sh ON TRUE
    )
    SELECT
      COALESCE(SUM(CASE WHEN share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN NOT has_imo AND NOT has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_imo AND NOT has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_oog AND NOT has_imo AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_imo AND has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      jsonb_agg(jsonb_build_object(
        'has_imo', has_imo,
        'has_oog', has_oog,
        'share_count', share_count,
        'is_last', (p_bl_id = last_bl_id)
      )) FILTER (WHERE share_count > 0)
    INTO v_qty_total, v_qty_std, v_qty_imo, v_qty_oog, v_qty_dual, v_container_shares
    FROM shares;
  END IF;

  FOR item IN
    SELECT
      cti.id,
      cti.name,
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
      LIMIT 1
    ) AS ov ON TRUE
    WHERE cti.charge_table_id = v_table_id
      AND COALESCE(cti.active, true)
      AND NOT COALESCE(cti.manual_only, false)
    ORDER BY COALESCE(cti.sort_order, 100), cti.id
  LOOP
    charge_table_id := v_table_id;
    charge_item_id := item.id;
    quantity := 0;
    unit_value_brl := NULL;
    unit_value_usd := NULL;
    total_value_brl := 0;
    total_value_usd := NULL;
    override_applied := false;
    source := 'auto';
    status := 'review_required';
    calculation_key := NULL;
    review_reason := NULL;
    notes := 'Revisao manual obrigatoria';

    v_qty := 0;
    v_is_thd := UPPER(COALESCE(item.name, '')) LIKE 'THD%';

    IF item.application_basis = 'bl' THEN
      v_qty := 1;
    -- Ramo 1 da 274: item por tonelada sem peso utilizável.
    ELSIF item.application_basis = 'weight_ton' THEN
      v_weight_ton := COALESCE(
        v_bl.bb_weight_ton,
        CASE WHEN v_bl.total_weight_kg IS NULL THEN NULL ELSE v_bl.total_weight_kg / 1000 END,
        0
      );
      IF v_weight_ton <= 0 THEN
        calculation_key := CONCAT('review:weight_missing:', item.id);
        review_reason := 'Weight ton ausente/invalido para calculo';
        RETURN NEXT;
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
            -- Ramo 2 da 274: THD sem perfil que o motor saiba distinguir.
            calculation_key := CONCAT('review:thd_any_profile:', item.id);
            review_reason := 'Item THD cadastrado com perfil de carga ''any''; motor so calcula standard/imo/oog';
            notes := 'Revisao manual obrigatoria';
            RETURN NEXT;
            CONTINUE;
          END IF;
        ELSE
          v_qty := v_qty_total;
        END IF;
      END IF;
    ELSE
      -- Ramo 3 da 274: base de aplicação não implementada pelo motor.
      calculation_key := CONCAT('review:unsupported_basis:', item.id);
      review_reason := CONCAT('Base de aplicacao nao suportada pelo motor: ', COALESCE(item.application_basis, '(vazia)'));
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF COALESCE(v_qty, 0) <= 0 THEN
      CONTINUE;
    END IF;

    -- Ramo 4 da 274: item resolvido e pronto para o INSERT do RPC pai.
    status := 'calculated';
    notes := NULL;
    calculation_key := CONCAT('auto:item:', item.id);
    v_override := item.override_value IS NOT NULL;
    override_applied := v_override;
    v_unit_brl := COALESCE(item.override_value, item.unit_value_brl, 0);
    v_unit_usd := item.unit_value_usd;
    quantity := v_qty;
    unit_value_brl := CASE WHEN item.currency = 'USD' THEN NULL ELSE v_unit_brl END;
    unit_value_usd := CASE WHEN item.currency = 'USD' THEN v_unit_usd ELSE NULL END;

    IF item.application_basis = 'container_distinct_voyage' AND v_bl.cargo_mode = 'container' THEN
      IF item.currency = 'USD' THEN
        SELECT COALESCE(SUM(
          CASE WHEN (elem->>'is_last')::BOOLEAN
            THEN COALESCE(v_unit_usd, 0) - ((elem->>'share_count')::NUMERIC - 1) * ROUND(COALESCE(v_unit_usd, 0) / (elem->>'share_count')::NUMERIC, 2)
            ELSE ROUND(COALESCE(v_unit_usd, 0) / (elem->>'share_count')::NUMERIC, 2)
          END
        ), 0)
        INTO v_total_line_usd
        FROM jsonb_array_elements(COALESCE(v_container_shares, '[]'::jsonb)) AS elem
        WHERE
          NOT v_is_thd
          OR (item.cargo_profile = 'standard' AND NOT (elem->>'has_imo')::BOOLEAN AND NOT (elem->>'has_oog')::BOOLEAN)
          OR (item.cargo_profile = 'imo' AND (elem->>'has_imo')::BOOLEAN AND NOT (elem->>'has_oog')::BOOLEAN)
          OR (item.cargo_profile = 'oog' AND (elem->>'has_oog')::BOOLEAN AND NOT (elem->>'has_imo')::BOOLEAN);
        v_total_line_brl := NULL;
      ELSE
        SELECT COALESCE(SUM(
          CASE WHEN (elem->>'is_last')::BOOLEAN
            THEN COALESCE(v_unit_brl, 0) - ((elem->>'share_count')::NUMERIC - 1) * ROUND(COALESCE(v_unit_brl, 0) / (elem->>'share_count')::NUMERIC, 2)
            ELSE ROUND(COALESCE(v_unit_brl, 0) / (elem->>'share_count')::NUMERIC, 2)
          END
        ), 0)
        INTO v_total_line_brl
        FROM jsonb_array_elements(COALESCE(v_container_shares, '[]'::jsonb)) AS elem
        WHERE
          NOT v_is_thd
          OR (item.cargo_profile = 'standard' AND NOT (elem->>'has_imo')::BOOLEAN AND NOT (elem->>'has_oog')::BOOLEAN)
          OR (item.cargo_profile = 'imo' AND (elem->>'has_imo')::BOOLEAN AND NOT (elem->>'has_oog')::BOOLEAN)
          OR (item.cargo_profile = 'oog' AND (elem->>'has_oog')::BOOLEAN AND NOT (elem->>'has_imo')::BOOLEAN);
        v_total_line_usd := NULL;
      END IF;
    ELSE
      v_total_line_brl := CASE WHEN item.currency = 'USD' THEN NULL ELSE ROUND(v_qty * COALESCE(v_unit_brl, 0), 2) END;
      v_total_line_usd := CASE WHEN item.currency = 'USD' THEN ROUND(v_qty * COALESCE(v_unit_usd, 0), 2) ELSE NULL END;
    END IF;

    total_value_brl := v_total_line_brl;
    total_value_usd := v_total_line_usd;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_bl_local_charge_items(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.calculate_bl_local_charges(
  p_bl_id TEXT,
  p_actor UUID DEFAULT NULL,
  p_recalculate BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bl RECORD;
  v_table_id BIGINT;
  v_ref_date DATE;
  v_actor UUID;
  v_has_vehicles BOOLEAN := false;
  v_is_exempt BOOLEAN := false;
  v_is_lcl_movement BOOLEAN := false;
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
  v_container_shares JSONB;
  v_no_containers BOOLEAN := false;
  item RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
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
    b.movement_to,
    b.created_at,
    b.financial_status,
    ib.uploaded_at
  INTO v_bl
  FROM public.bls AS b
  LEFT JOIN public.import_batches AS ib ON ib.id = b.batch_id
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.financial_status IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % ja foi faturado (status financeiro=%); recalculo bloqueado. Cancele e reemita a fatura para corrigir.', p_bl_id, v_bl.financial_status USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  IF p_recalculate THEN
    DELETE FROM public.charge_calculations
    WHERE bl_id = p_bl_id
      AND COALESCE(source, 'auto') = 'auto';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.vehicles WHERE bl_id = p_bl_id)
  INTO v_has_vehicles;

  v_is_lcl_movement := v_bl.movement_to IS NOT NULL AND (
    UPPER(TRIM(v_bl.movement_to)) LIKE '%LCL%' OR UPPER(TRIM(v_bl.movement_to)) LIKE '%CFS%'
  );

  IF v_bl.cargo_mode = 'container' AND v_has_vehicles AND v_is_lcl_movement THEN
    v_is_exempt := true;
    v_reason := 'Carga de veiculos / LCL no destino (movement_to=' || v_bl.movement_to || ') com taxas pagas na origem';

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
    SET charge_status = 'exempt',
        charges_calculated_at = NOW(),
        charge_exemption_reason = v_reason,
        billing_hold_reason = NULL
    WHERE id = p_bl_id;

    RETURN jsonb_build_object(
      'bl_id', p_bl_id, 'status', 'exempt', 'table_id', NULL,
      'line_count', 1, 'total_brl', 0, 'total_usd', 0,
      'review_required', false, 'exempt', true, 'reason', v_reason
    );
  END IF;

  SELECT v_eta_raw.eta_text::DATE
  INTO v_ref_date
  FROM public.voyages AS v
  CROSS JOIN LATERAL (
    SELECT NULLIF(TRIM(v.pod_schedule_snapshot -> v_bl.pod ->> 'eta'), '') AS eta_text
  ) AS v_eta_raw
  WHERE v.id = v_bl.voyage_id
    AND v_eta_raw.eta_text ~ '^\d{4}-\d{2}-\d{2}$';

  IF v_ref_date IS NULL THEN
    SELECT v.eta::DATE
    INTO v_ref_date
    FROM public.voyages AS v
    WHERE v.id = v_bl.voyage_id
      AND v.eta IS NOT NULL;
  END IF;
  v_ref_date := COALESCE(v_ref_date, CURRENT_DATE);
  v_table_id := public.resolve_local_charge_table_id(v_bl.cargo_mode, v_bl.pod, v_ref_date);

  IF v_table_id IS NULL THEN
    v_reason := 'Nao existe tabela de taxas ativa para este POD/modo de carga';
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
      SELECT cc.cn, cc.has_imo, cc.has_oog, sh.share_count, sh.last_bl_id
      FROM current_containers AS cc
      JOIN LATERAL (
        SELECT COUNT(DISTINCT b2.id)::NUMERIC AS share_count, MAX(b2.id) AS last_bl_id
        FROM public.bls AS b2
        JOIN public.bl_containers AS bc2 ON bc2.bl_id = b2.id
        WHERE b2.voyage_id = v_bl.voyage_id
          AND COALESCE(b2.cargo_mode, 'container') = 'container'
          AND UPPER(TRIM(COALESCE(bc2.container_number, ''))) = cc.cn
      ) AS sh ON TRUE
    )
    SELECT
      COALESCE(SUM(CASE WHEN share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN NOT has_imo AND NOT has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_imo AND NOT has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_oog AND NOT has_imo AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_imo AND has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      jsonb_agg(jsonb_build_object('has_imo', has_imo, 'has_oog', has_oog, 'share_count', share_count, 'is_last', (p_bl_id = last_bl_id))) FILTER (WHERE share_count > 0)
    INTO v_qty_total, v_qty_std, v_qty_imo, v_qty_oog, v_qty_dual, v_container_shares
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
        SET status = EXCLUDED.status, quantity = EXCLUDED.quantity,
            total_value_brl = EXCLUDED.total_value_brl, review_reason = EXCLUDED.review_reason,
            notes = EXCLUDED.notes, created_by = EXCLUDED.created_by, calculated_at = NOW();
    END IF;
  END IF;

  IF v_bl.cargo_mode = 'container' THEN
    SELECT NOT EXISTS(
      SELECT 1 FROM public.bl_containers AS bc
      WHERE bc.bl_id = p_bl_id AND TRIM(COALESCE(bc.container_number, '')) <> ''
    ) INTO v_no_containers;

    IF v_no_containers THEN
      v_auto_review := true;
      INSERT INTO public.charge_calculations (
        bl_id, charge_table_id, source, status, calculation_key, quantity,
        total_value_brl, review_reason, notes, created_by, calculated_at
      )
      VALUES (
        p_bl_id, v_table_id, 'auto', 'review_required', 'review:no_containers', 1,
        0, 'B/L de container sem containers cadastrados', 'Revisao manual obrigatoria', v_actor, NOW()
      )
      ON CONFLICT (bl_id, calculation_key) DO UPDATE
        SET status = EXCLUDED.status, quantity = EXCLUDED.quantity,
            total_value_brl = EXCLUDED.total_value_brl, review_reason = EXCLUDED.review_reason,
            notes = EXCLUDED.notes, created_by = EXCLUDED.created_by, calculated_at = NOW();
    END IF;
  END IF;

  IF v_table_id IS NOT NULL THEN
    FOR item IN SELECT * FROM public.resolve_bl_local_charge_items(p_bl_id, v_bl.pod) LOOP
      IF item.status = 'review_required' THEN
        v_auto_review := true;
        -- Espelha os três INSERTs de revisão da 274: o upsert só atualiza
        -- estado/revisão; não troca a identidade, a origem nem os valores de
        -- uma linha já existente.
        INSERT INTO public.charge_calculations (
          bl_id, charge_table_id, charge_item_id, source, status, calculation_key, quantity,
          total_value_brl, review_reason, notes, created_by, calculated_at
        )
        VALUES (
          p_bl_id, item.charge_table_id, item.charge_item_id, item.source, item.status, item.calculation_key,
          item.quantity, item.total_value_brl, item.review_reason, item.notes, v_actor, NOW()
        )
        ON CONFLICT (bl_id, calculation_key) DO UPDATE
          SET status = EXCLUDED.status,
              quantity = EXCLUDED.quantity,
              total_value_brl = EXCLUDED.total_value_brl,
              review_reason = EXCLUDED.review_reason,
              notes = EXCLUDED.notes,
              created_by = EXCLUDED.created_by,
              calculated_at = NOW();
      ELSE
        -- O ramo calculado da 274 não inclui colunas de revisão no INSERT nem
        -- no ON CONFLICT; em particular, uma nota antiga não é apagada.
        INSERT INTO public.charge_calculations (
          bl_id, charge_table_id, charge_item_id, quantity,
          unit_value_brl, unit_value_usd, total_value_brl, total_value_usd,
          override_applied, source, status, calculation_key,
          created_by, calculated_at
        )
        VALUES (
          p_bl_id, item.charge_table_id, item.charge_item_id, item.quantity,
          item.unit_value_brl, item.unit_value_usd, item.total_value_brl, item.total_value_usd,
          item.override_applied, item.source, item.status, item.calculation_key,
          v_actor, NOW()
        )
        ON CONFLICT (bl_id, calculation_key) DO UPDATE
          SET charge_table_id = EXCLUDED.charge_table_id,
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
      END IF;
    END LOOP;
  END IF;

  SELECT COUNT(*),
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
  SET charge_status = v_status,
      charges_calculated_at = NOW(),
      charge_exemption_reason = CASE WHEN v_status = 'exempt' THEN v_reason ELSE NULL END,
      billing_hold_reason = CASE
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
$function$;

REVOKE ALL ON FUNCTION public.calculate_bl_local_charges(TEXT, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_bl_local_charges(TEXT, UUID, BOOLEAN) TO authenticated;
