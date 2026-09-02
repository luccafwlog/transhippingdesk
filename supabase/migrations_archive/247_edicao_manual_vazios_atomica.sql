-- ADR 0033: a edicao manual deve passar pelo mesmo limite transacional e de autorizacao do CRUD.
-- Rollback: revogar a RPC e restaurar a escrita direta somente apos correcao coordenada.

CREATE OR REPLACE FUNCTION public.update_manual_vazios_booking(
  p_booking_id UUID,
  p_container_number TEXT,
  p_container_type TEXT,
  p_local_id UUID,
  p_condition TEXT,
  p_hand_in_date DATE,
  p_hand_out_date DATE,
  p_movement_date DATE
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_active_user() OR public.is_equipamentos_user()) THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para editar unidade.' USING ERRCODE = '42501';
  END IF;
  IF upper(btrim(COALESCE(p_container_number, ''))) !~ '^[A-Z]{4}[0-9]{7}$' THEN
    RAISE EXCEPTION 'Container invalido.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.vazios_bookings
  SET container_number = upper(btrim(p_container_number)),
      container_type = p_container_type,
      local_id = p_local_id,
      condition = p_condition,
      hand_in_date = p_hand_in_date,
      hand_out_date = p_hand_out_date,
      movement_date = p_movement_date
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unidade embarcada nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_manual_vazios_booking(UUID, TEXT, TEXT, UUID, TEXT, DATE, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_manual_vazios_booking(UUID, TEXT, TEXT, UUID, TEXT, DATE, DATE, DATE) TO authenticated;
