-- Persist a Granite manifest header and all accepted B/L rows atomically.

CREATE OR REPLACE FUNCTION public.import_granite_manifest_transactional(
  p_voyage_id BIGINT,
  p_vessel_voyage TEXT,
  p_loading_port TEXT,
  p_discharge_port TEXT,
  p_total_bls INTEGER,
  p_total_weight_kg NUMERIC,
  p_uploaded_by UUID,
  p_bls JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_manifest_id UUID;
  v_inserted_bls INTEGER;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para importar manifesto Granito.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.voyages WHERE id = p_voyage_id
  ) THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_vessel_voyage, '')), '') IS NULL
     OR jsonb_typeof(p_bls) <> 'array'
     OR jsonb_array_length(p_bls) = 0
     OR p_total_bls IS DISTINCT FROM jsonb_array_length(p_bls) THEN
    RAISE EXCEPTION 'Manifesto Granito invalido.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.granite_manifests (
    voyage_id,
    vessel_voyage,
    loading_port,
    discharge_port,
    total_bls,
    total_weight_kg,
    imported_by
  )
  VALUES (
    p_voyage_id,
    BTRIM(p_vessel_voyage),
    p_loading_port,
    p_discharge_port,
    p_total_bls,
    p_total_weight_kg,
    p_uploaded_by
  )
  RETURNING id INTO v_manifest_id;

  INSERT INTO public.granite_bls (
    manifest_id,
    client_id,
    sequence,
    booking_number,
    bl_number,
    shipper_ref,
    vessel_voyage,
    loading_port,
    discharge_port,
    shipper_name,
    shipper_cnpj,
    consignee_name,
    charter,
    shipper_m3,
    shipper_weight_kg,
    blocks_qty,
    received_blocks_qty,
    final_m3,
    real_weight_kg,
    stockyard,
    remarks,
    partial_restriction,
    cosco_transport,
    fragile_blocks,
    cssc_selection,
    cargo_readiness_date,
    phase,
    charge_status
  )
  SELECT
    v_manifest_id,
    item.client_id,
    item.sequence,
    item.booking_number,
    item.bl_number,
    item.shipper_ref,
    item.vessel_voyage,
    item.loading_port,
    item.discharge_port,
    item.shipper_name,
    item.shipper_cnpj,
    item.consignee_name,
    item.charter,
    item.shipper_m3,
    item.shipper_weight_kg,
    item.blocks_qty,
    item.received_blocks_qty,
    item.final_m3,
    item.real_weight_kg,
    item.stockyard,
    item.remarks,
    COALESCE(item.partial_restriction, FALSE),
    item.cosco_transport,
    item.fragile_blocks,
    item.cssc_selection,
    item.cargo_readiness_date,
    item.phase,
    'not_calculated'
  FROM jsonb_to_recordset(p_bls) AS item(
    client_id BIGINT,
    sequence INTEGER,
    booking_number TEXT,
    bl_number TEXT,
    shipper_ref TEXT,
    vessel_voyage TEXT,
    loading_port TEXT,
    discharge_port TEXT,
    shipper_name TEXT,
    shipper_cnpj TEXT,
    consignee_name TEXT,
    charter TEXT,
    shipper_m3 NUMERIC,
    shipper_weight_kg NUMERIC,
    blocks_qty INTEGER,
    received_blocks_qty INTEGER,
    final_m3 NUMERIC,
    real_weight_kg NUMERIC,
    stockyard TEXT,
    remarks TEXT,
    partial_restriction BOOLEAN,
    cosco_transport TEXT,
    fragile_blocks INTEGER,
    cssc_selection TEXT,
    cargo_readiness_date DATE,
    phase TEXT,
    charge_status TEXT
  );

  GET DIAGNOSTICS v_inserted_bls = ROW_COUNT;
  IF v_inserted_bls <> p_total_bls THEN
    RAISE EXCEPTION 'Quantidade de B/Ls Granito inserida diverge do manifesto.'
      USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'manifest_id', v_manifest_id,
    'inserted_bls', v_inserted_bls
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_granite_manifest_transactional(
  BIGINT, TEXT, TEXT, TEXT, INTEGER, NUMERIC, UUID, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_granite_manifest_transactional(
  BIGINT, TEXT, TEXT, TEXT, INTEGER, NUMERIC, UUID, JSONB
) TO authenticated;
