-- 208: Fecha achados P1 da auditoria pos-merge dos PRs #405/#406 (405-01,
-- 406-01) e o achado P2 405-02: escritas de COD/transbordo e de
-- clientes/contatos eram autorizadas apenas no frontend, com RPCs e RLS
-- aceitando qualquer usuario ativo. Espelha o mapeamento de permissoes de
-- roleHasPermission() em src/hooks/useAuth.tsx (voyages_edit, customers_edit),
-- incluindo o mapeamento legado admin=administrativo, operator=documentacao.

CREATE OR REPLACE FUNCTION public.can_edit_voyages()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE id = auth.uid()
      AND active = true
      AND role IN ('admin', 'administrativo', 'operator', 'documentacao', 'operacoes')
  );
$$;

REVOKE ALL ON FUNCTION public.can_edit_voyages() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_edit_voyages() TO authenticated;

CREATE OR REPLACE FUNCTION public.can_edit_customers()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE id = auth.uid()
      AND active = true
      AND role IN ('admin', 'administrativo', 'operator', 'documentacao')
  );
$$;

REVOKE ALL ON FUNCTION public.can_edit_customers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_edit_customers() TO authenticated;

-- 405-01: set_bl_cod e set_bl_transshipment passam a exigir voyages_edit.
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
  IF NOT public.can_edit_voyages() THEN
    RAISE EXCEPTION 'Usuario sem permissao para alterar disposicao de B/L.' USING ERRCODE = '42501';
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
  IF NOT public.can_edit_voyages() THEN
    RAISE EXCEPTION 'Usuario sem permissao para alterar disposicao de B/L.' USING ERRCODE = '42501';
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

REVOKE ALL ON FUNCTION public.set_bl_cod(TEXT, BIGINT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bl_cod(TEXT, BIGINT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.set_bl_transshipment(TEXT, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bl_transshipment(TEXT, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;

-- 405-02: a migration 206 recriou omit_voyage_escala com a assinatura antiga de
-- 5 argumentos (droppada em 201) em vez do overload de 10 argumentos que o
-- cliente chama; a insercao com bl_id ficou no overload morto. Remove o
-- overload de 5 argumentos e reaplica o de 10 com bl_id na notificacao.
DROP FUNCTION IF EXISTS public.omit_voyage_escala(BIGINT, TEXT, TEXT, TEXT, UUID);

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

REVOKE ALL ON FUNCTION public.omit_voyage_escala(BIGINT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omit_voyage_escala(BIGINT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- 406-01: customers/customer_contacts INSERT/UPDATE exigem customers_edit
-- (administrativo/documentacao), nao apenas usuario ativo. SELECT/DELETE nao
-- mudam aqui — nao foram apontados como quebrados pela auditoria.
DROP POLICY IF EXISTS customers_insert_active ON public.customers;
CREATE POLICY customers_insert_active ON public.customers
  FOR INSERT TO authenticated WITH CHECK (public.can_edit_customers());

DROP POLICY IF EXISTS customers_update_active ON public.customers;
CREATE POLICY customers_update_active ON public.customers
  FOR UPDATE TO authenticated USING (public.can_edit_customers()) WITH CHECK (public.can_edit_customers());

DROP POLICY IF EXISTS customer_contacts_insert_active ON public.customer_contacts;
CREATE POLICY customer_contacts_insert_active ON public.customer_contacts
  FOR INSERT TO authenticated WITH CHECK (public.can_edit_customers());

DROP POLICY IF EXISTS customer_contacts_update_active ON public.customer_contacts;
CREATE POLICY customer_contacts_update_active ON public.customer_contacts
  FOR UPDATE TO authenticated USING (public.can_edit_customers()) WITH CHECK (public.can_edit_customers());

-- update_customer_with_audit e SECURITY INVOKER (sujeita a RLS acima), mas
-- reforca a checagem explicitamente para retornar um erro claro em vez de
-- depender apenas do efeito colateral do UPDATE bloqueado pela RLS.
CREATE OR REPLACE FUNCTION public.update_customer_with_audit(
  p_customer_id BIGINT,
  p_updates JSONB,
  p_changed_by UUID,
  p_justification TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_before public.customers%ROWTYPE;
  v_after public.customers%ROWTYPE;
  v_invalid_key TEXT;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para editar cliente.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_edit_customers() THEN
    RAISE EXCEPTION 'Usuario sem permissao para editar cliente.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_justification, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para editar cliente.' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_updates) <> 'object' OR p_updates = '{}'::JSONB THEN
    RETURN FALSE;
  END IF;

  SELECT key INTO v_invalid_key
  FROM jsonb_object_keys(p_updates) AS key
  WHERE key NOT IN ('name', 'trade_name', 'address', 'city', 'state', 'zip', 'notes')
  LIMIT 1;

  IF v_invalid_key IS NOT NULL THEN
    RAISE EXCEPTION 'Campo de cliente nao editavel: %.', v_invalid_key USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_before FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente % nao encontrado.', p_customer_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.customers SET
    name = CASE WHEN p_updates ? 'name' THEN p_updates->>'name' ELSE name END,
    trade_name = CASE WHEN p_updates ? 'trade_name' THEN NULLIF(p_updates->>'trade_name', '') ELSE trade_name END,
    address = CASE WHEN p_updates ? 'address' THEN NULLIF(p_updates->>'address', '') ELSE address END,
    city = CASE WHEN p_updates ? 'city' THEN NULLIF(p_updates->>'city', '') ELSE city END,
    state = CASE WHEN p_updates ? 'state' THEN NULLIF(p_updates->>'state', '') ELSE state END,
    zip = CASE WHEN p_updates ? 'zip' THEN NULLIF(p_updates->>'zip', '') ELSE zip END,
    notes = CASE WHEN p_updates ? 'notes' THEN NULLIF(p_updates->>'notes', '') ELSE notes END
  WHERE id = p_customer_id
  RETURNING * INTO v_after;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  SELECT 'customer', p_customer_id::TEXT, changed.field_name, changed.old_value, changed.new_value,
    p_changed_by, BTRIM(p_justification)
  FROM (VALUES
    ('name', v_before.name, v_after.name),
    ('trade_name', v_before.trade_name, v_after.trade_name),
    ('address', v_before.address, v_after.address),
    ('city', v_before.city, v_after.city),
    ('state', v_before.state, v_after.state),
    ('zip', v_before.zip, v_after.zip),
    ('notes', v_before.notes, v_after.notes)
  ) AS changed(field_name, old_value, new_value)
  WHERE p_updates ? changed.field_name
    AND changed.old_value IS DISTINCT FROM changed.new_value;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.update_customer_with_audit(BIGINT, JSONB, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_customer_with_audit(BIGINT, JSONB, UUID, TEXT) TO authenticated;
