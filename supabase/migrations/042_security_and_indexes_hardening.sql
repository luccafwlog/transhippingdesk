-- 042: Hardening de segurança nas RPCs de contatos/alertas e índices de containers.
--
-- 1. SEC-02: Fecha brecha de autorização aberta em ensure_customer_contact_email
--    e customer_communication_recipient_allowed. Anteriormente a checagem
--    `IF auth.uid() IS NOT NULL AND NOT is_active_user()` não bloqueava invocações
--    quando auth.uid() fosse nulo. A guarda padronizada agora exige service_role
--    ou usuário ativo autenticado (fail-closed).
-- 2. SEC-03: Corrige list_alert_queue que chamava list_alert_queue_page com p_limit=200,
--    violando a restrição p_limit <= 100 da função de paginação.
-- 3. DB-01/DB-02: Adiciona índices em chaves estrangeiras críticas container_id
--    nas tabelas charge_calculations e demurrage_invoice_items.
-- 4. DB-04: Adiciona índice de unicidade lógica em bl_containers (bl_id, container_number).

-- ===========================================================================
-- SEC-02: Hardening de ensure_customer_contact_email
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.ensure_customer_contact_email(
  p_customer_id bigint,
  p_email text,
  p_contact_name text DEFAULT 'Contato manifesto'::text,
  p_purpose text DEFAULT 'financeiro'::text,
  p_related_bl_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_email text;
  v_has_primary boolean := false;
  v_existing record;
  v_contact_id bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND (auth.uid() IS NULL OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Acesso negado para cadastrar contato.' USING ERRCODE = '42501';
  END IF;

  IF p_customer_id IS NULL THEN
    RETURN false;
  END IF;

  v_email := lower(NULLIF(btrim(COALESCE(p_email, '')), ''));
  IF v_email IS NULL THEN
    RETURN false;
  END IF;

  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'E-mail inválido.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;

  SELECT id, is_primary, deactivated_at
  INTO v_existing
  FROM public.customer_contacts
  WHERE customer_id = p_customer_id
    AND email_normalized = v_email
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM public.customer_contacts
    WHERE customer_id = p_customer_id
      AND is_primary = true
      AND deactivated_at IS NULL
  )
  INTO v_has_primary;

  IF v_existing.id IS NOT NULL THEN
    -- Ativo ou inativo: nao duplica, nao reativa, nao altera caixas
    IF v_existing.deactivated_at IS NOT NULL AND NOT v_has_primary THEN
      PERFORM public.upsert_alert_item(
        'cliente_sem_contato_principal',
        'customer',
        p_customer_id::text,
        'Endereço reapareceu no B/L mas cadastro permanece inativo',
        'bl_automatico',
        jsonb_build_object('customer_id', p_customer_id, 'email', v_email),
        '/clientes'
      );
    END IF;
    RETURN false;
  END IF;

  INSERT INTO public.customer_contacts (
    customer_id, name, email, origin, is_primary, purpose
  )
  VALUES (
    p_customer_id,
    COALESCE(NULLIF(btrim(p_contact_name), ''), 'Contato manifesto'),
    v_email,
    'bl_automatico',
    NOT v_has_primary,
    COALESCE(NULLIF(btrim(p_purpose), ''), 'financeiro')
  )
  RETURNING id INTO v_contact_id;

  INSERT INTO public.customer_contact_box_links (contact_id, box_code)
  SELECT v_contact_id, code
  FROM public.customer_communication_boxes
  WHERE active = true
    AND (NOT v_has_primary OR code = 'documentacao_operacao');

  INSERT INTO public.customer_contact_change_events (
    customer_id, source, related_bl_id, after_snapshot, change_summary
  )
  VALUES (
    p_customer_id,
    'bl_automatico',
    p_related_bl_id,
    jsonb_build_array(jsonb_build_object(
      'id', v_contact_id,
      'email', v_email,
      'is_primary', NOT v_has_primary,
      'origin', 'bl_automatico',
      'box_codes', CASE WHEN NOT v_has_primary THEN jsonb_build_array('documentacao_operacao', 'financeiro', 'demurrage') ELSE jsonb_build_array('documentacao_operacao') END
    )),
    jsonb_build_object('action', 'bl_contact_captured', 'contact_id', v_contact_id, 'email', v_email, 'is_primary', NOT v_has_primary)
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_customer_contact_email(bigint, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_customer_contact_email(bigint, text, text, text, text) TO authenticated, service_role;

-- ===========================================================================
-- SEC-02: Hardening de customer_communication_recipient_allowed
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.customer_communication_recipient_allowed(
  p_customer_id bigint,
  p_contact_id bigint,
  p_kind text DEFAULT NULL,
  p_audience_mode text DEFAULT 'caixa',
  p_recipient_box_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_contact record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND (auth.uid() IS NULL OR NOT public.is_active_read_user()) THEN
    RAISE EXCEPTION 'Acesso negado para consultar autorização de destinatário.' USING ERRCODE = '42501';
  END IF;

  IF p_customer_id IS NULL OR p_contact_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT id, customer_id, email_normalized, deactivated_at
  INTO v_contact
  FROM public.customer_contacts
  WHERE id = p_contact_id AND customer_id = p_customer_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_contact.deactivated_at IS NOT NULL OR v_contact.email_normalized IS NULL THEN
    RETURN false;
  END IF;

  IF v_contact.email_normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.portal_suppressed_emails pse
    WHERE lower(btrim(pse.email)) = v_contact.email_normalized AND pse.reason = 'bounce_permanente'
  ) OR EXISTS (
    SELECT 1 FROM public.customer_communication_suppressions ccs
    WHERE lower(btrim(ccs.email)) = v_contact.email_normalized
  ) THEN
    RETURN false;
  END IF;

  IF p_audience_mode = 'todos' OR p_kind = 'institucional' THEN
    RETURN true;
  END IF;

  IF p_recipient_box_code IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM public.customer_contact_box_links l
      JOIN public.customer_communication_boxes b ON b.code = l.box_code
      WHERE l.contact_id = p_contact_id AND l.box_code = p_recipient_box_code AND b.active = true
    );
  END IF;

  IF p_kind IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM public.customer_contact_box_links l
      JOIN public.customer_communication_box_kinds k ON k.box_code = l.box_code
      JOIN public.customer_communication_boxes b ON b.code = l.box_code
      WHERE l.contact_id = p_contact_id AND k.kind = p_kind AND b.active = true
    );
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.customer_communication_recipient_allowed(
  bigint, bigint, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_communication_recipient_allowed(
  bigint, bigint, text, text, text
) TO authenticated, service_role;

-- ===========================================================================
-- SEC-03: Correção de paginação em list_alert_queue
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.list_alert_queue(
  p_filter text DEFAULT 'active'::text,
  p_entity_type text DEFAULT NULL::text,
  p_department text DEFAULT NULL::text
)
RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.list_alert_queue_page(p_filter, p_entity_type, 0, 100, p_department);
$$;

REVOKE ALL ON FUNCTION public.list_alert_queue(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_alert_queue(text, text, text) TO authenticated, service_role;

-- ===========================================================================
-- DB-01 / DB-02: Índices em chaves estrangeiras críticas de containers
-- ===========================================================================

CREATE INDEX IF NOT EXISTS idx_charge_calculations_container_id
  ON public.charge_calculations (container_id);

CREATE INDEX IF NOT EXISTS idx_demurrage_invoice_items_container_id
  ON public.demurrage_invoice_items (container_id);

-- ===========================================================================
-- DB-04: Restrição de unicidade lógica para contêineres dentro do mesmo B/L
-- ===========================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_bl_containers_bl_id_container_number
  ON public.bl_containers (bl_id, container_number);
