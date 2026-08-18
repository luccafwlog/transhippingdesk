-- Preserva CE Mercante já emitido quando uma reimportação BB não traz CE.
-- Rollback: reaplicar a definição da migration 144, substituindo o CASE por
-- NULLIF(source.row->>'ce_mercante', '') no UPDATE de public.bls.
CREATE OR REPLACE FUNCTION public.import_breakbulk_manifest_transactional(
  p_filename TEXT,
  p_voyage_id BIGINT,
  p_uploaded_by UUID,
  p_total_bls INTEGER,
  p_bls JSONB,
  p_items JSONB,
  p_errors JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_batch_id BIGINT;
  v_bl_ids TEXT[];
BEGIN
  v_batch_id := public.import_manifest_transactional(
    p_filename,
    p_voyage_id,
    p_uploaded_by,
    'carga_solta',
    NULL,
    p_total_bls,
    0,
    COALESCE(p_bls, '[]'::jsonb),
    '[]'::jsonb,
    COALESCE(p_errors, '[]'::jsonb)
  );

  UPDATE public.bls AS target
  SET
    ce_mercante = CASE
      WHEN source.row ? 'ce_mercante' THEN NULLIF(source.row->>'ce_mercante', '')
      ELSE target.ce_mercante
    END,
    notify_party = NULLIF(source.row->>'notify_party', ''),
    bb_machine_qty = NULLIF(source.row->>'bb_machine_qty', '')::NUMERIC,
    bb_packages_qty = NULLIF(source.row->>'bb_packages_qty', '')::NUMERIC,
    bb_packages_total = NULLIF(source.row->>'bb_packages_total', '')::NUMERIC,
    bb_weight_ton = NULLIF(source.row->>'bb_weight_ton', '')::NUMERIC
  FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS source(row)
  WHERE target.id = source.row->>'id';

  SELECT COALESCE(array_agg(source.row->>'id'), ARRAY[]::TEXT[])
  INTO v_bl_ids
  FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS source(row);

  IF cardinality(v_bl_ids) > 0 THEN
    DELETE FROM public.bl_breakbulk_items
    WHERE bl_id = ANY(v_bl_ids);
  END IF;

  INSERT INTO public.bl_breakbulk_items (
    bl_id,
    item_description,
    package_qty,
    package_unit,
    gross_weight_kg,
    cbm,
    marks
  )
  SELECT
    source.row->>'bl_id',
    source.row->>'item_description',
    COALESCE(NULLIF(source.row->>'package_qty', '')::NUMERIC, 0),
    NULLIF(source.row->>'package_unit', ''),
    COALESCE(NULLIF(source.row->>'gross_weight_kg', '')::NUMERIC, 0),
    COALESCE(NULLIF(source.row->>'cbm', '')::NUMERIC, 0),
    NULLIF(source.row->>'marks', '')
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS source(row);

  IF cardinality(v_bl_ids) > 0 THEN
    PERFORM public.apply_bl_review_gate_after_import(v_bl_ids, p_uploaded_by);
  END IF;

  RETURN jsonb_build_object('batch_id', v_batch_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.import_breakbulk_manifest_transactional(
  TEXT, BIGINT, UUID, INTEGER, JSONB, JSONB, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_breakbulk_manifest_transactional(
  TEXT, BIGINT, UUID, INTEGER, JSONB, JSONB, JSONB
) TO authenticated;
