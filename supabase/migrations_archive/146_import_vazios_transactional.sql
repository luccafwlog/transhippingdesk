-- Renumbered from 20260623111000 (original timestamped migration: 20260623111000_import_vazios_transactional.sql).
CREATE OR REPLACE FUNCTION public.import_vazios_bookings_transactional(
  p_voyage_id BIGINT,
  p_description TEXT,
  p_uploaded_by UUID,
  p_bookings JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_manifest_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar bookings.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.vazios_manifests (voyage_id, description, total_bookings, imported_by)
  VALUES (p_voyage_id, p_description, jsonb_array_length(COALESCE(p_bookings, '[]'::JSONB)), p_uploaded_by)
  RETURNING id INTO v_manifest_id;

  INSERT INTO public.vazios_bookings (
    manifest_id, booking_number, container_number, container_type,
    movement_date, origin_terminal, destination, notes
  )
  SELECT
    v_manifest_id, item.booking_number, item.container_number, item.container_type,
    item.movement_date, item.origin_terminal, item.destination, item.notes
  FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS item(
    booking_number TEXT,
    container_number TEXT,
    container_type TEXT,
    movement_date DATE,
    origin_terminal TEXT,
    destination TEXT,
    notes TEXT
  );

  RETURN jsonb_build_object('manifest_id', v_manifest_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_vazios_importacao_transactional(
  p_voyage_id BIGINT,
  p_description TEXT,
  p_uploaded_by UUID,
  p_containers JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_manifest_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar vazios.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.vazios_importacao_manifests (
    voyage_id, description, total_containers, imported_by, source
  )
  VALUES (
    p_voyage_id, p_description,
    jsonb_array_length(COALESCE(p_containers, '[]'::JSONB)),
    p_uploaded_by, 'manual'
  )
  RETURNING id INTO v_manifest_id;

  INSERT INTO public.vazios_importacao_containers (
    manifest_id, container_number, container_type, tare_kg
  )
  SELECT v_manifest_id, item.container_number, item.container_type, item.tare_kg
  FROM jsonb_to_recordset(COALESCE(p_containers, '[]'::JSONB)) AS item(
    container_number TEXT,
    container_type TEXT,
    tare_kg NUMERIC
  );

  RETURN jsonb_build_object('manifest_id', v_manifest_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.replace_vazios_from_baplie_transactional(
  p_voyage_id BIGINT,
  p_description TEXT,
  p_uploaded_by UUID,
  p_replace_existing BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_manifest_id UUID;
  v_total INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar vazios Baplie.' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::INTEGER
  INTO v_total
  FROM public.baplie_containers
  WHERE voyage_id = p_voyage_id AND status = 'empty';

  IF v_total = 0 THEN
    RAISE EXCEPTION 'Nenhum container vazio encontrado no Baplie desta viagem.'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_replace_existing THEN
    DELETE FROM public.vazios_importacao_manifests
    WHERE voyage_id = p_voyage_id AND source = 'baplie';
  ELSIF EXISTS (
    SELECT 1 FROM public.vazios_importacao_manifests
    WHERE voyage_id = p_voyage_id AND source = 'baplie'
  ) THEN
    RAISE EXCEPTION 'Ja existe manifesto Baplie para esta viagem.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.vazios_importacao_manifests (
    voyage_id, description, total_containers, imported_by, source
  )
  VALUES (
    p_voyage_id, COALESCE(p_description, 'Importado via Baplie EDI'),
    v_total, p_uploaded_by, 'baplie'
  )
  RETURNING id INTO v_manifest_id;

  INSERT INTO public.vazios_importacao_containers (
    manifest_id, container_number, container_type, tare_kg, pod
  )
  SELECT v_manifest_id, container_number, size_type, weight_kg, pod
  FROM public.baplie_containers
  WHERE voyage_id = p_voyage_id AND status = 'empty';

  RETURN jsonb_build_object('manifest_id', v_manifest_id, 'total', v_total);
END;
$function$;

REVOKE ALL ON FUNCTION public.import_vazios_bookings_transactional(BIGINT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_vazios_importacao_transactional(BIGINT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.replace_vazios_from_baplie_transactional(BIGINT, TEXT, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_vazios_bookings_transactional(BIGINT, TEXT, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_vazios_importacao_transactional(BIGINT, TEXT, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_vazios_from_baplie_transactional(BIGINT, TEXT, UUID, BOOLEAN) TO authenticated;
