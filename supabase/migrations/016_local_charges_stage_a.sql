-- Etapa A - Taxas Locais (motor de calculo + seed base)
-- Escopo:
-- 1) Evolucao de schema para charge tables/items/calculations
-- 2) Campos operacionais em B/L
-- 3) Seed inicial CNTR/BB + other charges
-- 4) RPC de calculo idempotente por B/L e RPC de listagem

-- ---------------------------------------------------------------------------
-- Schema evolution
-- ---------------------------------------------------------------------------

ALTER TABLE public.charge_tables
  ADD COLUMN IF NOT EXISTS cargo_mode TEXT;

ALTER TABLE public.charge_tables
  ADD COLUMN IF NOT EXISTS notes TEXT;

UPDATE public.charge_tables
SET cargo_mode = COALESCE(cargo_mode, 'container')
WHERE cargo_mode IS NULL;

ALTER TABLE public.charge_tables
  ALTER COLUMN cargo_mode SET DEFAULT 'container';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'charge_tables_cargo_mode_check'
  ) THEN
    ALTER TABLE public.charge_tables
      ADD CONSTRAINT charge_tables_cargo_mode_check
      CHECK (cargo_mode IN ('container', 'carga_solta'));
  END IF;
END $$;

ALTER TABLE public.charge_table_items
  ADD COLUMN IF NOT EXISTS category TEXT;

ALTER TABLE public.charge_table_items
  ADD COLUMN IF NOT EXISTS application_basis TEXT;

ALTER TABLE public.charge_table_items
  ADD COLUMN IF NOT EXISTS unit_value_brl NUMERIC(12,2);

ALTER TABLE public.charge_table_items
  ADD COLUMN IF NOT EXISTS unit_value_usd NUMERIC(12,2);

ALTER TABLE public.charge_table_items
  ADD COLUMN IF NOT EXISTS manual_only BOOLEAN DEFAULT false;

ALTER TABLE public.charge_table_items
  ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

ALTER TABLE public.charge_table_items
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 100;

UPDATE public.charge_table_items
SET
  category = COALESCE(category, 'base'),
  application_basis = COALESCE(
    application_basis,
    CASE applies_to
      WHEN 'bl' THEN 'bl'
      WHEN 'container' THEN 'container_distinct_voyage'
      WHEN 'teu' THEN 'teu'
      ELSE 'bl'
    END
  ),
  unit_value_brl = COALESCE(unit_value_brl, value_brl),
  cargo_profile = COALESCE(cargo_profile, 'any'),
  manual_only = COALESCE(manual_only, false),
  active = COALESCE(active, true),
  sort_order = COALESCE(sort_order, 100);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'charge_table_items_category_check'
  ) THEN
    ALTER TABLE public.charge_table_items
      ADD CONSTRAINT charge_table_items_category_check
      CHECK (category IN ('base', 'other_charge'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'charge_table_items_application_basis_check'
  ) THEN
    ALTER TABLE public.charge_table_items
      ADD CONSTRAINT charge_table_items_application_basis_check
      CHECK (application_basis IN ('bl', 'container_distinct_voyage', 'weight_ton', 'teu'));
  END IF;
END $$;

ALTER TABLE public.charge_calculations
  ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE public.charge_calculations
  ADD COLUMN IF NOT EXISTS status TEXT;

ALTER TABLE public.charge_calculations
  ADD COLUMN IF NOT EXISTS calculation_key TEXT;

ALTER TABLE public.charge_calculations
  ADD COLUMN IF NOT EXISTS unit_value_usd NUMERIC(12,2);

ALTER TABLE public.charge_calculations
  ADD COLUMN IF NOT EXISTS total_value_usd NUMERIC(14,2);

ALTER TABLE public.charge_calculations
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE public.charge_calculations
  ADD COLUMN IF NOT EXISTS manual_reason TEXT;

ALTER TABLE public.charge_calculations
  ADD COLUMN IF NOT EXISTS review_reason TEXT;

ALTER TABLE public.charge_calculations
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);

ALTER TABLE public.charge_calculations
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id);

ALTER TABLE public.charge_calculations
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

UPDATE public.charge_calculations
SET
  source = COALESCE(source, 'auto'),
  status = COALESCE(status, 'calculated')
WHERE source IS NULL OR status IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'charge_calculations_source_check'
  ) THEN
    ALTER TABLE public.charge_calculations
      ADD CONSTRAINT charge_calculations_source_check
      CHECK (source IN ('auto', 'manual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'charge_calculations_status_check'
  ) THEN
    ALTER TABLE public.charge_calculations
      ADD CONSTRAINT charge_calculations_status_check
      CHECK (status IN ('calculated', 'review_required', 'reviewed', 'ready_for_billing', 'exempt'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_charge_calculations_bl_key
ON public.charge_calculations (bl_id, calculation_key);

ALTER TABLE public.bls
  ADD COLUMN IF NOT EXISTS charge_status TEXT;

ALTER TABLE public.bls
  ADD COLUMN IF NOT EXISTS charges_calculated_at TIMESTAMPTZ;

ALTER TABLE public.bls
  ADD COLUMN IF NOT EXISTS charges_reviewed_at TIMESTAMPTZ;

ALTER TABLE public.bls
  ADD COLUMN IF NOT EXISTS charge_exemption_reason TEXT;

ALTER TABLE public.bls
  ADD COLUMN IF NOT EXISTS container_load_type TEXT;

UPDATE public.bls
SET charge_status = COALESCE(charge_status, 'not_calculated')
WHERE charge_status IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bls_charge_status_check'
  ) THEN
    ALTER TABLE public.bls
      ADD CONSTRAINT bls_charge_status_check
      CHECK (charge_status IN ('not_calculated', 'calculated', 'review_required', 'reviewed', 'ready_for_billing', 'exempt'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bls_container_load_type_check'
  ) THEN
    ALTER TABLE public.bls
      ADD CONSTRAINT bls_container_load_type_check
      CHECK (container_load_type IN ('FCL', 'LCL') OR container_load_type IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bls_charge_status
ON public.bls (charge_status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_charge_tables_scope
ON public.charge_tables (cargo_mode, pod, valid_from, name);

CREATE INDEX IF NOT EXISTS idx_charge_table_items_table_active
ON public.charge_table_items (charge_table_id, active, manual_only);

CREATE UNIQUE INDEX IF NOT EXISTS uq_charge_table_items_scope
ON public.charge_table_items (
  charge_table_id,
  name,
  category,
  application_basis,
  cargo_profile,
  manual_only,
  currency
);

CREATE INDEX IF NOT EXISTS idx_customer_rate_overrides_scope
ON public.customer_rate_overrides (customer_id, charge_item_id, valid_from, valid_to);

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalize_port_code(p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v TEXT;
BEGIN
  v := UPPER(TRIM(COALESCE(p_value, '')));

  IF v = '' THEN
    RETURN '';
  END IF;

  IF v LIKE '%BRVIT%' OR v LIKE '%VITORIA%' THEN
    RETURN 'BRVIT';
  END IF;

  IF v LIKE '%BRSSA%' OR v LIKE '%SALVADOR%' THEN
    RETURN 'BRSSA';
  END IF;

  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_local_charge_table_id(
  p_cargo_mode TEXT,
  p_pod TEXT,
  p_reference_date DATE
)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT ct.id
  FROM public.charge_tables AS ct
  WHERE ct.active = true
    AND ct.cargo_mode = p_cargo_mode
    AND public.normalize_port_code(ct.pod) = public.normalize_port_code(p_pod)
    AND ct.valid_from <= p_reference_date
    AND (ct.valid_to IS NULL OR ct.valid_to >= p_reference_date)
  ORDER BY ct.valid_from DESC, ct.id DESC
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- Seed base tables/items
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_ct_vit_cntr BIGINT;
  v_ct_ssa_cntr BIGINT;
  v_ct_vit_bb BIGINT;
  v_ct_ssa_bb BIGINT;
  v_ct_other BIGINT;
BEGIN
  INSERT INTO public.charge_tables (name, cargo_mode, pod, valid_from, active, notes)
  VALUES ('Tabela CNTR BRVIT v1', 'container', 'BRVIT', DATE '2026-01-01', true, 'Seed Etapa A')
  ON CONFLICT (cargo_mode, pod, valid_from, name) DO UPDATE
    SET active = EXCLUDED.active,
        notes = EXCLUDED.notes
  RETURNING id INTO v_ct_vit_cntr;

  INSERT INTO public.charge_tables (name, cargo_mode, pod, valid_from, active, notes)
  VALUES ('Tabela CNTR BRSSA v1', 'container', 'BRSSA', DATE '2026-01-01', true, 'Seed Etapa A')
  ON CONFLICT (cargo_mode, pod, valid_from, name) DO UPDATE
    SET active = EXCLUDED.active,
        notes = EXCLUDED.notes
  RETURNING id INTO v_ct_ssa_cntr;

  INSERT INTO public.charge_tables (name, cargo_mode, pod, valid_from, active, notes)
  VALUES ('Tabela BB BRVIT v1', 'carga_solta', 'BRVIT', DATE '2026-01-01', true, 'Seed Etapa A')
  ON CONFLICT (cargo_mode, pod, valid_from, name) DO UPDATE
    SET active = EXCLUDED.active,
        notes = EXCLUDED.notes
  RETURNING id INTO v_ct_vit_bb;

  INSERT INTO public.charge_tables (name, cargo_mode, pod, valid_from, active, notes)
  VALUES ('Tabela BB BRSSA v1', 'carga_solta', 'BRSSA', DATE '2026-01-01', true, 'Seed Etapa A')
  ON CONFLICT (cargo_mode, pod, valid_from, name) DO UPDATE
    SET active = EXCLUDED.active,
        notes = EXCLUDED.notes
  RETURNING id INTO v_ct_ssa_bb;

  INSERT INTO public.charge_tables (name, cargo_mode, pod, valid_from, active, notes)
  VALUES ('Tabela Other Charges v1', 'container', 'ANY', DATE '2026-01-01', true, 'Lancamentos manuais')
  ON CONFLICT (cargo_mode, pod, valid_from, name) DO UPDATE
    SET active = EXCLUDED.active,
        notes = EXCLUDED.notes
  RETURNING id INTO v_ct_other;

  -- CNTR BRVIT
  INSERT INTO public.charge_table_items
    (charge_table_id, name, category, application_basis, applies_to, cargo_profile, currency, unit_value_brl, value_brl, manual_only, active, sort_order)
  VALUES
    (v_ct_vit_cntr, 'THD', 'base', 'container_distinct_voyage', 'container', 'standard', 'BRL', 1420.00, 1420.00, false, true, 10),
    (v_ct_vit_cntr, 'THD', 'base', 'container_distinct_voyage', 'container', 'imo',      'BRL', 2130.00, 2130.00, false, true, 11),
    (v_ct_vit_cntr, 'THD', 'base', 'container_distinct_voyage', 'container', 'oog',      'BRL', 2840.00, 2840.00, false, true, 12),
    (v_ct_vit_cntr, 'ISPS', 'base', 'container_distinct_voyage', 'container', 'any',     'BRL',  115.00,  115.00, false, true, 20),
    (v_ct_vit_cntr, 'B/L Fee', 'base', 'bl', 'bl', 'any',                        'BRL',  600.00,  600.00, false, true, 30),
    (v_ct_vit_cntr, 'Drop Off Fee', 'base', 'container_distinct_voyage', 'container', 'any', 'BRL', 150.00, 150.00, false, true, 40),
    (v_ct_vit_cntr, 'Damage Protection Fee', 'base', 'container_distinct_voyage', 'container', 'any', 'BRL', 185.00, 185.00, false, true, 50)
  ON CONFLICT (charge_table_id, name, category, application_basis, cargo_profile, manual_only, currency) DO UPDATE
    SET unit_value_brl = EXCLUDED.unit_value_brl,
        value_brl = EXCLUDED.value_brl,
        active = EXCLUDED.active,
        sort_order = EXCLUDED.sort_order;

  -- CNTR BRSSA
  INSERT INTO public.charge_table_items
    (charge_table_id, name, category, application_basis, applies_to, cargo_profile, currency, unit_value_brl, value_brl, manual_only, active, sort_order)
  VALUES
    (v_ct_ssa_cntr, 'THD', 'base', 'container_distinct_voyage', 'container', 'standard', 'BRL', 1717.00, 1717.00, false, true, 10),
    (v_ct_ssa_cntr, 'THD', 'base', 'container_distinct_voyage', 'container', 'imo',      'BRL', 2575.50, 2575.50, false, true, 11),
    (v_ct_ssa_cntr, 'THD', 'base', 'container_distinct_voyage', 'container', 'oog',      'BRL', 3434.00, 3434.00, false, true, 12),
    (v_ct_ssa_cntr, 'ISPS', 'base', 'container_distinct_voyage', 'container', 'any',     'BRL',   50.00,   50.00, false, true, 20),
    (v_ct_ssa_cntr, 'B/L Fee', 'base', 'bl', 'bl', 'any',                        'BRL',  600.00,  600.00, false, true, 30),
    (v_ct_ssa_cntr, 'Drop Off Fee', 'base', 'container_distinct_voyage', 'container', 'any', 'BRL', 150.00, 150.00, false, true, 40),
    (v_ct_ssa_cntr, 'Damage Protection Fee', 'base', 'container_distinct_voyage', 'container', 'any', 'BRL', 185.00, 185.00, false, true, 50)
  ON CONFLICT (charge_table_id, name, category, application_basis, cargo_profile, manual_only, currency) DO UPDATE
    SET unit_value_brl = EXCLUDED.unit_value_brl,
        value_brl = EXCLUDED.value_brl,
        active = EXCLUDED.active,
        sort_order = EXCLUDED.sort_order;

  -- BB BRVIT + BRSSA
  INSERT INTO public.charge_table_items
    (charge_table_id, name, category, application_basis, applies_to, cargo_profile, currency, unit_value_brl, value_brl, manual_only, active, sort_order)
  VALUES
    (v_ct_vit_bb, 'B/L Fee', 'base', 'bl', 'bl', 'any', 'BRL', 600.00, 600.00, false, true, 10),
    (v_ct_vit_bb, 'Weight Fee', 'base', 'weight_ton', 'bl', 'any', 'BRL', 62.50, 62.50, false, true, 20),
    (v_ct_ssa_bb, 'B/L Fee', 'base', 'bl', 'bl', 'any', 'BRL', 600.00, 600.00, false, true, 10),
    (v_ct_ssa_bb, 'Weight Fee', 'base', 'weight_ton', 'bl', 'any', 'BRL', 62.50, 62.50, false, true, 20)
  ON CONFLICT (charge_table_id, name, category, application_basis, cargo_profile, manual_only, currency) DO UPDATE
    SET unit_value_brl = EXCLUDED.unit_value_brl,
        value_brl = EXCLUDED.value_brl,
        active = EXCLUDED.active,
        sort_order = EXCLUDED.sort_order;

  -- Other Charges (manual only)
  INSERT INTO public.charge_table_items
    (charge_table_id, name, category, application_basis, applies_to, cargo_profile, currency, unit_value_brl, value_brl, manual_only, active, sort_order)
  VALUES
    (v_ct_other, 'B/L Reissuing', 'other_charge', 'bl', 'bl', 'any', 'BRL', 600.00, 600.00, true, true, 10),
    (v_ct_other, 'Correction Letter', 'other_charge', 'bl', 'bl', 'any', 'BRL', 600.00, 600.00, true, true, 20),
    (v_ct_other, 'Late correction request', 'other_charge', 'bl', 'bl', 'any', 'BRL', 850.00, 850.00, true, true, 30),
    (v_ct_other, 'Booking Cancelation Fee', 'other_charge', 'container_distinct_voyage', 'container', 'any', 'USD', 0, 0, true, true, 40)
  ON CONFLICT (charge_table_id, name, category, application_basis, cargo_profile, manual_only, currency) DO UPDATE
    SET unit_value_brl = EXCLUDED.unit_value_brl,
        value_brl = EXCLUDED.value_brl,
        unit_value_usd = CASE
          WHEN EXCLUDED.currency = 'USD' THEN COALESCE(EXCLUDED.unit_value_usd, 150.00)
          ELSE public.charge_table_items.unit_value_usd
        END,
        active = EXCLUDED.active,
        sort_order = EXCLUDED.sort_order;

  UPDATE public.charge_table_items
  SET unit_value_usd = 150.00
  WHERE charge_table_id = v_ct_other
    AND name = 'Booking Cancelation Fee';
END $$;

-- ---------------------------------------------------------------------------
-- RPC: list local charge lines by BL
-- ---------------------------------------------------------------------------

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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.list_bl_local_charge_lines(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_bl_local_charge_lines(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: calculate/recalculate local charges by BL
-- ---------------------------------------------------------------------------

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
      charge_exemption_reason = v_reason
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
    charge_exemption_reason = CASE WHEN v_status = 'exempt' THEN v_reason ELSE NULL END
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
