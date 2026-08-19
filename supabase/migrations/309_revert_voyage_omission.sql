-- 309: torna a omissão de escala reversível por Admin, com rastro e aviso de correção.
-- A reversão remove somente a decisão de omissão e seus vínculos de transbordo.
-- Não altera B/Ls, estado terminalizado, frentes de operação ou ADRs.
-- Rollback: em ambiente descartável, reaplicar a definição final da 308; não
-- reverter dados operacionais já removidos sem uma restauração transacional.

-- A omissão do mesmo POD é uma decisão nova, não uma atualização silenciosa.
-- A remoção catalogada do CHECK legado permanece na migration 308; esta
-- definição final troca o antigo ON CONFLICT DO UPDATE por erro explícito.
CREATE OR REPLACE FUNCTION public.omit_voyage_escala(
  p_voyage_id BIGINT,
  p_omitted_pod TEXT,
  p_discharge_pod TEXT,
  p_reason TEXT,
  p_changed_by UUID,
  p_onward_vessel_name TEXT DEFAULT NULL,
  p_onward_carrier TEXT DEFAULT NULL,
  p_onward_voyage_number TEXT DEFAULT NULL,
  p_onward_etd TIMESTAMPTZ DEFAULT NULL,
  p_onward_eta TIMESTAMPTZ DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_omitted TEXT := upper(btrim(COALESCE(p_omitted_pod, '')));
  v_discharge TEXT := upper(btrim(COALESCE(p_discharge_pod, '')));
  v_entity_id TEXT := p_voyage_id::text || '::' || v_omitted;
  v_omission_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  IF v_omitted = '' OR v_discharge = '' THEN
    RAISE EXCEPTION 'POD omitido/descarga invalidos' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem % nao encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.voyage_omissions
    WHERE voyage_id = p_voyage_id AND omitted_pod = v_omitted
  ) THEN
    RAISE EXCEPTION 'A escala da viagem % ja foi omitida para o POD %.', p_voyage_id, v_omitted
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.voyage_omissions(
    voyage_id,
    omitted_pod,
    discharge_pod,
    reason,
    omitted_by,
    onward_vessel_name,
    onward_carrier,
    onward_voyage_number,
    onward_etd,
    onward_eta
  )
  VALUES (
    p_voyage_id,
    v_omitted,
    v_discharge,
    NULLIF(btrim(COALESCE(p_reason, '')), ''),
    p_changed_by,
    NULLIF(btrim(COALESCE(p_onward_vessel_name, '')), ''),
    NULLIF(btrim(COALESCE(p_onward_carrier, '')), ''),
    NULLIF(btrim(COALESCE(p_onward_voyage_number, '')), ''),
    p_onward_etd,
    p_onward_eta
  )
  RETURNING id INTO v_omission_id;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES (
    'voyage_pod_schedule',
    v_entity_id,
    'omitted',
    'false',
    'true',
    p_changed_by,
    'Escala omitida pelo armador; carga descarregada em ' || v_discharge
  );

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES (
    'voyage',
    p_voyage_id::text,
    'escala_omitida',
    v_omitted,
    v_discharge,
    p_changed_by,
    COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Omissao de escala')
  );

  INSERT INTO public.bl_transshipments(bl_id, omission_id, disposition, created_by)
  SELECT b.id, v_omission_id, 'transshipment', p_changed_by
  FROM public.bls b
  WHERE b.voyage_id = p_voyage_id
    AND upper(btrim(COALESCE(b.pod, ''))) = v_omitted
  ON CONFLICT (bl_id, omission_id) DO NOTHING;

  INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
  SELECT
    b.customer_id,
    b.id,
    'transshipment',
    'Escala omitida',
    'A escala de ' || v_omitted || ' foi omitida. A carga do B/L ' || b.id ||
      ' foi descarregada em ' || v_discharge || ' e seguira em transbordo para ' || v_omitted || '.',
    NULL
  FROM public.bls b
  WHERE b.voyage_id = p_voyage_id
    AND upper(btrim(COALESCE(b.pod, ''))) = v_omitted
    AND b.customer_id IS NOT NULL;

  RETURN v_omission_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.omit_voyage_escala(BIGINT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omit_voyage_escala(BIGINT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- As definições finais de 215 após a 295 exigem apenas usuario ativo. Esta
-- reaplicação conserva esse contrato e serializa toda transição de disposição
-- com a reversão pelo mesmo registro-pai da omissão.
CREATE OR REPLACE FUNCTION public.set_bl_cod(
  p_bl_id TEXT,
  p_omission_id BIGINT,
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
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT o.discharge_pod, o.omitted_pod INTO v_discharge, v_omitted
  FROM public.bl_transshipments AS t
  JOIN public.voyage_omissions AS o ON o.id = t.omission_id
  WHERE t.bl_id = p_bl_id AND t.omission_id = p_omission_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transbordo do B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  SELECT pod, customer_id INTO v_old_pod, v_customer FROM public.bls WHERE id = p_bl_id;

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

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bls', p_bl_id, 'pod', v_old_pod, v_discharge, p_changed_by, 'COD apos omissao da escala de ' || v_omitted);

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
  FROM public.bl_transshipments AS t
  JOIN public.voyage_omissions AS o ON o.id = t.omission_id
  WHERE t.bl_id = p_bl_id AND t.omission_id = p_omission_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transbordo do B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.bl_transshipments
  SET
    disposition = 'transshipment',
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

REVOKE ALL ON FUNCTION public.set_bl_cod(TEXT, BIGINT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bl_cod(TEXT, BIGINT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.set_bl_transshipment(TEXT, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bl_transshipment(TEXT, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.revert_voyage_omission(
  p_omission_id BIGINT,
  p_justification TEXT,
  p_changed_by UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_omission RECORD;
  v_justification TEXT := NULLIF(btrim(COALESCE(p_justification, '')), '');
  v_cod_count INTEGER;
  v_entity_id TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Somente Admin pode reverter omissao, com o proprio usuario autenticado.'
      USING ERRCODE = '42501';
  END IF;

  IF v_justification IS NULL THEN
    RAISE EXCEPTION 'Reversao de omissao exige justificativa.' USING ERRCODE = '22023';
  END IF;

  SELECT o.id, o.voyage_id, o.omitted_pod, o.discharge_pod
  INTO v_omission
  FROM public.voyage_omissions AS o
  WHERE o.id = p_omission_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Omissao % nao encontrada.', p_omission_id USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_cod_count
  FROM public.bl_transshipments AS t
  WHERE t.omission_id = p_omission_id
    AND t.disposition = 'cod';

  IF v_cod_count > 0 THEN
    RAISE EXCEPTION 'Nao e possivel reverter a omissao: % B/L(s) afetado(s) estao em COD.', v_cod_count
      USING ERRCODE = '22023';
  END IF;

  v_entity_id := v_omission.voyage_id::TEXT || '::' || upper(btrim(v_omission.omitted_pod));

  -- Este audit row é obrigatório: voyageRouteSchedules deriva omitted dele e,
  -- desde a 306, os consumidores de estado terminalizado e de alertas de ADR
  -- contam a escala ativa pela mesma decisão mais recente.
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES (
    'voyage_pod_schedule',
    v_entity_id,
    'omitted',
    'true',
    'false',
    p_changed_by,
    v_justification
  );

  INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
  SELECT
    b.customer_id,
    b.id,
    'transshipment',
    'Correção de omissão de escala',
    'A omissão da escala de ' || v_omission.omitted_pod || ' foi revertida. O B/L ' || b.id ||
      ' voltou a seguir a programação original da viagem.',
    NULL
  FROM public.bl_transshipments AS t
  JOIN public.bls AS b ON b.id = t.bl_id
  WHERE t.omission_id = p_omission_id
    AND b.customer_id IS NOT NULL;

  DELETE FROM public.bl_transshipments
  WHERE omission_id = p_omission_id;

  DELETE FROM public.voyage_omissions
  WHERE id = p_omission_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.revert_voyage_omission(BIGINT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revert_voyage_omission(BIGINT, TEXT, UUID) TO authenticated;
