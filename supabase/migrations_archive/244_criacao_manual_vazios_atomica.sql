-- ADR 0033: a inclusão manual cria manifesto e unidade como uma única transação.
-- Rollback: revogar a função; a tela volta a usar o fluxo anterior somente após correção coordenada.

CREATE OR REPLACE FUNCTION public.create_manual_vazios_booking(
  p_operation_id UUID,
  p_voyage_id BIGINT,
  p_uploaded_by UUID,
  p_container_number TEXT,
  p_container_type TEXT,
  p_local_id UUID,
  p_condition TEXT,
  p_hand_in_date DATE,
  p_hand_out_date DATE,
  p_movement_date DATE
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_manifest_id UUID;
  v_booking_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_active_user() OR public.is_equipamentos_user())
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para incluir unidade.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vazios_export_operations
    WHERE id = p_operation_id AND voyage_id = p_voyage_id
  ) THEN
    RAISE EXCEPTION 'Unidade deve pertencer a uma operacao da mesma viagem.' USING ERRCODE = '23514';
  END IF;
  IF upper(btrim(COALESCE(p_container_number, ''))) !~ '^[A-Z]{4}[0-9]{7}$' THEN
    RAISE EXCEPTION 'Container invalido.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.vazios_manifests (voyage_id, description, total_bookings, imported_by)
  VALUES (p_voyage_id, 'Inclusao manual no Embarque de Vazios', 1, p_uploaded_by)
  RETURNING id INTO v_manifest_id;

  INSERT INTO public.vazios_bookings (
    voyage_id, operation_id, manifest_id, container_number, container_type,
    local_id, condition, hand_in_date, hand_out_date, movement_date
  ) VALUES (
    p_voyage_id, p_operation_id, v_manifest_id, upper(btrim(p_container_number)), p_container_type,
    p_local_id, p_condition, p_hand_in_date, p_hand_out_date, p_movement_date
  ) RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_manual_vazios_booking(UUID, BIGINT, UUID, TEXT, TEXT, UUID, TEXT, DATE, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_vazios_booking(UUID, BIGINT, UUID, TEXT, TEXT, UUID, TEXT, DATE, DATE, DATE) TO authenticated;
