CREATE OR REPLACE FUNCTION public.import_baplie_staging_transactional(
  p_voyage_id BIGINT,
  p_rows JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := COALESCE(jsonb_array_length(p_rows), 0);
BEGIN
  DELETE FROM public.baplie_containers
  WHERE voyage_id = p_voyage_id;

  IF v_count = 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO public.baplie_containers (
    voyage_id,
    container_number,
    size_type,
    status,
    weight_kg,
    pol,
    pod,
    final_dest,
    bl_ref,
    slot,
    is_imo,
    imo_class,
    un_number,
    is_oog,
    imported_by
  )
  SELECT
    p_voyage_id,
    row.container_number,
    row.size_type,
    row.status,
    row.weight_kg,
    row.pol,
    row.pod,
    row.final_dest,
    row.bl_ref,
    row.slot,
    row.is_imo,
    row.imo_class,
    row.un_number,
    row.is_oog,
    row.imported_by
  FROM jsonb_to_recordset(p_rows) AS row(
    container_number TEXT,
    size_type TEXT,
    status TEXT,
    weight_kg NUMERIC,
    pol TEXT,
    pod TEXT,
    final_dest TEXT,
    bl_ref TEXT,
    slot TEXT,
    is_imo BOOLEAN,
    imo_class TEXT,
    un_number TEXT,
    is_oog BOOLEAN,
    imported_by UUID
  );

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.import_vehicle_rows_transactional(
  p_rows JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := COALESCE(jsonb_array_length(p_rows), 0);
BEGIN
  IF v_count = 0 THEN
    RETURN 0;
  END IF;

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
    row.voyage_id,
    row.container_id,
    row.bl_id,
    row.chassis,
    row.brand,
    row.model,
    row.weight_kg,
    row.cbm
  FROM jsonb_to_recordset(p_rows) AS row(
    voyage_id BIGINT,
    container_id BIGINT,
    bl_id TEXT,
    chassis TEXT,
    brand TEXT,
    model TEXT,
    weight_kg NUMERIC,
    cbm NUMERIC
  );

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.import_baplie_staging_transactional(BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_baplie_staging_transactional(BIGINT, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.import_vehicle_rows_transactional(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_vehicle_rows_transactional(JSONB) TO authenticated;
