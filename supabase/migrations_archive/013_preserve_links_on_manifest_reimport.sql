-- Corrige regressao introduzida pelo hardening anterior:
-- reimport de manifesto nao pode apagar veiculos/charge_calculations ao
-- substituir bl_containers.
--
-- Estrategia:
-- 1. voltar o FK vehicles.container_id para RESTRICT;
-- 2. redefinir a RPC import_manifest_transactional para:
--    - capturar containers antigos afetados;
--    - inserir os novos containers primeiro;
--    - rebindar vehicles/charge_calculations pelos novos container_ids;
--    - remover os containers antigos apenas depois do rebind.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.vehicles'::regclass
      AND conname = 'vehicles_container_id_fkey'
  ) THEN
    ALTER TABLE public.vehicles DROP CONSTRAINT vehicles_container_id_fkey;
  END IF;
END $$;

ALTER TABLE public.vehicles
  ADD CONSTRAINT vehicles_container_id_fkey
  FOREIGN KEY (container_id) REFERENCES public.bl_containers(id) ON DELETE RESTRICT;

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
  v_missing_container_refs INT;
  v_ambiguous_container_refs INT;
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

  RETURN v_batch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.import_manifest_transactional(
  TEXT, BIGINT, UUID, TEXT, TEXT, INT, INT, JSONB, JSONB, JSONB
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_manifest_transactional(
  TEXT, BIGINT, UUID, TEXT, TEXT, INT, INT, JSONB, JSONB, JSONB
) TO authenticated;
