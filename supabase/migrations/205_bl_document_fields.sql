-- 205_bl_document_fields.sql
-- Campos documentais do B/L que o parser ja le e o sistema descartava.
-- Forward-only: B/Ls historicos ficam NULL ate reimporte.

ALTER TABLE public.bls ADD COLUMN IF NOT EXISTS place_of_receipt TEXT;
ALTER TABLE public.bls ADD COLUMN IF NOT EXISTS movement_from TEXT;
ALTER TABLE public.bls ADD COLUMN IF NOT EXISTS movement_to TEXT;
ALTER TABLE public.bls ADD COLUMN IF NOT EXISTS issue_place TEXT;

CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional(p_bls jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_total_bls INTEGER := COALESCE(jsonb_array_length(p_bls), 0);
  v_inserted_freight_lines INTEGER := 0;
  v_locked_bls TEXT[] := ARRAY[]::TEXT[];
  v_unlocked_bls TEXT[] := ARRAY[]::TEXT[];
  v_container_bls TEXT[] := ARRAY[]::TEXT[];
  v_vehicle_bls TEXT[] := ARRAY[]::TEXT[];
  v_weight_locked_bls TEXT[] := ARRAY[]::TEXT[];
  v_billing_hold_bls TEXT[] := ARRAY[]::TEXT[];
  v_imported_bl_ids TEXT[] := ARRAY[]::TEXT[];
  v_bl_id TEXT;
  v_inserted_vehicles INTEGER := 0;
  v_vehicle_items_total INTEGER := 0;
  v_vehicles_skipped INTEGER := 0;
  v_audited_fields TEXT[] := ARRAY[
    'voyage_id',
    'cargo_mode',
    'shipper',
    'consignee',
    'notify_party',
    'customer_id',
    'customer_reconciliation_status',
    'customer_reconciliation_notes',
    'billing_hold_reason',
    'pol',
    'pod',
    'place_of_delivery',
    'place_of_receipt',
    'movement_from',
    'movement_to',
    'issue_place',
    'cargo_description',
    'total_packages',
    'packages_unit',
    'consignee_phone',
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
    consignee_block TEXT,
    shipper_block TEXT,
    notify_block TEXT,
    notify2_block TEXT,
    notify_cnpj_cpf TEXT,
    customer_id BIGINT,
    customer_reconciliation_status TEXT,
    customer_reconciliation_notes TEXT,
    billing_hold_reason TEXT,
    pol TEXT,
    pod TEXT,
    place_of_delivery TEXT,
    place_of_receipt TEXT,
    movement_from TEXT,
    movement_to TEXT,
    issue_place TEXT,
    cargo_description TEXT,
    total_packages INTEGER,
    packages_unit TEXT,
    consignee_phone TEXT,
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
    consignee_block,
    shipper_block,
    notify_block,
    notify2_block,
    notify_cnpj_cpf,
    customer_id,
    customer_reconciliation_status,
    customer_reconciliation_notes,
    billing_hold_reason,
    pol,
    pod,
    place_of_delivery,
    place_of_receipt,
    movement_from,
    movement_to,
    issue_place,
    cargo_description,
    total_packages,
    packages_unit,
    consignee_phone,
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
    NULLIF(bl->>'consignee_block', ''),
    NULLIF(bl->>'shipper_block', ''),
    NULLIF(bl->>'notify_block', ''),
    NULLIF(bl->>'notify2_block', ''),
    NULLIF(bl->>'notify_cnpj_cpf', ''),
    NULLIF(bl->>'customer_id', '')::BIGINT,
    reconciliation.status,
    COALESCE(
      NULLIF(bl->>'customer_reconciliation_notes', ''),
      CASE
        WHEN reconciliation.status = 'matched_document' THEN 'Cliente reconciliado automaticamente por CNPJ/CPF.'
        WHEN reconciliation.status = 'matched_name' THEN 'Cliente sugerido por nome; validar documento.'
        ELSE 'Cliente nao encontrado na base cadastral.'
      END
    ),
    COALESCE(
      NULLIF(bl->>'billing_hold_reason', ''),
      CASE
        WHEN reconciliation.status = 'matched_document' THEN NULL
        ELSE 'Aguardando reconciliacao de cliente antes do faturamento.'
      END
    ),
    NULLIF(bl->>'pol', ''),
    NULLIF(bl->>'pod', ''),
    NULLIF(bl->>'place_of_delivery', ''),
    NULLIF(bl->>'place_of_receipt', ''),
    NULLIF(bl->>'movement_from', ''),
    NULLIF(bl->>'movement_to', ''),
    NULLIF(bl->>'issue_place', ''),
    NULLIF(bl->>'cargo_description', ''),
    NULLIF(bl->>'total_packages', '')::INTEGER,
    NULLIF(bl->>'packages_unit', ''),
    NULLIF(bl->>'consignee_phone', ''),
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
  FROM jsonb_array_elements(p_bls) AS bl
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      NULLIF(bl->>'customer_reconciliation_status', ''),
      CASE
        WHEN NULLIF(bl->>'customer_id', '') IS NOT NULL THEN 'matched_document'
        ELSE 'missing_customer'
      END
    ) AS status
  ) AS reconciliation;

  IF EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import WHERE id IS NULL) THEN
    RAISE EXCEPTION 'B/L sem identificador no payload de frete.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.tmp_bl_freight_import
    WHERE customer_reconciliation_status NOT IN ('matched_document', 'matched_name', 'missing_customer', 'reconciled')
  ) THEN
    RAISE EXCEPTION 'Status de reconciliacao de cliente invalido no payload de frete.'
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

  SELECT COALESCE(array_agg(t.id ORDER BY t.id), ARRAY[]::TEXT[])
  INTO v_weight_locked_bls
  FROM pg_temp.tmp_bl_freight_import AS t
  JOIN public.bls AS b ON b.id = t.id
  WHERE t.billing_locked
    AND NOT t.override_billing
    AND b.cargo_mode = 'carga_solta';

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_billing_hold_bls
  FROM pg_temp.tmp_bl_freight_import
  WHERE billing_locked
    AND NOT override_billing;

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
    consignee_block,
    shipper_block,
    notify_block,
    notify2_block,
    notify_cnpj_cpf,
    customer_id,
    customer_reconciliation_status,
    customer_reconciliation_notes,
    billing_hold_reason,
    pol,
    pod,
    place_of_delivery,
    place_of_receipt,
    movement_from,
    movement_to,
    issue_place,
    cargo_description,
    total_packages,
    packages_unit,
    consignee_phone,
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
    consignee_block,
    shipper_block,
    notify_block,
    notify2_block,
    notify_cnpj_cpf,
    customer_id,
    customer_reconciliation_status,
    customer_reconciliation_notes,
    billing_hold_reason,
    pol,
    pod,
    place_of_delivery,
    place_of_receipt,
    movement_from,
    movement_to,
    issue_place,
    cargo_description,
    total_packages,
    packages_unit,
    consignee_phone,
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
    consignee_block = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'consignee_block') THEN EXCLUDED.consignee_block ELSE bls.consignee_block END,
    shipper_block = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'shipper_block') THEN EXCLUDED.shipper_block ELSE bls.shipper_block END,
    notify_block = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notify_block') THEN EXCLUDED.notify_block ELSE bls.notify_block END,
    notify2_block = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notify2_block') THEN EXCLUDED.notify2_block ELSE bls.notify2_block END,
    notify_cnpj_cpf = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notify_cnpj_cpf') THEN EXCLUDED.notify_cnpj_cpf ELSE bls.notify_cnpj_cpf END,
    customer_id = CASE
      WHEN bls.customer_id IS NULL
        AND EXCLUDED.customer_id IS NOT NULL
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.customer_id
      ELSE bls.customer_id
    END,
    customer_reconciliation_status = CASE
      WHEN bls.customer_id IS NULL
        AND EXCLUDED.customer_id IS NOT NULL
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.customer_reconciliation_status
      WHEN bls.customer_id = EXCLUDED.customer_id
        AND EXCLUDED.customer_id IS NOT NULL
        AND COALESCE(bls.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
        AND EXCLUDED.customer_reconciliation_status IN ('matched_document', 'matched_name')
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.customer_reconciliation_status
      WHEN COALESCE(bls.customer_reconciliation_status, '') = ''
        AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'customer_reconciliation_status')
        THEN EXCLUDED.customer_reconciliation_status
      ELSE bls.customer_reconciliation_status
    END,
    customer_reconciliation_notes = CASE
      WHEN bls.customer_id IS NULL
        AND EXCLUDED.customer_id IS NOT NULL
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.customer_reconciliation_notes
      WHEN bls.customer_id = EXCLUDED.customer_id
        AND EXCLUDED.customer_id IS NOT NULL
        AND COALESCE(bls.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
        AND EXCLUDED.customer_reconciliation_status IN ('matched_document', 'matched_name')
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.customer_reconciliation_notes
      WHEN COALESCE(bls.customer_reconciliation_notes, '') = ''
        AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'customer_reconciliation_notes')
        THEN EXCLUDED.customer_reconciliation_notes
      ELSE bls.customer_reconciliation_notes
    END,
    billing_hold_reason = CASE
      WHEN bls.customer_id IS NULL
        AND EXCLUDED.customer_id IS NOT NULL
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.billing_hold_reason
      WHEN bls.customer_id = EXCLUDED.customer_id
        AND EXCLUDED.customer_id IS NOT NULL
        AND COALESCE(bls.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
        AND EXCLUDED.customer_reconciliation_status IN ('matched_document', 'matched_name')
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.billing_hold_reason
      WHEN COALESCE(bls.billing_hold_reason, '') = ''
        AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'billing_hold_reason')
        THEN EXCLUDED.billing_hold_reason
      ELSE bls.billing_hold_reason
    END,
    pol = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'pol') THEN EXCLUDED.pol ELSE bls.pol END,
    pod = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'pod') THEN EXCLUDED.pod ELSE bls.pod END,
    place_of_delivery = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'place_of_delivery') THEN EXCLUDED.place_of_delivery ELSE bls.place_of_delivery END,
    place_of_receipt = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'place_of_receipt') THEN EXCLUDED.place_of_receipt ELSE bls.place_of_receipt END,
    movement_from = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'movement_from') THEN EXCLUDED.movement_from ELSE bls.movement_from END,
    movement_to = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'movement_to') THEN EXCLUDED.movement_to ELSE bls.movement_to END,
    issue_place = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'issue_place') THEN EXCLUDED.issue_place ELSE bls.issue_place END,
    cargo_description = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'cargo_description') THEN EXCLUDED.cargo_description ELSE bls.cargo_description END,
    total_packages = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'total_packages') THEN EXCLUDED.total_packages ELSE bls.total_packages END,
    packages_unit = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'packages_unit') THEN EXCLUDED.packages_unit ELSE bls.packages_unit END,
    consignee_phone = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'consignee_phone') THEN EXCLUDED.consignee_phone ELSE bls.consignee_phone END,
    total_weight_kg = CASE WHEN EXCLUDED.id <> ALL(v_weight_locked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'total_weight_kg') THEN EXCLUDED.total_weight_kg ELSE bls.total_weight_kg END,
    total_cbm = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'total_cbm') THEN EXCLUDED.total_cbm ELSE bls.total_cbm END,
    incoterm = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'incoterm') THEN EXCLUDED.incoterm ELSE bls.incoterm END,
    payment_type = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'payment_type') THEN EXCLUDED.payment_type ELSE bls.payment_type END,
    bl_emission_date = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'bl_emission_date') THEN EXCLUDED.bl_emission_date ELSE bls.bl_emission_date END,
    manifest_customer_cnpj_cpf = CASE WHEN EXCLUDED.id <> ALL(v_billing_hold_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'manifest_customer_cnpj_cpf') THEN EXCLUDED.manifest_customer_cnpj_cpf ELSE bls.manifest_customer_cnpj_cpf END,
    manifest_customer_name = CASE WHEN EXCLUDED.id <> ALL(v_billing_hold_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'manifest_customer_name') THEN EXCLUDED.manifest_customer_name ELSE bls.manifest_customer_name END,
    manifest_customer_email = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'manifest_customer_email') THEN EXCLUDED.manifest_customer_email ELSE bls.manifest_customer_email END,
    notes = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notes') THEN EXCLUDED.notes ELSE bls.notes END,
    updated_at = now();

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_imported_bl_ids
  FROM pg_temp.tmp_bl_freight_import;

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

  PERFORM public.apply_bl_review_gate_after_import(v_imported_bl_ids, p_changed_by);

  UPDATE public.bls AS b
  SET
    review_status = 'pending_review',
    billing_hold_reason = COALESCE(NULLIF(b.billing_hold_reason, ''), 'Aguardando reconciliacao de cliente antes do faturamento.'),
    notes = CASE
      WHEN COALESCE(b.notes, '') ILIKE '%Cliente vinculado por nome; validar CNPJ%' THEN b.notes
      WHEN COALESCE(b.notes, '') ILIKE '%Pendencias de importacao:%'
        THEN b.notes || ', Cliente vinculado por nome; validar CNPJ'
      ELSE CONCAT_WS(E'\n', NULLIF(BTRIM(COALESCE(b.notes, '')), ''), 'Pendencias de importacao: Cliente vinculado por nome; validar CNPJ')
    END
  WHERE b.id = ANY(v_imported_bl_ids)
    AND b.customer_reconciliation_status = 'matched_name'
    AND COALESCE(b.financial_status, 'pending') <> 'invoiced';

  FOREACH v_bl_id IN ARRAY v_imported_bl_ids LOOP
    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl_id);
  END LOOP;

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
