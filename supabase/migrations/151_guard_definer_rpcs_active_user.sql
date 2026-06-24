-- Renumbered from 20260624100100 (original timestamped migration: 20260624100100_guard_definer_rpcs_active_user.sql).
-- ADR 0004 (RLS/RPC como fronteira de seguranca) exige que cada SECURITY DEFINER
-- chamavel pelo cliente revalide identidade/papel internamente, porque DEFINER
-- ignora RLS. As cinco funcoes abaixo estavam marcadas como Suspeita em
-- docs/RASTREABILIDADE.md por nao chamarem is_active_user(): uma sessao
-- autenticada porem inativa (perfil interno desativado, mas Auth ainda valido)
-- podia alcanca-las. Esta migration adiciona o mesmo gate ja usado pelas demais
-- RPCs (auth.uid() + is_active_user(), erro 42501) sem alterar a logica de
-- negocio nem as assinaturas. As tres funcoes de leitura eram LANGUAGE sql e
-- foram convertidas para plpgsql apenas para permitir o gate; a query foi
-- preservada verbatim sob RETURN QUERY.
--
-- Rollback: remover os gates reabriria o desvio do ADR 0004 — nao remover sem
-- substituir por controle equivalente.

-- 1) calculate_bl_local_charges: reforca o IF auth.uid() existente.
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

REVOKE ALL ON FUNCTION public.calculate_bl_local_charges(TEXT, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_bl_local_charges(TEXT, UUID, BOOLEAN) TO authenticated;

-- 2) detect_overdue_invoices: adiciona gate de usuario ativo (antes nao havia).
CREATE OR REPLACE FUNCTION public.detect_overdue_invoices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row RECORD;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN
    UPDATE public.invoices
    SET status = 'overdue'
    WHERE status IN ('issued', 'partially_paid')
      AND due_date IS NOT NULL
      AND due_date < CURRENT_DATE
    RETURNING id, invoice_number, balance_brl, due_date
  LOOP
    -- Cria alerta apenas se não existe um aberto/reconhecido para esta invoice
    INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
    SELECT
      'invoice_overdue',
      'invoice',
      v_row.id::text,
      format(
        'Invoice %s venceu em %s — saldo pendente: R$ %s',
        COALESCE(v_row.invoice_number, 'INV-' || v_row.id),
        to_char(v_row.due_date, 'DD/MM/YYYY'),
        to_char(COALESCE(v_row.balance_brl, 0), 'FM999,999,990.00')
      ),
      'open'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.alerts
      WHERE type = 'invoice_overdue'
        AND entity_id = v_row.id::text
        AND status != 'closed'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.detect_overdue_invoices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_overdue_invoices() TO authenticated;

-- 3) list_bl_local_charge_lines: SQL -> plpgsql com gate; query preservada.
CREATE OR REPLACE FUNCTION public.list_bl_local_charge_lines(p_bl_id TEXT)
RETURNS TABLE (
  id BIGINT,
  bl_id TEXT,
  charge_table_id BIGINT,
  charge_item_id BIGINT,
  charge_name TEXT,
  source TEXT,
  status TEXT,
  quantity NUMERIC,
  currency TEXT,
  unit_value_brl NUMERIC,
  unit_value_usd NUMERIC,
  total_value_brl NUMERIC,
  total_value_usd NUMERIC,
  override_applied BOOLEAN,
  calculation_key TEXT,
  notes TEXT,
  review_reason TEXT,
  calculated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    cc.id,
    cc.bl_id,
    cc.charge_table_id,
    cc.charge_item_id,
    COALESCE(cti.name, '[Sistema]') AS charge_name,
    cc.source,
    cc.status,
    cc.quantity,
    COALESCE(cti.currency, CASE WHEN cc.unit_value_usd IS NOT NULL THEN 'USD' ELSE 'BRL' END) AS currency,
    cc.unit_value_brl,
    cc.unit_value_usd,
    cc.total_value_brl,
    cc.total_value_usd,
    cc.override_applied,
    cc.calculation_key,
    cc.notes,
    cc.review_reason,
    cc.calculated_at
  FROM public.charge_calculations AS cc
  LEFT JOIN public.charge_table_items AS cti ON cti.id = cc.charge_item_id
  WHERE cc.bl_id = p_bl_id
  ORDER BY cc.source DESC, cc.id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_bl_local_charge_lines(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_bl_local_charge_lines(TEXT) TO authenticated;

-- 4) list_manual_charge_items_for_bl: SQL -> plpgsql com gate; query preservada.
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
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
END;
$$;

REVOKE ALL ON FUNCTION public.list_manual_charge_items_for_bl(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_manual_charge_items_for_bl(TEXT) TO authenticated;

-- 5) list_customer_reconciliation_queue: SQL -> plpgsql com gate; query preservada.
CREATE OR REPLACE FUNCTION public.list_customer_reconciliation_queue(
  p_status TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 200
)
RETURNS TABLE (
  id BIGINT,
  manifest_id BIGINT,
  bl_id TEXT,
  customer_id BIGINT,
  current_customer_name TEXT,
  cnpj_cpf TEXT,
  manifest_customer_name TEXT,
  manifest_customer_email TEXT,
  detection_type TEXT,
  status TEXT,
  notes TEXT,
  resolution_notes TEXT,
  charge_status TEXT,
  financial_status TEXT,
  billing_hold_reason TEXT,
  created_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    q.id,
    q.manifest_id,
    q.bl_id,
    q.customer_id,
    c.name AS current_customer_name,
    q.cnpj_cpf,
    q.manifest_customer_name,
    q.manifest_customer_email,
    q.detection_type,
    q.status,
    q.notes,
    q.resolution_notes,
    b.charge_status,
    b.financial_status,
    b.billing_hold_reason,
    q.created_at,
    q.approved_at,
    q.rejected_at
  FROM public.customer_reconciliation_queue AS q
  LEFT JOIN public.customers AS c ON c.id = q.customer_id
  JOIN public.bls AS b ON b.id = q.bl_id
  WHERE p_status IS NULL OR q.status = p_status
  ORDER BY q.created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 200), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.list_customer_reconciliation_queue(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_customer_reconciliation_queue(TEXT, INTEGER) TO authenticated;
