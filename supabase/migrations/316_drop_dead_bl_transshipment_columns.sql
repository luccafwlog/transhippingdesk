-- 316: os dados de transbordo pertencem à omissão global, não à disposição
-- individual do B/L. Remove colunas mortas e reduz a RPC de reversão ao
-- contrato que realmente usa esses dados.

ALTER TABLE public.bl_transshipments
  DROP COLUMN IF EXISTS onward_vessel_name,
  DROP COLUMN IF EXISTS onward_carrier,
  DROP COLUMN IF EXISTS onward_voyage_number,
  DROP COLUMN IF EXISTS onward_etd,
  DROP COLUMN IF EXISTS onward_eta;

DROP FUNCTION IF EXISTS public.set_bl_transshipment(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID
);

-- 310's COD body also cleared the now-removed onward_* columns. Re-publish
-- the same live contract without touching dead storage.
CREATE OR REPLACE FUNCTION public.set_bl_cod(
  p_bl_id TEXT,
  p_omission_id BIGINT,
  p_justification TEXT,
  p_changed_by UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_discharge TEXT;
  v_omitted TEXT;
  v_old_pod TEXT;
  v_customer BIGINT;
  v_justification TEXT := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_justification IS NULL THEN
    RAISE EXCEPTION 'Marcar COD exige justificativa.' USING ERRCODE = '22023';
  END IF;

  SELECT o.discharge_pod, o.omitted_pod INTO v_discharge, v_omitted
  FROM public.bl_transshipments AS t
  JOIN public.voyage_omissions AS o ON o.id = t.omission_id
  WHERE t.bl_id = p_bl_id AND t.omission_id = p_omission_id
  FOR UPDATE OF o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transbordo do B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  SELECT pod, customer_id INTO v_old_pod, v_customer
  FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.bl_transshipments
  SET disposition = 'cod', updated_at = now()
  WHERE bl_id = p_bl_id AND omission_id = p_omission_id;
  UPDATE public.bls SET pod = v_discharge, updated_at = now() WHERE id = p_bl_id;

  IF to_regprocedure('public.apply_cod_financial_effect(text,bigint,text)') IS NOT NULL THEN
    PERFORM public.apply_cod_financial_effect(p_bl_id, p_omission_id, v_old_pod);
  END IF;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bls', p_bl_id, 'pod', v_old_pod, v_discharge, p_changed_by,
    'COD apos omissao da escala de ' || v_omitted || ': ' || v_justification);
  IF v_customer IS NOT NULL THEN
    INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
    VALUES (v_customer, p_bl_id, 'transshipment', 'Destino alterado (COD)',
      'A pedido, o destino final do B/L ' || p_bl_id || ' foi alterado para ' || v_discharge ||
        ' (COD), apos a omissao da escala de ' || v_omitted || '.', NULL);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_bl_cod(TEXT, BIGINT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bl_cod(TEXT, BIGINT, TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_bl_transshipment(
  p_bl_id TEXT,
  p_omission_id BIGINT,
  p_justification TEXT,
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
  v_customer BIGINT;
  v_justification TEXT := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT t.disposition, o.omitted_pod INTO v_was, v_original_pod
  FROM public.bl_transshipments AS t
  JOIN public.voyage_omissions AS o ON o.id = t.omission_id
  WHERE t.bl_id = p_bl_id AND t.omission_id = p_omission_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transbordo do B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  SELECT pod, customer_id INTO v_old_pod, v_customer
  FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_was = 'cod' AND v_justification IS NULL THEN
    RAISE EXCEPTION 'Reverter COD exige justificativa.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bl_transshipments
  SET disposition = 'transshipment', updated_at = now()
  WHERE bl_id = p_bl_id AND omission_id = p_omission_id;

  IF v_was = 'cod' THEN
    UPDATE public.bls SET pod = v_original_pod, updated_at = now() WHERE id = p_bl_id;

    IF to_regprocedure('public.apply_cod_financial_effect(text,bigint,text)') IS NOT NULL THEN
      PERFORM public.apply_cod_financial_effect(p_bl_id, p_omission_id, v_old_pod);
    END IF;

    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bls', p_bl_id, 'pod', v_old_pod, v_original_pod, p_changed_by,
      'Reversao de COD para transbordo: ' || v_justification);

    IF v_customer IS NOT NULL THEN
      INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
      VALUES (
        v_customer, p_bl_id, 'transshipment', 'Correção de destino (COD)',
        'O destino final do B/L ' || p_bl_id || ' foi restaurado para ' || v_original_pod ||
          ' após a reversão do COD.', NULL
      );
    END IF;
  END IF;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bls', p_bl_id, 'transbordo', v_was, 'transshipment', p_changed_by,
    'Definicao de transbordo (navio de terceiros)');
END;
$function$;

REVOKE ALL ON FUNCTION public.set_bl_transshipment(TEXT, BIGINT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bl_transshipment(TEXT, BIGINT, TEXT, UUID) TO authenticated;

-- Complementação global sem ruído: só audita quando a atualização mudou
-- algum valor e um campo vazio não apaga motivo já informado.
CREATE OR REPLACE FUNCTION public.update_voyage_omission(
  p_omission_id BIGINT,
  p_onward_vessel_name TEXT,
  p_onward_carrier TEXT,
  p_onward_voyage_number TEXT,
  p_onward_etd TIMESTAMPTZ,
  p_onward_eta TIMESTAMPTZ,
  p_reason TEXT,
  p_changed_by UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_old RECORD;
  v_new_vessel TEXT;
  v_new_carrier TEXT;
  v_new_voyage TEXT;
  v_new_etd TIMESTAMPTZ;
  v_new_eta TIMESTAMPTZ;
  v_reason TEXT;
  v_changed BOOLEAN := false;
  v_justification TEXT := 'Informacoes de Transbordo complementadas';
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_old FROM public.voyage_omissions WHERE id = p_omission_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Omissao % nao encontrada', p_omission_id USING ERRCODE = 'P0002';
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_new_vessel := NULLIF(btrim(COALESCE(p_onward_vessel_name, '')), '');
  v_new_carrier := NULLIF(btrim(COALESCE(p_onward_carrier, '')), '');
  v_new_voyage := NULLIF(btrim(COALESCE(p_onward_voyage_number, '')), '');
  v_new_etd := p_onward_etd;
  v_new_eta := p_onward_eta;

  v_changed := v_old.onward_vessel_name IS DISTINCT FROM v_new_vessel
    OR v_old.onward_carrier IS DISTINCT FROM v_new_carrier
    OR v_old.onward_voyage_number IS DISTINCT FROM v_new_voyage
    OR v_old.onward_etd IS DISTINCT FROM v_new_etd
    OR v_old.onward_eta IS DISTINCT FROM v_new_eta
    OR (v_reason IS NOT NULL AND v_old.reason IS DISTINCT FROM v_reason);

  UPDATE public.voyage_omissions SET
    onward_vessel_name = v_new_vessel,
    onward_carrier = v_new_carrier,
    onward_voyage_number = v_new_voyage,
    onward_etd = v_new_etd,
    onward_eta = v_new_eta,
    reason = COALESCE(v_reason, v_old.reason)
  WHERE id = p_omission_id;

  IF NOT v_changed THEN
    RETURN;
  END IF;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyage', v_old.voyage_id::TEXT, 'transshipment_info', NULL,
    v_justification, p_changed_by, v_justification);
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  SELECT 'bls', bt.bl_id, 'transshipment_info', NULL, v_justification, p_changed_by, v_justification
  FROM public.bl_transshipments AS bt
  WHERE bt.omission_id = p_omission_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_voyage_omission(BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_voyage_omission(BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) TO authenticated;
