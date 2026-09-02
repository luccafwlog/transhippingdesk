-- F-01, F-04, F-05, F-12: Funções transacionais para operações críticas.
--
-- Motivação: o cliente estava orquestrando sequências de DELETE + INSERT
-- sem transação, e fazia updates sem optimistic lock. Essas funções
-- rodam como um bloco único dentro do Postgres — se qualquer instrução
-- falhar, o bloco inteiro é revertido automaticamente.

------------------------------------------------------------------------
-- F-01: Import transacional de manifesto container.
-- Recebe batch + BLs + containers + errors como JSONB.
-- Cria o import_batch, upsert BLs, deleta containers antigos dos BLs
-- afetados, insere novos containers e erros, atualiza status final.
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.import_manifest_transactional(
  p_filename TEXT,
  p_voyage_id BIGINT,
  p_uploaded_by UUID,
  p_cargo_mode TEXT,
  p_file_hash TEXT,
  p_total_bls INT,
  p_total_containers INT,
  p_bls JSONB,
  p_containers JSONB,
  p_errors JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch_id BIGINT;
  v_bl_ids TEXT[];
  v_error_count INT;
BEGIN
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

  IF p_bls IS NOT NULL AND jsonb_array_length(p_bls) > 0 THEN
    INSERT INTO public.bls (
      id, voyage_id, batch_id, cargo_mode, shipper, consignee, cargo_description,
      customer_id, pol, pod, total_weight_kg, total_cbm,
      review_status, financial_status, notes
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
      bl->>'notes'
    FROM jsonb_array_elements(p_bls) AS bl
    ON CONFLICT (id) DO UPDATE SET
      voyage_id         = EXCLUDED.voyage_id,
      batch_id          = EXCLUDED.batch_id,
      cargo_mode        = EXCLUDED.cargo_mode,
      shipper           = EXCLUDED.shipper,
      consignee         = EXCLUDED.consignee,
      cargo_description = EXCLUDED.cargo_description,
      customer_id       = EXCLUDED.customer_id,
      pol               = EXCLUDED.pol,
      pod               = EXCLUDED.pod,
      total_weight_kg   = EXCLUDED.total_weight_kg,
      total_cbm         = EXCLUDED.total_cbm,
      review_status     = EXCLUDED.review_status,
      financial_status  = EXCLUDED.financial_status,
      notes             = EXCLUDED.notes;

    SELECT array_agg(DISTINCT bl->>'id')
      INTO v_bl_ids
      FROM jsonb_array_elements(p_bls) AS bl;

    IF v_bl_ids IS NOT NULL AND array_length(v_bl_ids, 1) > 0 THEN
      DELETE FROM public.bl_containers WHERE bl_id = ANY(v_bl_ids);
    END IF;
  END IF;

  IF p_containers IS NOT NULL AND jsonb_array_length(p_containers) > 0 THEN
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
    FROM jsonb_array_elements(p_containers) AS c;
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

  RETURN v_batch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.import_manifest_transactional(
  TEXT, BIGINT, UUID, TEXT, TEXT, INT, INT, JSONB, JSONB, JSONB
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_manifest_transactional(
  TEXT, BIGINT, UUID, TEXT, TEXT, INT, INT, JSONB, JSONB, JSONB
) TO authenticated;

------------------------------------------------------------------------
-- F-04 + F-05: save_bl_review com optimistic lock + audit transacional.
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_bl_review(
  p_bl_id TEXT,
  p_expected_updated_at TIMESTAMPTZ,
  p_update_payload JSONB,
  p_audit_rows JSONB,
  p_changed_by UUID
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_updated_at TIMESTAMPTZ;
  v_rowcount INT;
BEGIN
  IF p_bl_id IS NULL OR p_bl_id = '' THEN
    RAISE EXCEPTION 'bl_id obrigatorio' USING ERRCODE = '22004';
  END IF;

  UPDATE public.bls AS b
  SET
    shipper           = CASE WHEN p_update_payload ? 'shipper' THEN p_update_payload->>'shipper' ELSE b.shipper END,
    consignee         = CASE WHEN p_update_payload ? 'consignee' THEN p_update_payload->>'consignee' ELSE b.consignee END,
    notify_party      = CASE WHEN p_update_payload ? 'notify_party' THEN p_update_payload->>'notify_party' ELSE b.notify_party END,
    ce_mercante       = CASE WHEN p_update_payload ? 'ce_mercante' THEN p_update_payload->>'ce_mercante' ELSE b.ce_mercante END,
    pol               = CASE WHEN p_update_payload ? 'pol' THEN p_update_payload->>'pol' ELSE b.pol END,
    pod               = CASE WHEN p_update_payload ? 'pod' THEN p_update_payload->>'pod' ELSE b.pod END,
    place_of_delivery = CASE WHEN p_update_payload ? 'place_of_delivery' THEN p_update_payload->>'place_of_delivery' ELSE b.place_of_delivery END,
    cargo_description = CASE WHEN p_update_payload ? 'cargo_description' THEN p_update_payload->>'cargo_description' ELSE b.cargo_description END,
    total_weight_kg   = CASE WHEN p_update_payload ? 'total_weight_kg' THEN NULLIF(p_update_payload->>'total_weight_kg','')::NUMERIC ELSE b.total_weight_kg END,
    total_cbm         = CASE WHEN p_update_payload ? 'total_cbm' THEN NULLIF(p_update_payload->>'total_cbm','')::NUMERIC ELSE b.total_cbm END,
    bb_machine_qty    = CASE WHEN p_update_payload ? 'bb_machine_qty' THEN NULLIF(p_update_payload->>'bb_machine_qty','')::NUMERIC ELSE b.bb_machine_qty END,
    bb_packages_qty   = CASE WHEN p_update_payload ? 'bb_packages_qty' THEN NULLIF(p_update_payload->>'bb_packages_qty','')::NUMERIC ELSE b.bb_packages_qty END,
    bb_packages_total = CASE WHEN p_update_payload ? 'bb_packages_total' THEN NULLIF(p_update_payload->>'bb_packages_total','')::NUMERIC ELSE b.bb_packages_total END,
    bb_weight_ton     = CASE WHEN p_update_payload ? 'bb_weight_ton' THEN NULLIF(p_update_payload->>'bb_weight_ton','')::NUMERIC ELSE b.bb_weight_ton END,
    incoterm          = CASE WHEN p_update_payload ? 'incoterm' THEN p_update_payload->>'incoterm' ELSE b.incoterm END,
    payment_type      = CASE WHEN p_update_payload ? 'payment_type' THEN NULLIF(p_update_payload->>'payment_type','') ELSE b.payment_type END,
    free_time_override = CASE WHEN p_update_payload ? 'free_time_override' THEN NULLIF(p_update_payload->>'free_time_override','')::INT ELSE b.free_time_override END,
    notes             = CASE WHEN p_update_payload ? 'notes' THEN p_update_payload->>'notes' ELSE b.notes END,
    review_status     = CASE WHEN p_update_payload ? 'review_status' THEN p_update_payload->>'review_status' ELSE b.review_status END,
    customer_id       = CASE WHEN p_update_payload ? 'customer_id' THEN NULLIF(p_update_payload->>'customer_id','')::BIGINT ELSE b.customer_id END
  WHERE b.id = p_bl_id
    AND (p_expected_updated_at IS NULL OR b.updated_at = p_expected_updated_at)
  RETURNING b.updated_at INTO v_new_updated_at;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;

  IF v_rowcount = 0 THEN
    IF NOT EXISTS (SELECT 1 FROM public.bls WHERE id = p_bl_id) THEN
      RAISE EXCEPTION 'BL % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
    ELSE
      RAISE EXCEPTION 'BL % foi alterado por outro usuario; recarregue antes de salvar', p_bl_id
        USING ERRCODE = '40001';
    END IF;
  END IF;

  IF p_audit_rows IS NOT NULL AND jsonb_array_length(p_audit_rows) > 0 THEN
    INSERT INTO public.audit_logs(
      entity_type, entity_id, field_name, old_value, new_value, changed_by, justification
    )
    SELECT
      COALESCE(a->>'entity_type', 'bl'),
      COALESCE(a->>'entity_id', p_bl_id),
      a->>'field_name',
      a->>'old_value',
      a->>'new_value',
      p_changed_by,
      a->>'justification'
    FROM jsonb_array_elements(p_audit_rows) AS a;
  END IF;

  RETURN v_new_updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.save_bl_review(TEXT, TIMESTAMPTZ, JSONB, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_bl_review(TEXT, TIMESTAMPTZ, JSONB, JSONB, UUID) TO authenticated;

------------------------------------------------------------------------
-- F-12: apply_ce_mercante_update — atualização individual com audit.
-- Retorna 'unchanged' | 'inserted' | 'overwritten'.
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_ce_mercante_update(
  p_bl_id TEXT,
  p_new_ce TEXT,
  p_changed_by UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_ce TEXT;
  v_exists BOOLEAN;
BEGIN
  SELECT ce_mercante, TRUE INTO v_old_ce, v_exists FROM public.bls WHERE id = p_bl_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BL % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_old_ce, '') = COALESCE(p_new_ce, '') THEN
    RETURN 'unchanged';
  END IF;

  UPDATE public.bls SET ce_mercante = p_new_ce WHERE id = p_bl_id;

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value, changed_by, justification
  ) VALUES (
    'bl', p_bl_id, 'ce_mercante',
    COALESCE(v_old_ce, ''), COALESCE(p_new_ce, ''),
    p_changed_by,
    'Importacao CE Mercante'
  );

  IF v_old_ce IS NOT NULL AND v_old_ce <> '' THEN
    RETURN 'overwritten';
  END IF;
  RETURN 'inserted';
END;
$$;

REVOKE ALL ON FUNCTION public.apply_ce_mercante_update(TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_ce_mercante_update(TEXT, TEXT, UUID) TO authenticated;
