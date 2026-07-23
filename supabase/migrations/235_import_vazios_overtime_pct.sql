-- Importação VAZIOS EXP: persiste o percentual único de overtime por container.

DROP FUNCTION IF EXISTS public.import_vazios_bookings_transactional(BIGINT, TEXT, UUID, JSONB);

CREATE OR REPLACE FUNCTION public.import_vazios_bookings_transactional(
  p_voyage_id BIGINT, p_port TEXT, p_uploaded_by UUID, p_bookings JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_manifest_id UUID;
  v_total INTEGER := jsonb_array_length(COALESCE(p_bookings, '[]'::JSONB));
  v_inserted INTEGER := 0;
  v_updated INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_active_user() OR public.is_equipamentos_user())
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar bookings.' USING ERRCODE = '42501';
  END IF;
  IF p_port IS NULL OR btrim(p_port) = '' THEN
    RAISE EXCEPTION 'Porto de embarque obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.vazios_manifests (voyage_id, description, total_bookings, imported_by)
  VALUES (p_voyage_id, p_port, v_total, p_uploaded_by)
  RETURNING id INTO v_manifest_id;

  WITH incoming AS (
    SELECT item.*, depot.id AS resolved_depot_id
    FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS item(
      booking_number TEXT, container_number TEXT, container_type TEXT, movement_date DATE,
      origin_terminal TEXT, destination TEXT, notes TEXT, embark_port TEXT, depot TEXT,
      material BOOLEAN, hand_in_date DATE, hand_out_date DATE, os_number TEXT,
      condition TEXT, overtime_pct NUMERIC
    )
    LEFT JOIN public.depots depot
      ON lower(depot.code) = lower(item.depot) AND depot.active
  ), upserted AS (
    INSERT INTO public.vazios_bookings (
      voyage_id, manifest_id, booking_number, container_number, container_type, movement_date,
      origin_terminal, destination, notes, embark_port, depot, depot_id, material,
      hand_in_date, hand_out_date, os_number, condition, overtime_pct
    )
    SELECT p_voyage_id, v_manifest_id, booking_number, container_number, container_type, movement_date,
      origin_terminal, destination, notes, COALESCE(embark_port, p_port), depot, resolved_depot_id,
      COALESCE(material, condition = 'material', FALSE), hand_in_date, hand_out_date, os_number,
      COALESCE(condition, CASE WHEN material THEN 'material' ELSE 'empty' END), COALESCE(overtime_pct, 0)
    FROM incoming
    ON CONFLICT (voyage_id, container_number) DO UPDATE SET
      manifest_id = EXCLUDED.manifest_id, booking_number = EXCLUDED.booking_number,
      container_type = EXCLUDED.container_type, movement_date = EXCLUDED.movement_date,
      origin_terminal = EXCLUDED.origin_terminal, destination = EXCLUDED.destination,
      notes = EXCLUDED.notes, embark_port = EXCLUDED.embark_port, depot = EXCLUDED.depot,
      depot_id = EXCLUDED.depot_id, material = EXCLUDED.material, hand_in_date = EXCLUDED.hand_in_date,
      hand_out_date = EXCLUDED.hand_out_date, os_number = EXCLUDED.os_number,
      condition = EXCLUDED.condition, overtime_pct = EXCLUDED.overtime_pct
    RETURNING (xmax = 0) AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
    INTO v_inserted, v_updated FROM upserted;

  RETURN jsonb_build_object('manifest_id', v_manifest_id, 'total', v_total,
    'inserted', v_inserted, 'updated', v_updated);
END;
$function$;

REVOKE ALL ON FUNCTION public.import_vazios_bookings_transactional(BIGINT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_vazios_bookings_transactional(BIGINT, TEXT, UUID, JSONB) TO authenticated;
