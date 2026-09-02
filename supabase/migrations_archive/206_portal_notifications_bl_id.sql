-- 206_portal_notifications_bl_id.sql
-- Vincula notificacoes do Portal ao B/L de origem (forward-only).
ALTER TABLE public.portal_notifications ADD COLUMN IF NOT EXISTS bl_id TEXT
  REFERENCES public.bls(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_portal_notifications_bl
  ON public.portal_notifications (bl_id, created_at DESC);



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

  INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
  SELECT
    b.customer_id, b.id,
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

CREATE OR REPLACE FUNCTION public.get_bl_portal_status(p_bl_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_customer_id BIGINT;
  v_ce_mercante TEXT;
  v_account_situation TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT b.customer_id, b.ce_mercante
  INTO v_customer_id, v_ce_mercante
  FROM public.bls b
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  SELECT a.account_situation
  INTO v_account_situation
  FROM public.customer_portal_accounts a
  WHERE a.customer_id = v_customer_id;

  RETURN jsonb_build_object(
    'customer_id', v_customer_id,
    'ce_mercante', v_ce_mercante,
    'account_situation', v_account_situation,
    'notifications', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id,
        'type', n.type,
        'title', n.title,
        'created_at', n.created_at,
        'read_at', n.read_at
      ) ORDER BY n.created_at DESC)
      FROM (
        SELECT id, type, title, created_at, read_at
        FROM public.portal_notifications
        WHERE bl_id = p_bl_id
        ORDER BY created_at DESC
        LIMIT 10
      ) n
    ), '[]'::JSONB),
    'open_disputes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id,
        'doc_number', d.doc_number,
        'dispute_status', d.dispute_status
      ) ORDER BY d.id DESC)
      FROM public.demurrage_invoices d
      WHERE d.bl_id = p_bl_id
        AND d.dispute_open = true
    ), '[]'::JSONB)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_bl_portal_status(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bl_portal_status(TEXT) TO authenticated;
