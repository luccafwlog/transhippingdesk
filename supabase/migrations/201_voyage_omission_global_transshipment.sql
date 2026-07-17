-- 201: Spec §§5-6 / ADR 0022: transbordo e registro global da omissao.
ALTER TABLE public.voyage_omissions
  ADD COLUMN IF NOT EXISTS onward_vessel_name TEXT,
  ADD COLUMN IF NOT EXISTS onward_carrier TEXT,
  ADD COLUMN IF NOT EXISTS onward_voyage_number TEXT,
  ADD COLUMN IF NOT EXISTS onward_etd TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onward_eta TIMESTAMPTZ;

-- Promove o primeiro valor nao nulo de cada campo legado por omissao.
UPDATE public.voyage_omissions vo SET
  onward_vessel_name = src.onward_vessel_name,
  onward_carrier = src.onward_carrier,
  onward_voyage_number = src.onward_voyage_number,
  onward_etd = src.onward_etd,
  onward_eta = src.onward_eta
FROM (
  SELECT omission_id,
    (array_agg(onward_vessel_name ORDER BY id) FILTER (WHERE onward_vessel_name IS NOT NULL))[1] AS onward_vessel_name,
    (array_agg(onward_carrier ORDER BY id) FILTER (WHERE onward_carrier IS NOT NULL))[1] AS onward_carrier,
    (array_agg(onward_voyage_number ORDER BY id) FILTER (WHERE onward_voyage_number IS NOT NULL))[1] AS onward_voyage_number,
    (array_agg(onward_etd ORDER BY id) FILTER (WHERE onward_etd IS NOT NULL))[1] AS onward_etd,
    (array_agg(onward_eta ORDER BY id) FILTER (WHERE onward_eta IS NOT NULL))[1] AS onward_eta
  FROM public.bl_transshipments
  GROUP BY omission_id
) src
WHERE src.omission_id = vo.id;

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
  v_voyage_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.voyage_omissions SET
    onward_vessel_name = NULLIF(btrim(COALESCE(p_onward_vessel_name, '')), ''),
    onward_carrier = NULLIF(btrim(COALESCE(p_onward_carrier, '')), ''),
    onward_voyage_number = NULLIF(btrim(COALESCE(p_onward_voyage_number, '')), ''),
    onward_etd = p_onward_etd,
    onward_eta = p_onward_eta,
    reason = NULLIF(btrim(COALESCE(p_reason, '')), '')
  WHERE id = p_omission_id
  RETURNING voyage_id INTO v_voyage_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Omissao % nao encontrada', p_omission_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyage', v_voyage_id::text, 'transshipment_info', NULL,
          'Informacoes de Transbordo complementadas', p_changed_by,
          'Informacoes de Transbordo complementadas');

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  SELECT 'bls', bt.bl_id, 'transshipment_info', NULL,
         'Informacoes de Transbordo complementadas', p_changed_by,
         'Informacoes de Transbordo complementadas'
  FROM public.bl_transshipments bt
  WHERE bt.omission_id = p_omission_id;
END;
$function$;

-- A assinatura anterior precisa ser removida para evitar overload ambiguo no PostgREST.
DROP FUNCTION IF EXISTS public.omit_voyage_escala(BIGINT, TEXT, TEXT, TEXT, UUID);
CREATE FUNCTION public.omit_voyage_escala(
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

  INSERT INTO public.voyage_omissions(
    voyage_id, omitted_pod, discharge_pod, reason, omitted_by,
    onward_vessel_name, onward_carrier, onward_voyage_number, onward_etd, onward_eta
  ) VALUES (
    p_voyage_id, v_omitted, v_discharge, NULLIF(btrim(COALESCE(p_reason, '')), ''), p_changed_by,
    NULLIF(btrim(COALESCE(p_onward_vessel_name, '')), ''),
    NULLIF(btrim(COALESCE(p_onward_carrier, '')), ''),
    NULLIF(btrim(COALESCE(p_onward_voyage_number, '')), ''), p_onward_etd, p_onward_eta
  )
  ON CONFLICT (voyage_id, omitted_pod) DO UPDATE SET
    discharge_pod = EXCLUDED.discharge_pod,
    reason = EXCLUDED.reason,
    onward_vessel_name = EXCLUDED.onward_vessel_name,
    onward_carrier = EXCLUDED.onward_carrier,
    onward_voyage_number = EXCLUDED.onward_voyage_number,
    onward_etd = EXCLUDED.onward_etd,
    onward_eta = EXCLUDED.onward_eta,
    omitted_by = EXCLUDED.omitted_by,
    omitted_at = now()
  RETURNING id INTO v_omission_id;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyage_pod_schedule', v_entity_id, 'omitted', 'false', 'true', p_changed_by,
          'Escala omitida pelo armador; carga descarregada em ' || v_discharge);
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyage', p_voyage_id::text, 'escala_omitida', v_omitted, v_discharge, p_changed_by,
          COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Omissao de escala'));

  INSERT INTO public.bl_transshipments(bl_id, omission_id, disposition, created_by)
  SELECT b.id, v_omission_id, 'transshipment', p_changed_by
  FROM public.bls b
  WHERE b.voyage_id = p_voyage_id AND upper(btrim(COALESCE(b.pod, ''))) = v_omitted
  ON CONFLICT (bl_id, omission_id) DO NOTHING;

  INSERT INTO public.portal_notifications(customer_id, type, title, message, link)
  SELECT b.customer_id, 'transshipment', 'Escala omitida',
         'A escala de ' || v_omitted || ' foi omitida. A carga do B/L ' || b.id ||
         ' foi descarregada em ' || v_discharge || ' e seguira em transbordo para ' || v_omitted || '.', NULL
  FROM public.bls b
  WHERE b.voyage_id = p_voyage_id
    AND upper(btrim(COALESCE(b.pod, ''))) = v_omitted
    AND b.customer_id IS NOT NULL;
  RETURN v_omission_id;
END;
$function$;

-- Estes campos agora pertencem a voyage_omissions; a RPC conserva a assinatura
-- para restaurar a disposicao apos COD sem quebrar clientes em transicao.
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
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
  FROM public.bl_transshipments t JOIN public.voyage_omissions o ON o.id = t.omission_id
  WHERE t.bl_id = p_bl_id AND t.omission_id = p_omission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transbordo do B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.bl_transshipments
  SET disposition = 'transshipment', updated_at = now()
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

REVOKE ALL ON FUNCTION public.update_voyage_omission(BIGINT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_voyage_omission(BIGINT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.omit_voyage_escala(BIGINT,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omit_voyage_escala(BIGINT,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) TO authenticated;
