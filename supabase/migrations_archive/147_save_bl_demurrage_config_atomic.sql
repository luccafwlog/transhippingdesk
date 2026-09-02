-- Renumbered from 20260623112000 (original timestamped migration: 20260623112000_save_bl_demurrage_config_atomic.sql).
CREATE OR REPLACE FUNCTION public.save_bl_demurrage_config(
  p_bl_id TEXT,
  p_expected_updated_at TIMESTAMPTZ,
  p_free_time_override INTEGER,
  p_rate_p1_usd NUMERIC,
  p_rate_p2_usd NUMERIC,
  p_changed_by UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para configurar demurrage.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BL % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_bl.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuario; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;

  UPDATE public.bls
  SET
    free_time_override = p_free_time_override,
    demurrage_rate_override_p1_usd = p_rate_p1_usd,
    demurrage_rate_override_p2_usd = p_rate_p2_usd
  WHERE id = p_bl_id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, justification
  )
  SELECT 'bl', p_bl_id, change.field_name, change.old_value, change.new_value,
         p_changed_by, 'Config de demurrage (Faturamento).'
  FROM (VALUES
    ('free_time_override', v_bl.free_time_override::TEXT, p_free_time_override::TEXT),
    ('demurrage_rate_override_p1_usd', v_bl.demurrage_rate_override_p1_usd::TEXT, p_rate_p1_usd::TEXT),
    ('demurrage_rate_override_p2_usd', v_bl.demurrage_rate_override_p2_usd::TEXT, p_rate_p2_usd::TEXT)
  ) AS change(field_name, old_value, new_value)
  WHERE change.old_value IS DISTINCT FROM change.new_value;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_bl_demurrage_config(TEXT, TIMESTAMPTZ, INTEGER, NUMERIC, NUMERIC, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_bl_demurrage_config(TEXT, TIMESTAMPTZ, INTEGER, NUMERIC, NUMERIC, UUID) TO authenticated;
