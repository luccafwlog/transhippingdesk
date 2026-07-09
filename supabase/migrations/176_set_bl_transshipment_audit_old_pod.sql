-- Reentrega da correcao do audit de reversao COD->transbordo em set_bl_transshipment.
-- A 174 foi editada no lugar apos ja ter sido aplicada; o runner rastreia por versao
-- e nao a reaplica, entao o CREATE OR REPLACE corrigido nunca roda em ambiente onde a
-- 174 ja passou (WORKFLOW.md secao 5). Esta migracao nova garante que a funcao no banco
-- grave o POD anterior (discharge_pod) como old_value, em vez de NULL.
CREATE OR REPLACE FUNCTION public.set_bl_transshipment(
  p_bl_id TEXT,
  p_omission_id BIGINT,
  p_onward_vessel_name TEXT,
  p_onward_carrier TEXT,
  p_onward_voyage_number TEXT,
  p_onward_etd TIMESTAMPTZ,
  p_onward_eta TIMESTAMPTZ,
  p_changed_by UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_was TEXT;
  v_original_pod TEXT;
  v_old_pod TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT t.disposition, o.omitted_pod INTO v_was, v_original_pod
  FROM public.bl_transshipments t
  JOIN public.voyage_omissions o ON o.id = t.omission_id
  WHERE t.bl_id = p_bl_id AND t.omission_id = p_omission_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transbordo do B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.bl_transshipments
  SET
    disposition = 'transshipment',
    onward_vessel_name = NULLIF(btrim(COALESCE(p_onward_vessel_name, '')), ''),
    onward_carrier = NULLIF(btrim(COALESCE(p_onward_carrier, '')), ''),
    onward_voyage_number = NULLIF(btrim(COALESCE(p_onward_voyage_number, '')), ''),
    onward_etd = p_onward_etd,
    onward_eta = p_onward_eta,
    updated_at = now()
  WHERE bl_id = p_bl_id AND omission_id = p_omission_id;

  IF v_was = 'cod' THEN
    SELECT pod INTO v_old_pod FROM public.bls WHERE id = p_bl_id;
    UPDATE public.bls SET pod = v_original_pod, updated_at = now() WHERE id = p_bl_id;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bls', p_bl_id, 'pod', v_old_pod, v_original_pod, p_changed_by, 'Reversao de COD para transbordo');
  END IF;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bls', p_bl_id, 'transbordo', v_was, 'transshipment', p_changed_by, 'Definicao de transbordo (navio de terceiros)');
END;
$function$;
