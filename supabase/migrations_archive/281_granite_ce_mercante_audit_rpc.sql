-- CE Mercante de Granito deve usar o mesmo contrato auditável do B/L de container.
-- Rollback: DROP FUNCTION IF EXISTS public.apply_granite_ce_mercante_update(UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.apply_granite_ce_mercante_update(
  p_bl_id UUID,
  p_new_ce TEXT,
  p_changed_by UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_ce TEXT;
BEGIN
  SELECT ce_mercante INTO v_old_ce
  FROM public.granite_bls
  WHERE id = p_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L Granito % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_old_ce, '') = COALESCE(p_new_ce, '') THEN
    RETURN 'unchanged';
  END IF;

  UPDATE public.granite_bls SET ce_mercante = p_new_ce WHERE id = p_bl_id;

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value, changed_by, justification
  ) VALUES (
    'granite_bl', p_bl_id::text, 'ce_mercante',
    COALESCE(v_old_ce, ''), COALESCE(p_new_ce, ''), p_changed_by,
    'Importacao CE Mercante'
  );

  IF v_old_ce IS NOT NULL AND v_old_ce <> '' THEN
    RETURN 'overwritten';
  END IF;
  RETURN 'inserted';
END;
$$;

REVOKE ALL ON FUNCTION public.apply_granite_ce_mercante_update(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_granite_ce_mercante_update(UUID, TEXT, UUID) TO authenticated;
