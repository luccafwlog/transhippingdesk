-- Omissao de escala + transbordo/COD (spec 2026-07-09).
-- Grao escala: voyage_omissions. Grao B/L: bl_transshipments.
-- Financeiro (CE Mercante, taxas, demurrage) permanece manual: aqui so registro.

CREATE TABLE IF NOT EXISTS public.voyage_omissions (
  id BIGSERIAL PRIMARY KEY,
  voyage_id BIGINT NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  omitted_pod TEXT NOT NULL,
  discharge_pod TEXT NOT NULL,
  reason TEXT,
  omitted_by UUID REFERENCES auth.users(id),
  omitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (voyage_id, omitted_pod),
  CHECK (upper(btrim(omitted_pod)) <> upper(btrim(discharge_pod)))
);

CREATE INDEX IF NOT EXISTS voyage_omissions_voyage_idx
  ON public.voyage_omissions(voyage_id);

CREATE TABLE IF NOT EXISTS public.bl_transshipments (
  id BIGSERIAL PRIMARY KEY,
  bl_id TEXT NOT NULL REFERENCES public.bls(id) ON DELETE CASCADE,
  omission_id BIGINT NOT NULL REFERENCES public.voyage_omissions(id) ON DELETE CASCADE,
  disposition TEXT NOT NULL DEFAULT 'transshipment'
    CHECK (disposition IN ('transshipment', 'cod')),
  onward_vessel_name TEXT,
  onward_carrier TEXT,
  onward_voyage_number TEXT,
  onward_etd TIMESTAMPTZ,
  onward_eta TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bl_id, omission_id),
  CHECK (
    disposition = 'transshipment'
    OR (
      onward_vessel_name IS NULL
      AND onward_carrier IS NULL
      AND onward_voyage_number IS NULL
      AND onward_etd IS NULL
      AND onward_eta IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS bl_transshipments_bl_idx
  ON public.bl_transshipments(bl_id);
CREATE INDEX IF NOT EXISTS bl_transshipments_omission_idx
  ON public.bl_transshipments(omission_id);

ALTER TABLE public.voyage_omissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bl_transshipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS voyage_omissions_select_active ON public.voyage_omissions;
CREATE POLICY voyage_omissions_select_active ON public.voyage_omissions
  FOR SELECT TO authenticated USING (public.is_active_user());

DROP POLICY IF EXISTS bl_transshipments_select_active ON public.bl_transshipments;
CREATE POLICY bl_transshipments_select_active ON public.bl_transshipments
  FOR SELECT TO authenticated USING (public.is_active_user());

ALTER TABLE public.portal_notifications DROP CONSTRAINT IF EXISTS portal_notifications_type_check;
ALTER TABLE public.portal_notifications ADD CONSTRAINT portal_notifications_type_check
  CHECK (type IN ('invoice_issued','demurrage_issued','dispute_responded','dispute_opened','system','transshipment'));

CREATE OR REPLACE FUNCTION public.omit_voyage_escala(
  p_voyage_id BIGINT,
  p_omitted_pod TEXT,
  p_discharge_pod TEXT,
  p_reason TEXT,
  p_changed_by UUID
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

  IF v_omitted = '' OR v_discharge = '' OR v_omitted = v_discharge THEN
    RAISE EXCEPTION 'POD omitido/descarga invalidos' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem % nao encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.voyage_omissions(voyage_id, omitted_pod, discharge_pod, reason, omitted_by)
  VALUES (p_voyage_id, v_omitted, v_discharge, NULLIF(btrim(COALESCE(p_reason, '')), ''), p_changed_by)
  ON CONFLICT (voyage_id, omitted_pod)
  DO UPDATE SET
    discharge_pod = EXCLUDED.discharge_pod,
    reason = EXCLUDED.reason,
    omitted_by = EXCLUDED.omitted_by,
    omitted_at = now()
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

  INSERT INTO public.portal_notifications(customer_id, type, title, message, link)
  SELECT
    b.customer_id,
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
  FROM public.bl_transshipments t
  JOIN public.voyage_omissions o ON o.id = t.omission_id
  WHERE t.bl_id = p_bl_id AND t.omission_id = p_omission_id;

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
    INSERT INTO public.portal_notifications(customer_id, type, title, message, link)
    VALUES (
      v_customer,
      'transshipment',
      'Destino alterado (COD)',
      'A pedido, o destino final do B/L ' || p_bl_id || ' foi alterado para ' || v_discharge ||
        ' (COD), apos a omissao da escala de ' || v_omitted || '.',
      NULL
    );
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.omit_voyage_escala(BIGINT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omit_voyage_escala(BIGINT, TEXT, TEXT, TEXT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.set_bl_transshipment(TEXT, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bl_transshipment(TEXT, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.set_bl_cod(TEXT, BIGINT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bl_cod(TEXT, BIGINT, UUID) TO authenticated;
