-- 310: COD exige confirmação operacional e justificativa auditada.
-- Esta migration reescreve as definições vivas da 309; não reintroduz o RBAC
-- ou os locks antigos da 215. O helper financeiro é uma seam compatível com a
-- Task 6b e fica opcional até que a migration 312 o crie.

DROP FUNCTION public.set_bl_cod(TEXT, BIGINT, UUID);
DROP FUNCTION public.set_bl_transshipment(TEXT, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID);

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

  -- Capture the prior POD under the B/L lock before changing the destination.
  SELECT pod, customer_id INTO v_old_pod, v_customer FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.bl_transshipments
  SET
    disposition = 'cod',
    onward_vessel_name = NULL,
    onward_carrier = NULL,
    onward_voyage_number = NULL,
    onward_etd = NULL,
    onward_eta = NULL,
    updated_at = now()
  WHERE bl_id = p_bl_id AND omission_id = p_omission_id;

  UPDATE public.bls SET pod = v_discharge, updated_at = now() WHERE id = p_bl_id;

  -- Contract for Task 6b: the helper receives the POD before the transition,
  -- while bls.pod already contains the new final destination.
  IF to_regprocedure('public.apply_cod_financial_effect(text,bigint,text)') IS NOT NULL THEN
    PERFORM public.apply_cod_financial_effect(p_bl_id, p_omission_id, v_old_pod);
  END IF;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES (
    'bls', p_bl_id, 'pod', v_old_pod, v_discharge, p_changed_by,
    'COD apos omissao da escala de ' || v_omitted || ': ' || v_justification
  );

  IF v_customer IS NOT NULL THEN
    INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
    VALUES (
      v_customer,
      p_bl_id,
      'transshipment',
      'Destino alterado (COD)',
      'A pedido, o destino final do B/L ' || p_bl_id || ' foi alterado para ' || v_discharge ||
        ' (COD), apos a omissao da escala de ' || v_omitted || '.',
      NULL
    );
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_bl_transshipment(
  p_bl_id TEXT,
  p_omission_id BIGINT,
  p_onward_vessel_name TEXT,
  p_onward_carrier TEXT,
  p_onward_voyage_number TEXT,
  p_onward_etd TIMESTAMPTZ,
  p_onward_eta TIMESTAMPTZ,
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

  -- Shared B/L lock serializes POD capture/update with COD and omission revert.
  SELECT pod, customer_id INTO v_old_pod, v_customer FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_was = 'cod' AND v_justification IS NULL THEN
    RAISE EXCEPTION 'Reverter COD exige justificativa.' USING ERRCODE = '22023';
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
    -- Restore the original POD before the symmetric Task 6b effect.
    UPDATE public.bls SET pod = v_original_pod, updated_at = now() WHERE id = p_bl_id;

    IF to_regprocedure('public.apply_cod_financial_effect(text,bigint,text)') IS NOT NULL THEN
      PERFORM public.apply_cod_financial_effect(p_bl_id, p_omission_id, v_old_pod);
    END IF;

    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES (
      'bls', p_bl_id, 'pod', v_old_pod, v_original_pod, p_changed_by,
      'Reversao de COD para transbordo: ' || v_justification
    );

    IF v_customer IS NOT NULL THEN
      INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
      VALUES (
        v_customer,
        p_bl_id,
        'transshipment',
        'Correção de destino (COD)',
        'O destino final do B/L ' || p_bl_id || ' foi restaurado para ' || v_original_pod ||
          ' após a reversão do COD.',
        NULL
      );
    END IF;
  END IF;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bls', p_bl_id, 'transbordo', v_was, 'transshipment', p_changed_by, 'Definicao de transbordo (navio de terceiros)');
END;
$function$;

REVOKE ALL ON FUNCTION public.set_bl_cod(TEXT, BIGINT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bl_cod(TEXT, BIGINT, TEXT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.set_bl_transshipment(TEXT, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bl_transshipment(TEXT, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) TO authenticated;
