-- Migration 050: Alinhamentos de contrato e regras de negocio
--
-- 1) Granito:
--    - valida cliente unico por lote na emissao
--    - bloqueia BL sem cliente vinculado
--    - adiciona sobrecarga de compatibilidade com p_issue_now (clientes antigos)
-- 2) Portal:
--    - normaliza documento em portal_check_auth_method
--    - alinha payload de portal_get_session_overview_v2 ao contrato do frontend
-- 3) Demurrage:
--    - ajusta RLS para escrita por usuarios ativos (coerente com permissao demurrage_edit no app)

------------------------------------------------------------------------
-- 1) Granito: emissao de invoice com validacoes de cliente
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_invoice_from_granite_bls(
  p_granite_bl_ids UUID[],
  p_customer_id    BIGINT DEFAULT NULL,
  p_due_date       DATE   DEFAULT NULL,
  p_notes          TEXT   DEFAULT NULL,
  p_actor          UUID   DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_id             BIGINT;
  v_invoice_id              BIGINT;
  v_invoice_number          TEXT;
  v_total_brl               NUMERIC(14,2);
  v_bl_count                INT;
  v_distinct_customer_count INT;
  v_missing_customer_count  INT;
BEGIN
  IF p_granite_bl_ids IS NULL OR array_length(p_granite_bl_ids, 1) = 0 THEN
    RAISE EXCEPTION 'PT409: Nenhum B/L Granito selecionado.';
  END IF;

  IF (SELECT COUNT(*) FROM public.granite_bls WHERE id = ANY(p_granite_bl_ids)) <> array_length(p_granite_bl_ids, 1) THEN
    RAISE EXCEPTION 'PT409: Um ou mais B/Ls Granito nao foram encontrados.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.granite_bls
    WHERE id = ANY(p_granite_bl_ids)
      AND charge_status <> 'ready_for_billing'
  ) THEN
    RAISE EXCEPTION 'PT409: Um ou mais B/Ls Granito nao estao prontos para faturar (charge_status != ready_for_billing).';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoice_granite_bls
    WHERE granite_bl_id = ANY(p_granite_bl_ids)
  ) THEN
    RAISE EXCEPTION 'PT409: Um ou mais B/Ls Granito ja estao vinculados a uma invoice.';
  END IF;

  SELECT
    COUNT(DISTINCT client_id) FILTER (WHERE client_id IS NOT NULL),
    COUNT(*) FILTER (WHERE client_id IS NULL)
  INTO v_distinct_customer_count, v_missing_customer_count
  FROM public.granite_bls
  WHERE id = ANY(p_granite_bl_ids);

  IF p_customer_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.granite_bls
      WHERE id = ANY(p_granite_bl_ids)
        AND client_id IS DISTINCT FROM p_customer_id
    ) THEN
      RAISE EXCEPTION 'PT409: Existem B/Ls de clientes diferentes no lote selecionado.';
    END IF;
    v_customer_id := p_customer_id;
  ELSE
    IF v_missing_customer_count > 0 THEN
      RAISE EXCEPTION 'PT409: Um ou mais B/Ls Granito nao possuem cliente vinculado.';
    END IF;

    IF v_distinct_customer_count <> 1 THEN
      RAISE EXCEPTION 'PT409: Os B/Ls selecionados precisam pertencer a um unico cliente.';
    END IF;

    SELECT DISTINCT client_id
    INTO v_customer_id
    FROM public.granite_bls
    WHERE id = ANY(p_granite_bl_ids)
    LIMIT 1;
  END IF;

  SELECT COALESCE(SUM(c.subtotal), 0)
  INTO v_total_brl
  FROM public.granite_bl_charges c
  WHERE c.bl_id = ANY(p_granite_bl_ids);

  v_bl_count := array_length(p_granite_bl_ids, 1);

  INSERT INTO public.invoices (
    customer_id, issued_at, due_date, total_brl, status,
    notes, total_paid_brl, balance_brl, issued_by
  )
  VALUES (
    v_customer_id,
    now(),
    p_due_date,
    v_total_brl,
    'issued',
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    0,
    v_total_brl,
    p_actor
  )
  RETURNING id, invoice_number
  INTO v_invoice_id, v_invoice_number;

  INSERT INTO public.invoice_granite_bls (invoice_id, granite_bl_id, subtotal_brl)
  SELECT
    v_invoice_id,
    gb.id,
    COALESCE(charges.total, 0)
  FROM public.granite_bls gb
  LEFT JOIN (
    SELECT bl_id, SUM(subtotal) AS total
    FROM public.granite_bl_charges
    WHERE bl_id = ANY(p_granite_bl_ids)
    GROUP BY bl_id
  ) charges ON charges.bl_id = gb.id
  WHERE gb.id = ANY(p_granite_bl_ids);

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_value_brl, total_value_brl)
  SELECT
    v_invoice_id,
    CONCAT('Granito BL ', gb.bl_number, ' - ', COALESCE(c.description, 'Taxa')),
    COALESCE(c.quantity, 1),
    COALESCE(c.unit_value, 0),
    COALESCE(c.subtotal, 0)
  FROM public.granite_bl_charges c
  JOIN public.granite_bls gb ON gb.id = c.bl_id
  WHERE c.bl_id = ANY(p_granite_bl_ids)
    AND COALESCE(c.subtotal, 0) > 0;

  UPDATE public.granite_bls
  SET charge_status = 'invoiced'
  WHERE id = ANY(p_granite_bl_ids);

  RETURN jsonb_build_object(
    'invoice_id',     v_invoice_id,
    'invoice_number', v_invoice_number,
    'total_brl',      v_total_brl::TEXT,
    'bl_count',       v_bl_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice_from_granite_bls(UUID[], BIGINT, DATE, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_granite_bls(UUID[], BIGINT, DATE, TEXT, UUID) TO authenticated;

-- Compatibilidade: clientes antigos ainda podem enviar p_issue_now.
CREATE OR REPLACE FUNCTION public.create_invoice_from_granite_bls(
  p_granite_bl_ids UUID[],
  p_customer_id    BIGINT,
  p_due_date       DATE,
  p_notes          TEXT,
  p_issue_now      BOOLEAN,
  p_actor          UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(p_issue_now, true) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PT409: Emissao diferida nao suportada para faturamento de granito.';
  END IF;

  RETURN public.create_invoice_from_granite_bls(
    p_granite_bl_ids => p_granite_bl_ids,
    p_customer_id    => p_customer_id,
    p_due_date       => p_due_date,
    p_notes          => p_notes,
    p_actor          => p_actor
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice_from_granite_bls(UUID[], BIGINT, DATE, TEXT, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_granite_bls(UUID[], BIGINT, DATE, TEXT, BOOLEAN, UUID) TO authenticated;

------------------------------------------------------------------------
-- 2) Portal: alinhamento de contrato e normalizacao de documento
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.portal_get_session_overview_v2()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account  RECORD;
  v_customer RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  SELECT a.id, a.customer_id, a.active, a.contact_email
  INTO v_account
  FROM public.customer_portal_accounts AS a
  WHERE a.auth_user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  IF NOT v_account.active THEN
    RAISE EXCEPTION 'Acesso ao portal desativado. Entre em contato com o suporte.' USING ERRCODE = '28000';
  END IF;

  SELECT c.id, c.name, c.cnpj_cpf, c.pending_balance
  INTO v_customer
  FROM public.customers AS c
  WHERE c.id = v_account.customer_id;

  UPDATE public.customer_portal_accounts
  SET last_login_at = now()
  WHERE id = v_account.id;

  RETURN jsonb_build_object(
    'customer_id',       v_customer.id,
    'customer_name',     v_customer.name,
    'customer_cnpj_cpf', v_customer.cnpj_cpf,
    'cnpj_cpf',          v_customer.cnpj_cpf,
    'pending_balance',   v_customer.pending_balance,
    'contact_email',     v_account.contact_email,
    'account_id',        v_account.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.portal_get_session_overview_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_get_session_overview_v2() TO authenticated;

CREATE OR REPLACE FUNCTION public.portal_check_auth_method(p_cnpj_cpf TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account RECORD;
  v_cnpj_norm TEXT;
BEGIN
  v_cnpj_norm := public.normalize_document_text(COALESCE(p_cnpj_cpf, ''));

  SELECT a.auth_user_id, a.portal_email, a.active
  INTO v_account
  FROM public.customer_portal_accounts AS a
  JOIN public.customers AS c ON c.id = a.customer_id
  WHERE public.normalize_document_text(c.cnpj_cpf) = v_cnpj_norm;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('method', 'none', 'active', false);
  END IF;

  IF NOT v_account.active THEN
    RETURN jsonb_build_object('method', 'inactive', 'active', false);
  END IF;

  IF v_account.auth_user_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'method', 'supabase_auth',
      'portal_email', v_account.portal_email,
      'active', true
    );
  END IF;

  RETURN jsonb_build_object('method', 'legacy_token', 'active', true);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_check_auth_method(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_check_auth_method(TEXT) TO anon, authenticated;

------------------------------------------------------------------------
-- 3) Demurrage: RLS de escrita para usuarios ativos
------------------------------------------------------------------------

DROP POLICY IF EXISTS demurrage_invoices_insert_admin ON public.demurrage_invoices;
DROP POLICY IF EXISTS demurrage_invoices_update_admin ON public.demurrage_invoices;
DROP POLICY IF EXISTS demurrage_invoices_delete_admin ON public.demurrage_invoices;
DROP POLICY IF EXISTS demurrage_invoices_insert_active ON public.demurrage_invoices;
DROP POLICY IF EXISTS demurrage_invoices_update_active ON public.demurrage_invoices;

CREATE POLICY demurrage_invoices_insert_active
  ON public.demurrage_invoices FOR INSERT
  TO authenticated WITH CHECK (public.is_active_user());

CREATE POLICY demurrage_invoices_update_active
  ON public.demurrage_invoices FOR UPDATE
  TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());

CREATE POLICY demurrage_invoices_delete_admin
  ON public.demurrage_invoices FOR DELETE
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS demurrage_items_insert_admin ON public.demurrage_invoice_items;
DROP POLICY IF EXISTS demurrage_items_update_admin ON public.demurrage_invoice_items;
DROP POLICY IF EXISTS demurrage_items_delete_admin ON public.demurrage_invoice_items;
DROP POLICY IF EXISTS demurrage_items_insert_active ON public.demurrage_invoice_items;
DROP POLICY IF EXISTS demurrage_items_update_active ON public.demurrage_invoice_items;

CREATE POLICY demurrage_items_insert_active
  ON public.demurrage_invoice_items FOR INSERT
  TO authenticated WITH CHECK (public.is_active_user());

CREATE POLICY demurrage_items_update_active
  ON public.demurrage_invoice_items FOR UPDATE
  TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());

CREATE POLICY demurrage_items_delete_admin
  ON public.demurrage_invoice_items FOR DELETE
  TO authenticated USING (public.is_admin());
