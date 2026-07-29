-- ADR 0033: um container repetido invalida o lote inteiro, sem escolher silenciosamente uma linha.
-- Rollback: restaurar a versao da import_vazios_bookings_transactional da migration 238.

CREATE OR REPLACE FUNCTION public.import_vazios_bookings_transactional(
  p_voyage_id BIGINT, p_port TEXT, p_uploaded_by UUID, p_bookings JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_manifest_id UUID;
  v_operation_id UUID;
  v_total INTEGER := jsonb_array_length(COALESCE(p_bookings, '[]'::JSONB));
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_active_user() OR public.is_equipamentos_user())
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar unidades.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_port), '') IS NULL THEN
    RAISE EXCEPTION 'Porto de embarque obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS item(container_number TEXT)
    GROUP BY upper(btrim(container_number))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Planilha invalida: Container duplicado na planilha.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.vazios_export_operations (voyage_id, embark_port, updated_at)
  VALUES (p_voyage_id, upper(btrim(p_port)), now())
  ON CONFLICT (voyage_id, embark_port) DO UPDATE SET updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_operation_id;

  -- ponytail: validacao no RPC e tudo-ou-nada para nao subestimar pagamento por erro de uma linha.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS r(
      container_number TEXT, container_type TEXT, local_code TEXT, condition TEXT,
      hand_in_date DATE, hand_out_date DATE, movement_date DATE
    )
    LEFT JOIN public.depots d ON lower(d.code) = lower(btrim(r.local_code))
    WHERE NULLIF(btrim(r.container_number), '') IS NULL
       OR r.container_number !~ '^[A-Za-z]{4}[0-9]{7}$'
       OR NULLIF(btrim(r.local_code), '') IS NULL
       OR d.id IS NULL
       OR (d.id IS NOT NULL AND NOT d.active)
       OR (COALESCE(d.tipo, 'depot') = 'depot' AND (r.hand_in_date IS NULL OR r.hand_out_date IS NULL))
       OR (COALESCE(d.tipo, 'depot') = 'depot' AND r.hand_out_date < r.hand_in_date)
       OR (d.id IS NOT NULL AND d.tipo = 'terminal_portuario' AND (r.hand_in_date IS NOT NULL OR r.hand_out_date IS NOT NULL))
       OR r.condition IS NULL OR r.condition NOT IN ('vazio', 'material')
  ) THEN
    RAISE EXCEPTION 'Planilha invalida: corrija todas as linhas e importe novamente.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.vazios_manifests (voyage_id, description, total_bookings, imported_by)
  VALUES (p_voyage_id, p_port, v_total, p_uploaded_by) RETURNING id INTO v_manifest_id;

  DELETE FROM public.vazios_bookings WHERE operation_id = v_operation_id;
  INSERT INTO public.vazios_bookings (
    voyage_id, operation_id, manifest_id, container_number, container_type,
    local_id, condition, hand_in_date, hand_out_date, movement_date
  )
  SELECT
    p_voyage_id, v_operation_id, v_manifest_id, upper(btrim(r.container_number)), r.container_type, d.id,
    r.condition, r.hand_in_date, r.hand_out_date, r.movement_date
  FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS r(
    container_number TEXT, container_type TEXT, local_code TEXT, condition TEXT,
    hand_in_date DATE, hand_out_date DATE, movement_date DATE
  )
  JOIN public.depots d ON lower(d.code) = lower(btrim(r.local_code)) AND d.active;

  RETURN jsonb_build_object(
    'manifest_id', v_manifest_id,
    'operation_id', v_operation_id,
    'total', v_total,
    'replaced', TRUE
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.import_vazios_bookings_transactional(BIGINT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_vazios_bookings_transactional(BIGINT, TEXT, UUID, JSONB) TO authenticated;
