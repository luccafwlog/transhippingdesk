-- ADR 0033: excluir Unidade Embarcada manual nao pode deixar manifesto vazio.
-- Rollback: revogar a RPC e restaurar a exclusao direta somente apos correcao coordenada.

CREATE OR REPLACE FUNCTION public.delete_manual_vazios_booking(p_booking_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_manifest_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_active_user() OR public.is_equipamentos_user()) THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para excluir unidade.' USING ERRCODE = '42501';
  END IF;

  SELECT manifest_id INTO v_manifest_id
  FROM public.vazios_bookings
  WHERE id = p_booking_id;
  IF v_manifest_id IS NULL THEN
    RAISE EXCEPTION 'Unidade embarcada nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.vazios_bookings WHERE id = p_booking_id;

  DELETE FROM public.vazios_manifests manifest
  WHERE manifest.id = v_manifest_id
    AND manifest.description = 'Inclusao manual no Embarque de Vazios'
    AND NOT EXISTS (
      SELECT 1 FROM public.vazios_bookings booking
      WHERE booking.manifest_id = manifest.id
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_manual_vazios_booking(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_manual_vazios_booking(UUID) TO authenticated;

-- Remove somente os manifestos manuais vazios deixados por exclusoes anteriores.
DELETE FROM public.vazios_manifests manifest
WHERE manifest.description = 'Inclusao manual no Embarque de Vazios'
  AND NOT EXISTS (
    SELECT 1 FROM public.vazios_bookings booking
    WHERE booking.manifest_id = manifest.id
  );
