-- 165_manifest_overwrite_opt_in.sql
-- #320 (mapa wayfinder #304): o import de manifesto NAO sobrescreve mais em
-- silencio os campos comerciais de B/Ls ja existentes. Por padrao MANTEM o B/L
-- (fonte co-primaria, ADR 0017). So sobrescreve quando o operador aprova
-- (p_apply_overwrites=true), gravando auditoria FONTE_SOBRESCRITO. Campos
-- condicionais: shipper, consignee, cargo_description, pol, pod,
-- total_weight_kg, total_cbm. Demais campos (orquestracao/reconciliacao)
-- mantem o comportamento atual.

DROP FUNCTION IF EXISTS public.import_manifest_with_postprocess_transactional(text,bigint,uuid,text,text,integer,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb);
DROP FUNCTION IF EXISTS public.import_manifest_transactional(text,bigint,uuid,text,text,integer,integer,jsonb,jsonb,jsonb);

CREATE OR REPLACE FUNCTION public.import_manifest_transactional(p_filename text, p_voyage_id bigint, p_uploaded_by uuid, p_cargo_mode text, p_file_hash text, p_total_bls integer, p_total_containers integer, p_bls jsonb, p_containers jsonb, p_errors jsonb, p_apply_overwrites boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_batch_id BIGINT;
  v_bl_ids TEXT[];
  v_error_count INT;
  v_missing_container_refs INT;
  v_ambiguous_container_refs INT;
  v_recent_imports INT;
  v_existing_bl_ids TEXT[];
BEGIN
  SELECT COUNT(*) INTO v_recent_imports
  FROM public.import_batches
  WHERE uploaded_by = p_uploaded_by
    AND created_at > NOW() - INTERVAL '60 seconds';

  IF COALESCE(v_recent_imports, 0) >= 5 THEN
    RAISE EXCEPTION 'Limite de importacoes atingido. Aguarde 60 segundos antes de importar novamente.'
      USING ERRCODE = 'P0429';
  END IF;

  IF p_voyage_id IS NULL THEN
    RAISE EXCEPTION 'voyage_id obrigatorio' USING ERRCODE = '22004';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem % nao encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;

  v_error_count := COALESCE(jsonb_array_length(p_errors), 0);

  INSERT INTO public.import_batches(
    filename, voyage_id, cargo_mode, uploaded_by, status,
    total_bls, total_containers, error_count, file_hash
  )
  VALUES (
    p_filename,
    p_voyage_id,
    COALESCE(p_cargo_mode, 'container'),
    p_uploaded_by,
    'processing',
    p_total_bls,
    p_total_containers,
    v_error_count,
    p_file_hash
  )
  RETURNING id INTO v_batch_id;

  CREATE TEMP TABLE pg_temp.tmp_old_containers (
    old_container_id BIGINT PRIMARY KEY,
    bl_id TEXT NOT NULL,
    container_number TEXT NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE pg_temp.tmp_new_containers (
    new_container_id BIGINT PRIMARY KEY,
    bl_id TEXT NOT NULL,
    container_number TEXT NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE pg_temp.tmp_container_rebind (
    old_container_id BIGINT PRIMARY KEY,
    new_container_id BIGINT NOT NULL
  ) ON COMMIT DROP;

  IF p_bls IS NOT NULL AND jsonb_array_length(p_bls) > 0 THEN
    SELECT array_agg(b.id) INTO v_existing_bl_ids FROM public.bls b
      WHERE b.id IN (SELECT x->>'id' FROM jsonb_array_elements(p_bls) x);

    INSERT INTO public.bls (
      id,
      voyage_id,
      batch_id,
      cargo_mode,
      shipper,
      consignee,
      cargo_description,
      customer_id,
      pol,
      pod,
      total_weight_kg,
      total_cbm,
      review_status,
      financial_status,
      notes,
      manifest_customer_cnpj_cpf,
      manifest_customer_name,
      manifest_customer_email,
      customer_reconciliation_status,
      customer_reconciliation_notes,
      billing_hold_reason
    )
    SELECT
      bl->>'id',
      p_voyage_id,
      v_batch_id,
      COALESCE(p_cargo_mode, 'container'),
      bl->>'shipper',
      bl->>'consignee',
      bl->>'cargo_description',
      NULLIF(bl->>'customer_id', '')::BIGINT,
      bl->>'pol',
      bl->>'pod',
      NULLIF(bl->>'total_weight_kg', '')::NUMERIC,
      NULLIF(bl->>'total_cbm', '')::NUMERIC,
      COALESCE(bl->>'review_status', 'ok'),
      COALESCE(bl->>'financial_status', 'pending'),
      bl->>'notes',
      public.normalize_document_text(bl->>'manifest_customer_cnpj_cpf'),
      COALESCE(NULLIF(bl->>'manifest_customer_name', ''), bl->>'consignee'),
      NULLIF(bl->>'manifest_customer_email', ''),
      COALESCE(
        NULLIF(bl->>'customer_reconciliation_status', ''),
        CASE
          WHEN NULLIF(bl->>'customer_id', '') IS NOT NULL THEN 'reconciled'
          ELSE 'missing_customer'
        END
      ),
      NULLIF(bl->>'customer_reconciliation_notes', ''),
      NULLIF(bl->>'billing_hold_reason', '')
    FROM jsonb_array_elements(p_bls) AS bl
    ON CONFLICT (id) DO UPDATE SET
      voyage_id = EXCLUDED.voyage_id,
      batch_id = EXCLUDED.batch_id,
      cargo_mode = EXCLUDED.cargo_mode,
      shipper = CASE WHEN p_apply_overwrites THEN EXCLUDED.shipper ELSE public.bls.shipper END,
      consignee = CASE WHEN p_apply_overwrites THEN EXCLUDED.consignee ELSE public.bls.consignee END,
      cargo_description = CASE WHEN p_apply_overwrites THEN EXCLUDED.cargo_description ELSE public.bls.cargo_description END,
      customer_id = EXCLUDED.customer_id,
      pol = CASE WHEN p_apply_overwrites THEN EXCLUDED.pol ELSE public.bls.pol END,
      pod = CASE WHEN p_apply_overwrites THEN EXCLUDED.pod ELSE public.bls.pod END,
      total_weight_kg = CASE WHEN p_apply_overwrites THEN EXCLUDED.total_weight_kg ELSE public.bls.total_weight_kg END,
      total_cbm = CASE WHEN p_apply_overwrites THEN EXCLUDED.total_cbm ELSE public.bls.total_cbm END,
      review_status = EXCLUDED.review_status,
      financial_status = EXCLUDED.financial_status,
      notes = EXCLUDED.notes,
      manifest_customer_cnpj_cpf = EXCLUDED.manifest_customer_cnpj_cpf,
      manifest_customer_name = EXCLUDED.manifest_customer_name,
      manifest_customer_email = EXCLUDED.manifest_customer_email,
      customer_reconciliation_status = EXCLUDED.customer_reconciliation_status,
      customer_reconciliation_notes = EXCLUDED.customer_reconciliation_notes,
      billing_hold_reason = EXCLUDED.billing_hold_reason;

    IF p_apply_overwrites AND v_existing_bl_ids IS NOT NULL AND array_length(v_existing_bl_ids, 1) > 0 THEN
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
      SELECT 'bl', bid, 'FONTE_SOBRESCRITO', NULL, NULL, p_uploaded_by, now(),
             'Manifesto sobrescreveu dados comerciais do B/L com aprovacao do operador'
      FROM unnest(v_existing_bl_ids) AS bid;
    END IF;

    SELECT array_agg(DISTINCT bl->>'id')
    INTO v_bl_ids
    FROM jsonb_array_elements(p_bls) AS bl;

    IF v_bl_ids IS NOT NULL AND array_length(v_bl_ids, 1) > 0 THEN
      INSERT INTO pg_temp.tmp_old_containers (old_container_id, bl_id, container_number)
      SELECT id, bl_id, container_number
      FROM public.bl_containers
      WHERE bl_id = ANY(v_bl_ids);

      PERFORM 1
      FROM public.vehicles
      WHERE container_id IN (SELECT old_container_id FROM pg_temp.tmp_old_containers)
      FOR UPDATE;

      PERFORM 1
      FROM public.charge_calculations
      WHERE container_id IN (SELECT old_container_id FROM pg_temp.tmp_old_containers)
      FOR UPDATE;
    END IF;
  END IF;

  IF p_containers IS NOT NULL AND jsonb_array_length(p_containers) > 0 THEN
    WITH inserted AS (
      INSERT INTO public.bl_containers (
        bl_id, container_number, seal_number, type, tare_weight_kg,
        gross_weight_kg, cbm, is_oog, is_imo, imo_class, un_number
      )
      SELECT
        c->>'bl_id',
        c->>'container_number',
        c->>'seal_number',
        c->>'type',
        NULLIF(c->>'tare_weight_kg', '')::NUMERIC,
        NULLIF(c->>'gross_weight_kg', '')::NUMERIC,
        NULLIF(c->>'cbm', '')::NUMERIC,
        COALESCE((c->>'is_oog')::BOOLEAN, false),
        COALESCE((c->>'is_imo')::BOOLEAN, false),
        c->>'imo_class',
        c->>'un_number'
      FROM jsonb_array_elements(p_containers) AS c
      RETURNING id, bl_id, container_number
    )
    INSERT INTO pg_temp.tmp_new_containers (new_container_id, bl_id, container_number)
    SELECT id, bl_id, container_number
    FROM inserted;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_temp.tmp_old_containers) THEN
    INSERT INTO pg_temp.tmp_container_rebind (old_container_id, new_container_id)
    SELECT old_ref.old_container_id, MIN(matched.new_container_id) AS new_container_id
    FROM pg_temp.tmp_old_containers AS old_ref
    JOIN LATERAL (
      SELECT new_ref.new_container_id
      FROM pg_temp.tmp_new_containers AS new_ref
      WHERE new_ref.bl_id = old_ref.bl_id
        AND new_ref.container_number = old_ref.container_number
    ) AS matched ON TRUE
    GROUP BY old_ref.old_container_id
    HAVING COUNT(*) = 1;

    SELECT COUNT(*)
    INTO v_missing_container_refs
    FROM (
      SELECT old_ref.old_container_id
      FROM pg_temp.tmp_old_containers AS old_ref
      WHERE EXISTS (
        SELECT 1
        FROM public.vehicles AS v
        WHERE v.container_id = old_ref.old_container_id
      )
         OR EXISTS (
        SELECT 1
        FROM public.charge_calculations AS cc
        WHERE cc.container_id = old_ref.old_container_id
      )
      EXCEPT
      SELECT old_container_id
      FROM pg_temp.tmp_container_rebind
    ) AS missing_refs;

    IF COALESCE(v_missing_container_refs, 0) > 0 THEN
      RAISE EXCEPTION
        'Reimport abortado: % vinculo(s) de container referenciados por veiculos/calculos nao puderam ser remapeados.',
        v_missing_container_refs
        USING ERRCODE = '23503';
    END IF;

    SELECT COUNT(*)
    INTO v_ambiguous_container_refs
    FROM (
      SELECT old_ref.old_container_id
      FROM pg_temp.tmp_old_containers AS old_ref
      JOIN pg_temp.tmp_new_containers AS new_ref
        ON new_ref.bl_id = old_ref.bl_id
       AND new_ref.container_number = old_ref.container_number
      WHERE EXISTS (
        SELECT 1
        FROM public.vehicles AS v
        WHERE v.container_id = old_ref.old_container_id
      )
         OR EXISTS (
        SELECT 1
        FROM public.charge_calculations AS cc
        WHERE cc.container_id = old_ref.old_container_id
      )
      GROUP BY old_ref.old_container_id
      HAVING COUNT(*) > 1
    ) AS ambiguous_refs;

    IF COALESCE(v_ambiguous_container_refs, 0) > 0 THEN
      RAISE EXCEPTION
        'Reimport abortado: % container(s) remapeados de forma ambigua por numero dentro do mesmo B/L.',
        v_ambiguous_container_refs
        USING ERRCODE = '23505';
    END IF;

    UPDATE public.vehicles AS v
    SET container_id = rebind.new_container_id
    FROM pg_temp.tmp_container_rebind AS rebind
    WHERE v.container_id = rebind.old_container_id;

    UPDATE public.charge_calculations AS cc
    SET container_id = rebind.new_container_id
    FROM pg_temp.tmp_container_rebind AS rebind
    WHERE cc.container_id = rebind.old_container_id;

    DELETE FROM public.bl_containers
    WHERE id IN (SELECT old_container_id FROM pg_temp.tmp_old_containers);
  END IF;

  IF v_error_count > 0 THEN
    INSERT INTO public.import_errors(batch_id, row_number, error_type, error_message, raw_data)
    SELECT
      v_batch_id,
      NULLIF(e->>'row_number', '')::INT,
      COALESCE(e->>'error_type', 'parser'),
      e->>'error_message',
      CASE WHEN e ? 'raw_data' THEN e->'raw_data' ELSE NULL END
    FROM jsonb_array_elements(p_errors) AS e;
  END IF;

  UPDATE public.import_batches
  SET status = CASE WHEN v_error_count > 0 THEN 'partial' ELSE 'completed' END
  WHERE id = v_batch_id;

  IF v_bl_ids IS NOT NULL THEN
    UPDATE public.charge_calculations AS cc
    SET manifest_id = v_batch_id
    WHERE cc.bl_id = ANY(v_bl_ids);
  END IF;

  RETURN v_batch_id;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.import_manifest_with_postprocess_transactional(p_filename text, p_voyage_id bigint, p_uploaded_by uuid, p_cargo_mode text, p_file_hash text, p_total_bls integer, p_total_containers integer, p_bls jsonb, p_containers jsonb, p_errors jsonb, p_pol_etd jsonb DEFAULT '[]'::jsonb, p_pod_linked jsonb DEFAULT '[]'::jsonb, p_contact_emails jsonb DEFAULT '[]'::jsonb, p_apply_overwrites boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
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
    p_errors,
    p_apply_overwrites
  );

  -- Persist full positional party blocks captured at parse time (Mercante EDI).
  UPDATE public.bls b SET
    consignee_block = NULLIF(x.consignee_block, ''),
    consignee_address = NULLIF(x.consignee_address, ''),
    consignee_phone = NULLIF(x.consignee_phone, ''),
    shipper_block = NULLIF(x.shipper_block, ''),
    notify_cnpj_cpf = NULLIF(x.notify_cnpj_cpf, ''),
    notify_block = NULLIF(x.notify_block, ''),
    notify2_block = NULLIF(x.notify2_block, ''),
    total_packages = x.total_packages,
    packages_unit = NULLIF(x.packages_unit, '')
  FROM jsonb_to_recordset(p_bls) AS x(
    id TEXT,
    consignee_block TEXT,
    consignee_address TEXT,
    consignee_phone TEXT,
    shipper_block TEXT,
    notify_cnpj_cpf TEXT,
    notify_block TEXT,
    notify2_block TEXT,
    total_packages INTEGER,
    packages_unit TEXT
  )
  WHERE b.id = x.id
    AND b.batch_id = v_batch_id;

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

  RETURN v_batch_id;
END;
$function$

;


REVOKE ALL ON FUNCTION public.import_manifest_transactional(text,bigint,uuid,text,text,integer,integer,jsonb,jsonb,jsonb,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_manifest_transactional(text,bigint,uuid,text,text,integer,integer,jsonb,jsonb,jsonb,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.import_manifest_with_postprocess_transactional(text,bigint,uuid,text,text,integer,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_manifest_with_postprocess_transactional(text,bigint,uuid,text,text,integer,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean) TO authenticated;
