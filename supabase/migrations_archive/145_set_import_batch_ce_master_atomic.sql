-- Renumbered from 20260623110000 (original timestamped migration: 20260623110000_set_import_batch_ce_master_atomic.sql).
CREATE OR REPLACE FUNCTION public.set_import_batch_ce_master(
  p_batch_id BIGINT,
  p_ce_master TEXT,
  p_changed_by UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_batch public.import_batches%ROWTYPE;
  v_normalized TEXT := NULLIF(btrim(COALESCE(p_ce_master, '')), '');
  v_old_value TEXT;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para editar CE Master.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_batch
  FROM public.import_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote de importacao % nao encontrado', p_batch_id
      USING ERRCODE = 'P0002';
  END IF;

  v_old_value := NULLIF(btrim(COALESCE(v_batch.ce_master, '')), '');
  IF v_old_value IS NOT DISTINCT FROM v_normalized THEN
    RETURN;
  END IF;

  UPDATE public.import_batches
  SET ce_master = v_normalized
  WHERE id = p_batch_id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, justification
  )
  VALUES (
    'import_batches',
    COALESCE(v_batch.voyage_id::TEXT, p_batch_id::TEXT),
    'ce_master',
    v_old_value,
    v_normalized,
    p_changed_by,
    'Atualizacao manual de CE Master'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_import_batch_ce_master(BIGINT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_import_batch_ce_master(BIGINT, TEXT, UUID) TO authenticated;
