-- Importação de veículos: preserva o local de desova opcional informado na planilha.
CREATE OR REPLACE FUNCTION public.import_vehicle_rows_transactional(p_rows JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count INTEGER := COALESCE(jsonb_array_length(p_rows), 0);
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_active_user() OR public.is_equipamentos_user()) THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para importar veiculos.' USING ERRCODE = '42501';
  END IF;
  IF v_count = 0 THEN RETURN 0; END IF;
  INSERT INTO public.vehicles (voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm)
  SELECT row.voyage_id, row.container_id, row.bl_id, row.chassis, row.brand, row.model, row.weight_kg, row.cbm
  FROM jsonb_to_recordset(p_rows) AS row(voyage_id BIGINT, container_id BIGINT, bl_id TEXT, chassis TEXT, brand TEXT, model TEXT, weight_kg NUMERIC, cbm NUMERIC);
  UPDATE public.bl_containers AS c
  SET unpacking_location = NULLIF(trim(row.unpacking_location), '')
  FROM jsonb_to_recordset(p_rows) AS row(container_id BIGINT, unpacking_location TEXT)
  WHERE c.id = row.container_id AND row.unpacking_location IS NOT NULL;
  RETURN v_count;
END;
$$;
