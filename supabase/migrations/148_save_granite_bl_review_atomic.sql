-- Renumbered from 20260623120000 (original timestamped migration: 20260623120000_save_granite_bl_review_atomic.sql).
CREATE OR REPLACE FUNCTION public.save_granite_bl_review(
  p_granite_bl_id UUID,
  p_client_id BIGINT,
  p_changed_by UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_previous_client_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para revisar B/L Granite.' USING ERRCODE = '42501';
  END IF;

  SELECT client_id
  INTO v_previous_client_id
  FROM public.granite_bls
  WHERE id = p_granite_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L Granite % nao encontrado', p_granite_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_previous_client_id IS NOT DISTINCT FROM p_client_id THEN
    RETURN;
  END IF;

  UPDATE public.granite_bls
  SET client_id = p_client_id
  WHERE id = p_granite_bl_id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, justification
  )
  VALUES (
    'granite_bl', p_granite_bl_id::TEXT, 'client_id',
    v_previous_client_id::TEXT, p_client_id::TEXT, p_changed_by,
    'Cliente vinculado via fila de revisao'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_granite_bl_review(UUID, BIGINT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_granite_bl_review(UUID, BIGINT, UUID) TO authenticated;
