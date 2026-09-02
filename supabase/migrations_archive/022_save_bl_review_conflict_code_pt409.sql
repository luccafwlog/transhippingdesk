-- 022_save_bl_review_conflict_code_pt409.sql
-- Use PT409 for optimistic-lock conflicts to avoid PostgREST retry loop on 40001.

CREATE OR REPLACE FUNCTION public.save_bl_review(
  p_bl_id TEXT,
  p_expected_updated_at TIMESTAMPTZ,
  p_update_payload JSONB,
  p_audit_rows JSONB,
  p_changed_by UUID
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_new_updated_at TIMESTAMPTZ;
  v_current_updated_at TIMESTAMPTZ;
  v_rowcount INT;
BEGIN
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

  UPDATE public.bls AS b
  SET
    shipper            = CASE WHEN p_update_payload ? 'shipper' THEN p_update_payload->>'shipper' ELSE b.shipper END,
    consignee          = CASE WHEN p_update_payload ? 'consignee' THEN p_update_payload->>'consignee' ELSE b.consignee END,
    notify_party       = CASE WHEN p_update_payload ? 'notify_party' THEN p_update_payload->>'notify_party' ELSE b.notify_party END,
    ce_mercante        = CASE WHEN p_update_payload ? 'ce_mercante' THEN p_update_payload->>'ce_mercante' ELSE b.ce_mercante END,
    pol                = CASE WHEN p_update_payload ? 'pol' THEN p_update_payload->>'pol' ELSE b.pol END,
    pod                = CASE WHEN p_update_payload ? 'pod' THEN p_update_payload->>'pod' ELSE b.pod END,
    place_of_delivery  = CASE WHEN p_update_payload ? 'place_of_delivery' THEN p_update_payload->>'place_of_delivery' ELSE b.place_of_delivery END,
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
    review_status      = CASE WHEN p_update_payload ? 'review_status' THEN p_update_payload->>'review_status' ELSE b.review_status END,
    customer_id        = CASE WHEN p_update_payload ? 'customer_id' THEN NULLIF(p_update_payload->>'customer_id', '')::BIGINT ELSE b.customer_id END
  WHERE b.id = p_bl_id
    AND (p_expected_updated_at IS NULL OR b.updated_at = p_expected_updated_at)
  RETURNING b.updated_at INTO v_new_updated_at;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount = 0 THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuario; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;

  IF p_audit_rows IS NOT NULL
     AND jsonb_typeof(p_audit_rows) = 'array'
     AND jsonb_array_length(p_audit_rows) > 0 THEN
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
      a->>'justification'
    FROM jsonb_array_elements(p_audit_rows) AS a;
  END IF;

  RETURN v_new_updated_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_bl_review(TEXT, TIMESTAMPTZ, JSONB, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_bl_review(TEXT, TIMESTAMPTZ, JSONB, JSONB, UUID) TO authenticated;
