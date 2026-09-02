-- Issue #355: a single-POD voyage may be omitted when the cargo is discharged
-- at the same operational destination before continuing by third-party vessel.
-- Keep the existing RPC contract and audit model from migration 174.

ALTER TABLE public.voyage_omissions
  DROP CONSTRAINT IF EXISTS voyage_omissions_omitted_pod_discharge_pod_check;

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

  IF v_omitted = '' OR v_discharge = '' THEN
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
  VALUES ('voyage_pod_schedule', v_entity_id, 'omitted', 'false', 'true', p_changed_by,
          'Escala omitida pelo armador; carga descarregada em ' || v_discharge);

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyage', p_voyage_id::text, 'escala_omitida', v_omitted, v_discharge, p_changed_by,
          COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Omissao de escala'));

  INSERT INTO public.bl_transshipments(bl_id, omission_id, disposition, created_by)
  SELECT b.id, v_omission_id, 'transshipment', p_changed_by
  FROM public.bls b
  WHERE b.voyage_id = p_voyage_id
    AND upper(btrim(COALESCE(b.pod, ''))) = v_omitted
  ON CONFLICT (bl_id, omission_id) DO NOTHING;

  INSERT INTO public.portal_notifications(customer_id, type, title, message, link)
  SELECT b.customer_id, 'transshipment', 'Escala omitida',
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

REVOKE ALL ON FUNCTION public.omit_voyage_escala(BIGINT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omit_voyage_escala(BIGINT, TEXT, TEXT, TEXT, UUID) TO authenticated;
