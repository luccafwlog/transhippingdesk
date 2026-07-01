-- 162: persist freight lines captured from B/L documents and expose an atomic
-- import RPC for parser Task 4. The RPC deliberately updates only operational
-- B/L data, containers, vehicles, and freight lines; billing tables and charge
-- recalculation remain outside this boundary.

ALTER TABLE public.bls
  ADD COLUMN IF NOT EXISTS bl_emission_date DATE;

CREATE TABLE IF NOT EXISTS public.bl_freight_lines (
  bl_id TEXT NOT NULL REFERENCES public.bls(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  description TEXT,
  category TEXT,
  mercante_code TEXT,
  currency TEXT,
  amount NUMERIC(14,2),
  payment TEXT,
  PRIMARY KEY (bl_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_bl_freight_lines_bl_id
  ON public.bl_freight_lines (bl_id);

ALTER TABLE public.bl_freight_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bl_freight_lines_select_active ON public.bl_freight_lines;
DROP POLICY IF EXISTS bl_freight_lines_insert_active ON public.bl_freight_lines;
DROP POLICY IF EXISTS bl_freight_lines_update_active ON public.bl_freight_lines;
DROP POLICY IF EXISTS bl_freight_lines_delete_admin ON public.bl_freight_lines;

CREATE POLICY bl_freight_lines_select_active
ON public.bl_freight_lines
FOR SELECT
TO authenticated
USING (public.is_active_user());

CREATE POLICY bl_freight_lines_insert_active
ON public.bl_freight_lines
FOR INSERT
TO authenticated
WITH CHECK (public.is_active_user());

CREATE POLICY bl_freight_lines_update_active
ON public.bl_freight_lines
FOR UPDATE
TO authenticated
USING (public.is_active_user())
WITH CHECK (public.is_active_user());

CREATE POLICY bl_freight_lines_delete_admin
ON public.bl_freight_lines
FOR DELETE
TO authenticated
USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bl_freight_lines TO authenticated;

CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional(
  p_bls JSONB,
  p_changed_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_total_bls INTEGER := COALESCE(jsonb_array_length(p_bls), 0);
  v_inserted_freight_lines INTEGER := 0;
  v_locked_bls TEXT[] := ARRAY[]::TEXT[];
  v_unlocked_bls TEXT[] := ARRAY[]::TEXT[];
  v_container_bls TEXT[] := ARRAY[]::TEXT[];
  v_vehicle_bls TEXT[] := ARRAY[]::TEXT[];
  v_weight_locked_bls TEXT[] := ARRAY[]::TEXT[];
  v_inserted_vehicles INTEGER := 0;
  v_vehicle_items_total INTEGER := 0;
  v_vehicles_skipped INTEGER := 0;
  v_audited_fields TEXT[] := ARRAY[
    'voyage_id',
    'cargo_mode',
    'shipper',
    'consignee',
    'notify_party',
    'pol',
    'pod',
    'place_of_delivery',
    'cargo_description',
    'total_weight_kg',
    'total_cbm',
    'incoterm',
    'payment_type',
    'bl_emission_date',
    'manifest_customer_cnpj_cpf',
    'manifest_customer_name',
    'manifest_customer_email',
    'notes'
  ];
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para importar frete do BL.'
      USING ERRCODE = '42501';
  END IF;

  IF p_bls IS NULL OR jsonb_typeof(p_bls) <> 'array' THEN
    RAISE EXCEPTION 'Payload de B/Ls invalido.'
      USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE pg_temp.tmp_bl_freight_import (
    id TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    voyage_id BIGINT,
    batch_id BIGINT,
    cargo_mode TEXT,
    shipper TEXT,
    consignee TEXT,
    notify_party TEXT,
    customer_id BIGINT,
    pol TEXT,
    pod TEXT,
    place_of_delivery TEXT,
    cargo_description TEXT,
    total_weight_kg NUMERIC,
    total_cbm NUMERIC,
    incoterm TEXT,
    payment_type TEXT,
    bl_emission_date DATE,
    manifest_customer_cnpj_cpf TEXT,
    manifest_customer_name TEXT,
    manifest_customer_email TEXT,
    notes TEXT,
    billing_locked BOOLEAN NOT NULL DEFAULT false,
    override_billing BOOLEAN NOT NULL DEFAULT false,
    billing_impact BOOLEAN NOT NULL DEFAULT false
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.tmp_bl_freight_import (
    id,
    payload,
    voyage_id,
    batch_id,
    cargo_mode,
    shipper,
    consignee,
    notify_party,
    customer_id,
    pol,
    pod,
    place_of_delivery,
    cargo_description,
    total_weight_kg,
    total_cbm,
    incoterm,
    payment_type,
    bl_emission_date,
    manifest_customer_cnpj_cpf,
    manifest_customer_name,
    manifest_customer_email,
    notes,
    override_billing,
    billing_impact
  )
  SELECT
    NULLIF(bl->>'id', ''),
    bl,
    NULLIF(bl->>'voyage_id', '')::BIGINT,
    NULLIF(bl->>'batch_id', '')::BIGINT,
    NULLIF(bl->>'cargo_mode', ''),
    NULLIF(bl->>'shipper', ''),
    NULLIF(bl->>'consignee', ''),
    NULLIF(bl->>'notify_party', ''),
    NULLIF(bl->>'customer_id', '')::BIGINT,
    NULLIF(bl->>'pol', ''),
    NULLIF(bl->>'pod', ''),
    NULLIF(bl->>'place_of_delivery', ''),
    NULLIF(bl->>'cargo_description', ''),
    NULLIF(bl->>'total_weight_kg', '')::NUMERIC,
    NULLIF(bl->>'total_cbm', '')::NUMERIC,
    NULLIF(bl->>'incoterm', ''),
    NULLIF(bl->>'payment_type', ''),
    NULLIF(bl->>'bl_emission_date', '')::DATE,
    public.normalize_document_text(bl->>'manifest_customer_cnpj_cpf'),
    NULLIF(bl->>'manifest_customer_name', ''),
    NULLIF(bl->>'manifest_customer_email', ''),
    NULLIF(bl->>'notes', ''),
    COALESCE(NULLIF(bl->>'override_billing', '')::BOOLEAN, false),
    COALESCE(NULLIF(bl->>'billing_impact', '')::BOOLEAN, false)
  FROM jsonb_array_elements(p_bls) AS bl;

  IF EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import WHERE id IS NULL) THEN
    RAISE EXCEPTION 'B/L sem identificador no payload de frete.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE pg_temp.tmp_bl_freight_import AS t
  SET billing_locked = EXISTS (
    SELECT 1
    FROM public.charge_calculations AS cc
    WHERE cc.bl_id = t.id
  ) OR EXISTS (
    SELECT 1
    FROM public.invoice_bls AS ib
    WHERE ib.bl_id = t.id
  )
  WHERE EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = t.id
  );

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_locked_bls
  FROM pg_temp.tmp_bl_freight_import
  WHERE billing_locked;

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_unlocked_bls
  FROM pg_temp.tmp_bl_freight_import
  WHERE NOT billing_locked;

  -- Weight is a billing variable only for carga solta; hold it back when the B/L
  -- is billed and the operator did not override.
  SELECT COALESCE(array_agg(t.id ORDER BY t.id), ARRAY[]::TEXT[])
  INTO v_weight_locked_bls
  FROM pg_temp.tmp_bl_freight_import AS t
  JOIN public.bls AS b ON b.id = t.id
  WHERE t.billing_locked
    AND NOT t.override_billing
    AND b.cargo_mode = 'carga_solta';

  CREATE TEMP TABLE pg_temp.tmp_old_bl_values ON COMMIT DROP AS
  SELECT
    b.id,
    to_jsonb(b) AS old_row,
    to_jsonb(t) AS new_row,
    t.billing_locked
  FROM public.bls AS b
  JOIN pg_temp.tmp_bl_freight_import AS t ON t.id = b.id;

  INSERT INTO public.bls (
    id,
    voyage_id,
    batch_id,
    cargo_mode,
    shipper,
    consignee,
    notify_party,
    customer_id,
    pol,
    pod,
    place_of_delivery,
    cargo_description,
    total_weight_kg,
    total_cbm,
    incoterm,
    payment_type,
    bl_emission_date,
    manifest_customer_cnpj_cpf,
    manifest_customer_name,
    manifest_customer_email,
    notes
  )
  SELECT
    id,
    voyage_id,
    batch_id,
    COALESCE(cargo_mode, 'container'),
    shipper,
    consignee,
    notify_party,
    customer_id,
    pol,
    pod,
    place_of_delivery,
    cargo_description,
    total_weight_kg,
    total_cbm,
    incoterm,
    payment_type,
    bl_emission_date,
    manifest_customer_cnpj_cpf,
    COALESCE(manifest_customer_name, consignee),
    manifest_customer_email,
    notes
  FROM pg_temp.tmp_bl_freight_import
  ON CONFLICT (id) DO UPDATE SET
    voyage_id = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'voyage_id') THEN EXCLUDED.voyage_id ELSE bls.voyage_id END,
    batch_id = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'batch_id') THEN EXCLUDED.batch_id ELSE bls.batch_id END,
    cargo_mode = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'cargo_mode') THEN EXCLUDED.cargo_mode ELSE bls.cargo_mode END,
    shipper = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'shipper') THEN EXCLUDED.shipper ELSE bls.shipper END,
    consignee = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'consignee') THEN EXCLUDED.consignee ELSE bls.consignee END,
    notify_party = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notify_party') THEN EXCLUDED.notify_party ELSE bls.notify_party END,
    customer_id = bls.customer_id,
    pol = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'pol') THEN EXCLUDED.pol ELSE bls.pol END,
    pod = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'pod') THEN EXCLUDED.pod ELSE bls.pod END,
    place_of_delivery = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'place_of_delivery') THEN EXCLUDED.place_of_delivery ELSE bls.place_of_delivery END,
    cargo_description = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'cargo_description') THEN EXCLUDED.cargo_description ELSE bls.cargo_description END,
    total_weight_kg = CASE WHEN EXCLUDED.id <> ALL(v_weight_locked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'total_weight_kg') THEN EXCLUDED.total_weight_kg ELSE bls.total_weight_kg END,
    total_cbm = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'total_cbm') THEN EXCLUDED.total_cbm ELSE bls.total_cbm END,
    incoterm = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'incoterm') THEN EXCLUDED.incoterm ELSE bls.incoterm END,
    payment_type = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'payment_type') THEN EXCLUDED.payment_type ELSE bls.payment_type END,
    bl_emission_date = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'bl_emission_date') THEN EXCLUDED.bl_emission_date ELSE bls.bl_emission_date END,
    manifest_customer_cnpj_cpf = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'manifest_customer_cnpj_cpf') THEN EXCLUDED.manifest_customer_cnpj_cpf ELSE bls.manifest_customer_cnpj_cpf END,
    manifest_customer_name = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'manifest_customer_name') THEN EXCLUDED.manifest_customer_name ELSE bls.manifest_customer_name END,
    manifest_customer_email = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'manifest_customer_email') THEN EXCLUDED.manifest_customer_email ELSE bls.manifest_customer_email END,
    notes = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notes') THEN EXCLUDED.notes ELSE bls.notes END,
    updated_at = now();

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
    'bl',
    old_values.id,
    field_name,
    old_values.old_row->>field_name,
    to_jsonb(b)->>field_name,
    p_changed_by,
    CASE
      WHEN old_values.billing_locked THEN 'Importacao automatica de frete do BL; campos operacionais protegidos por faturamento existente'
      ELSE 'Importacao automatica de frete do BL'
    END
  FROM pg_temp.tmp_old_bl_values AS old_values
  JOIN public.bls AS b ON b.id = old_values.id
  CROSS JOIN unnest(v_audited_fields) AS audited(field_name)
  WHERE COALESCE(old_values.old_row->>field_name, '') IS DISTINCT FROM COALESCE(to_jsonb(b)->>field_name, '');

  DELETE FROM public.bl_freight_lines
  WHERE bl_id IN (
    SELECT id
    FROM pg_temp.tmp_bl_freight_import
    WHERE payload ? 'freight_lines'
       OR payload ? 'freightLines'
  );

  INSERT INTO public.bl_freight_lines (
    bl_id,
    seq,
    description,
    category,
    mercante_code,
    currency,
    amount,
    payment
  )
  SELECT
    t.id,
    COALESCE(NULLIF(line.item->>'seq', '')::INTEGER, line.ordinality::INTEGER),
    NULLIF(line.item->>'description', ''),
    NULLIF(line.item->>'category', ''),
    NULLIF(line.item->>'mercante_code', ''),
    NULLIF(line.item->>'currency', ''),
    NULLIF(line.item->>'amount', '')::NUMERIC,
    NULLIF(line.item->>'payment', '')
  FROM pg_temp.tmp_bl_freight_import AS t
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(COALESCE(t.payload->'freight_lines', t.payload->'freightLines')) = 'array'
        THEN COALESCE(t.payload->'freight_lines', t.payload->'freightLines')
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS line(item, ordinality);

  GET DIAGNOSTICS v_inserted_freight_lines = ROW_COUNT;

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_container_bls
  FROM pg_temp.tmp_bl_freight_import
  WHERE (NOT billing_locked OR override_billing)
    AND payload ? 'containers';

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_vehicle_bls
  FROM pg_temp.tmp_bl_freight_import
  WHERE (NOT billing_locked OR override_billing)
    AND payload ? 'vehicles';

  CREATE TEMP TABLE pg_temp.tmp_new_containers (
    id BIGINT,
    bl_id TEXT,
    container_number TEXT
  ) ON COMMIT DROP;

  DELETE FROM public.vehicles
  WHERE bl_id = ANY(v_vehicle_bls);

  DELETE FROM public.bl_containers
  WHERE bl_id = ANY(v_container_bls);

  WITH inserted AS (
    INSERT INTO public.bl_containers (
      bl_id,
      container_number,
      seal_number,
      type,
      tare_weight_kg,
      gross_weight_kg,
      cbm,
      is_oog,
      is_imo,
      imo_class,
      un_number
    )
    SELECT
      t.id,
      c.item->>'container_number',
      NULLIF(c.item->>'seal_number', ''),
      NULLIF(c.item->>'type', ''),
      NULLIF(c.item->>'tare_weight_kg', '')::NUMERIC,
      NULLIF(c.item->>'gross_weight_kg', '')::NUMERIC,
      NULLIF(c.item->>'cbm', '')::NUMERIC,
      COALESCE(NULLIF(c.item->>'is_oog', '')::BOOLEAN, false),
      COALESCE(NULLIF(c.item->>'is_imo', '')::BOOLEAN, false),
      NULLIF(c.item->>'imo_class', ''),
      NULLIF(c.item->>'un_number', '')
    FROM pg_temp.tmp_bl_freight_import AS t
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(t.payload->'containers') = 'array' THEN t.payload->'containers'
        ELSE '[]'::jsonb
      END
    ) AS c(item)
    WHERE t.id = ANY(v_container_bls)
      AND NULLIF(c.item->>'container_number', '') IS NOT NULL
    RETURNING id, bl_id, container_number
  )
  INSERT INTO pg_temp.tmp_new_containers (id, bl_id, container_number)
  SELECT id, bl_id, container_number
  FROM inserted;

  SELECT COALESCE(SUM(
    jsonb_array_length(
      CASE WHEN jsonb_typeof(t.payload->'vehicles') = 'array' THEN t.payload->'vehicles' ELSE '[]'::jsonb END
    )
  ), 0)
  INTO v_vehicle_items_total
  FROM pg_temp.tmp_bl_freight_import AS t
  WHERE t.id = ANY(v_vehicle_bls);

  INSERT INTO public.vehicles (
    voyage_id,
    container_id,
    bl_id,
    chassis,
    brand,
    model,
    weight_kg,
    cbm
  )
  SELECT
    COALESCE(NULLIF(v.item->>'voyage_id', '')::BIGINT, b.voyage_id),
    COALESCE(NULLIF(v.item->>'container_id', '')::BIGINT, c.id),
    t.id,
    v.item->>'chassis',
    v.item->>'brand',
    v.item->>'model',
    NULLIF(v.item->>'weight_kg', '')::NUMERIC,
    NULLIF(v.item->>'cbm', '')::NUMERIC
  FROM pg_temp.tmp_bl_freight_import AS t
  JOIN public.bls AS b ON b.id = t.id
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(t.payload->'vehicles') = 'array' THEN t.payload->'vehicles'
      ELSE '[]'::jsonb
    END
  ) AS v(item)
  LEFT JOIN pg_temp.tmp_new_containers AS c
    ON c.bl_id = t.id
   AND c.container_number = NULLIF(v.item->>'container_number', '')
  WHERE t.id = ANY(v_vehicle_bls)
    AND NULLIF(v.item->>'chassis', '') IS NOT NULL
    AND COALESCE(NULLIF(v.item->>'container_id', '')::BIGINT, c.id) IS NOT NULL;

  GET DIAGNOSTICS v_inserted_vehicles = ROW_COUNT;
  v_vehicles_skipped := GREATEST(v_vehicle_items_total - v_inserted_vehicles, 0);

  -- Billing-relevant changes held back because the operator did not override.
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
    'bl',
    t.id,
    'ALTERACAO_OPERACIONAL_BLOQUEADA',
    NULL,
    'billing_locked',
    p_changed_by,
    'Importacao de frete do BL: alteracao com impacto em faturamento bloqueada (sem override do operador)'
  FROM pg_temp.tmp_bl_freight_import AS t
  WHERE t.billing_locked
    AND t.billing_impact
    AND NOT t.override_billing;

  -- Billing-relevant changes applied under an explicit operator override.
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
    'bl',
    t.id,
    'FATURAMENTO_SOBRESCRITO',
    NULL,
    'override_billing',
    p_changed_by,
    'Importacao de frete do BL: alteracao com impacto em faturamento aplicada por override do operador'
  FROM pg_temp.tmp_bl_freight_import AS t
  WHERE t.billing_locked
    AND t.billing_impact
    AND t.override_billing;

  RETURN jsonb_build_object(
    'bls_received', v_total_bls,
    'freight_lines_inserted', v_inserted_freight_lines,
    'billing_locked', v_locked_bls,
    'operational_updated', v_unlocked_bls,
    'vehicles_inserted', v_inserted_vehicles,
    'vehicles_skipped', v_vehicles_skipped
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.import_bl_freight_transactional(JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bl_freight_transactional(JSONB, UUID) TO authenticated;
