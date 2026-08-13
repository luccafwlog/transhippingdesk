-- 292: Inspeção do Portal
-- Plano: docs/archive/plans/2026-08-13-inspecao-do-portal.md
-- ADR: docs/adr/0045-inspecao-do-portal.md
--
-- A lógica existente é preservada nos *_legacy e clonada para núcleos
-- parametrizados. Os invólucros do cliente mantêm suas assinaturas e os
-- invólucros de inspeção passam pelo mesmo núcleo, com o gate interno.
-- Rollback: remover portal_inspect_*, portal_open_inspection, a tabela de
-- auditoria e restaurar os corpos dos *_legacy nos nomes públicos.

CREATE TABLE public.portal_inspection_events (
  id BIGSERIAL PRIMARY KEY,
  inspector_id UUID NOT NULL REFERENCES auth.users(id),
  customer_id BIGINT NOT NULL REFERENCES public.customers(id),
  origin TEXT NOT NULL CHECK (origin IN ('provisionamento', 'ficha')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX portal_inspection_events_customer_created_idx
  ON public.portal_inspection_events (customer_id, created_at DESC);

ALTER TABLE public.portal_inspection_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY portal_inspection_events_read_active
  ON public.portal_inspection_events FOR SELECT TO authenticated
  USING (public.is_active_read_user());

CREATE OR REPLACE FUNCTION public._portal_inspect_guard(p_customer_id BIGINT)
RETURNS BIGINT LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Inspecao do Portal requer usuario interno ativo.' USING ERRCODE = '42501';
  END IF;
  RETURN p_customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public._portal_inspect_guard(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._portal_inspect_guard(BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.portal_open_inspection(
  p_customer_id BIGINT,
  p_origin TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_origin TEXT := CASE WHEN p_origin IN ('provisionamento', 'ficha') THEN p_origin ELSE 'ficha' END;
  v_account RECORD;
  v_customer RECORD;
BEGIN
  PERFORM public._portal_inspect_guard(p_customer_id);

  INSERT INTO public.portal_inspection_events (inspector_id, customer_id, origin)
  SELECT auth.uid(), p_customer_id, v_origin
  WHERE NOT EXISTS (
    SELECT 1 FROM public.portal_inspection_events
    WHERE inspector_id = auth.uid()
      AND customer_id = p_customer_id
      AND created_at >= now() - interval '30 minutes'
  );

  SELECT a.id, a.customer_id, a.active, a.contact_email, a.login_cnpj
    INTO v_account
    FROM public.customer_portal_accounts a
   WHERE a.customer_id = p_customer_id;

  SELECT c.id, c.name, c.cnpj_cpf, c.pending_balance
    INTO v_customer
    FROM public.customers c
   WHERE c.id = p_customer_id;

  RETURN jsonb_build_object(
    'customer_id', v_customer.id,
    'customer_name', v_customer.name,
    'customer_cnpj_cpf', v_customer.cnpj_cpf,
    'cnpj_cpf', v_customer.cnpj_cpf,
    'pending_balance', v_customer.pending_balance,
    'contact_email', v_account.contact_email,
    'account_id', v_account.id,
    'account_active', COALESCE(v_account.active, false),
    'login_cnpj', v_account.login_cnpj
  );
END;
$$;

REVOKE ALL ON FUNCTION public.portal_open_inspection(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_open_inspection(BIGINT, TEXT) TO authenticated;

-- Keep the historical implementations private, then generate a parametrized
-- core from each current definition. This avoids copying an obsolete body.
-- ponytail: the core is derived from the live function body via
-- pg_get_functiondef + string replace, not written by hand. Ceiling: a
-- source body whose shape drifts from what the replace() chain expects (a
-- rename, a signature change, a new local var named like v_customer_id)
-- silently produces a core the static wrappers below can't find, only
-- surfacing when the migration is applied. Upgrade path: once the RPC set
-- stabilizes, replace this loop with explicit CREATE FUNCTION statements
-- per core, one per RPC, so a mismatch is a compile-time diff instead of a
-- runtime EXECUTE failure.
DO $migration$
DECLARE
  r RECORD;
  v_def TEXT;
  v_core TEXT;
  v_core_args TEXT;
  v_core_types TEXT;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('portal_list_invoices()'::regprocedure, 'portal_list_invoices', '()'),
    ('portal_invoice_details(bigint)'::regprocedure, 'portal_invoice_details', '(bigint)'),
    ('portal_list_demurrage_invoices()'::regprocedure, 'portal_list_demurrage_invoices', '()'),
    ('portal_get_demurrage_invoice_detail(bigint)'::regprocedure, 'portal_get_demurrage_invoice_detail', '(bigint)'),
    ('portal_list_consolidatable_receivables()'::regprocedure, 'portal_list_consolidatable_receivables', '()'),
    ('portal_get_profile()'::regprocedure, 'portal_get_profile', '()'),
    ('portal_list_notifications(integer)'::regprocedure, 'portal_list_notifications', '(integer)'),
    ('portal_notification_unread_count()'::regprocedure, 'portal_notification_unread_count', '()'),
    ('portal_get_current_roe()'::regprocedure, 'portal_get_current_roe', '()')
  ) AS x(source_fn, fn_name, fn_args)
  LOOP
    v_def := pg_get_functiondef(r.source_fn);
    EXECUTE format('ALTER FUNCTION public.%I%s RENAME TO %I', r.fn_name, r.fn_args, r.fn_name || '_legacy');
    v_core_args := CASE
      WHEN r.fn_name IN ('portal_invoice_details', 'portal_get_demurrage_invoice_detail') THEN 'p_customer_id BIGINT, p_invoice_id BIGINT'
      WHEN r.fn_name = 'portal_list_notifications' THEN 'p_customer_id BIGINT, p_limit INTEGER'
      ELSE 'p_customer_id BIGINT'
    END;
    -- ponytail: kept as a second CASE (not derived from v_core_args by
    -- stripping names) so the REVOKE's type list is visibly tied to each
    -- function's real core signature; the earlier bug here was a blanket
    -- "BIGINT, BIGINT" that silently didn't match portal_list_notifications'
    -- (BIGINT, INTEGER) core, only surfacing when the migration ran for real.
    v_core_types := CASE
      WHEN r.fn_name IN ('portal_invoice_details', 'portal_get_demurrage_invoice_detail') THEN 'BIGINT, BIGINT'
      WHEN r.fn_name = 'portal_list_notifications' THEN 'BIGINT, INTEGER'
      ELSE 'BIGINT'
    END;
    v_core := regexp_replace(v_def,
      'CREATE OR REPLACE FUNCTION public\.' || r.fn_name || '\([^)]*\)',
      'CREATE FUNCTION public._' || r.fn_name || '_core(' || v_core_args || ')', 1, 1);
    v_core := replace(v_core, 'v_customer_id bigint := public.current_portal_customer_id();', '');
    v_core := replace(v_core, 'public.current_portal_customer_id()', 'p_customer_id');
    v_core := replace(v_core, 'v_customer_id', 'p_customer_id');
    EXECUTE v_core;
    EXECUTE format('REVOKE ALL ON FUNCTION public._%I_core(%s) FROM PUBLIC, anon, authenticated', r.fn_name, v_core_types);
  END LOOP;
END;
$migration$;

-- The operation read model has an inner function that owns the customer
-- filter. Clone it first and make the outer core call the parametrized inner.
ALTER FUNCTION public.portal_list_operation_bls_without_transshipment()
  RENAME TO portal_list_operation_bls_without_transshipment_legacy;
DO $migration$
DECLARE v_def TEXT;
BEGIN
  v_def := pg_get_functiondef('public.portal_list_operation_bls_without_transshipment_legacy()'::regprocedure);
  v_def := replace(v_def, 'CREATE OR REPLACE FUNCTION public.portal_list_operation_bls_without_transshipment_legacy()', 'CREATE FUNCTION public._portal_list_operation_bls_without_transshipment_core(p_customer_id BIGINT)');
  v_def := replace(v_def, 'v_customer_id bigint := public.current_portal_customer_id();', '');
  v_def := replace(v_def, 'public.current_portal_customer_id()', 'p_customer_id');
  v_def := replace(v_def, 'v_customer_id', 'p_customer_id');
  EXECUTE v_def;
END;
$migration$;

ALTER FUNCTION public.portal_list_operation_bls()
  RENAME TO portal_list_operation_bls_legacy;
DO $migration$
DECLARE v_def TEXT;
BEGIN
  v_def := pg_get_functiondef('public.portal_list_operation_bls_legacy()'::regprocedure);
  v_def := replace(v_def, 'CREATE OR REPLACE FUNCTION public.portal_list_operation_bls_legacy()', 'CREATE FUNCTION public._portal_list_operation_bls_core(p_customer_id BIGINT)');
  v_def := replace(v_def, 'public.portal_list_operation_bls_without_transshipment()', 'public._portal_list_operation_bls_without_transshipment_core(p_customer_id)');
  EXECUTE v_def;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.portal_list_invoices()
RETURNS TABLE(id BIGINT, invoice_number TEXT, issued_at TIMESTAMPTZ, due_date DATE, total_brl NUMERIC, total_paid_brl NUMERIC, balance_brl NUMERIC, status TEXT, invoice_type TEXT, vessels TEXT[], voyages TEXT[], vessel_voyages TEXT[], bls TEXT[], pods TEXT[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN RETURN QUERY SELECT * FROM public._portal_list_invoices_core(public.current_portal_customer_id()); END; $$;
CREATE OR REPLACE FUNCTION public.portal_invoice_details(p_invoice_id BIGINT) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN RETURN public._portal_invoice_details_core(public.current_portal_customer_id(), p_invoice_id); END; $$;
CREATE OR REPLACE FUNCTION public.portal_list_demurrage_invoices() RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN RETURN public._portal_list_demurrage_invoices_core(public.current_portal_customer_id()); END; $$;
CREATE OR REPLACE FUNCTION public.portal_get_demurrage_invoice_detail(p_invoice_id BIGINT) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN RETURN public._portal_get_demurrage_invoice_detail_core(public.current_portal_customer_id(), p_invoice_id); END; $$;
CREATE OR REPLACE FUNCTION public.portal_list_consolidatable_receivables() RETURNS TABLE(receivable_id BIGINT, bl_id TEXT, customer_id BIGINT, customer_name TEXT, customer_cnpj_cpf TEXT, voyage_id BIGINT, vessel_name TEXT, voyage_number TEXT, individual_invoice_id BIGINT, individual_invoice_number TEXT, balance_brl NUMERIC, original_amount_brl NUMERIC, receivable_status TEXT, eligibility_status TEXT, eligibility_reason TEXT) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN RETURN QUERY SELECT * FROM public._portal_list_consolidatable_receivables_core(public.current_portal_customer_id()); END; $$;
CREATE OR REPLACE FUNCTION public.portal_get_profile() RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN RETURN public._portal_get_profile_core(public.current_portal_customer_id()); END; $$;
CREATE OR REPLACE FUNCTION public.portal_list_notifications(p_limit INTEGER DEFAULT 20) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN RETURN public._portal_list_notifications_core(public.current_portal_customer_id(), p_limit); END; $$;
CREATE OR REPLACE FUNCTION public.portal_notification_unread_count() RETURNS INTEGER LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN RETURN public._portal_notification_unread_count_core(public.current_portal_customer_id()); END; $$;
CREATE OR REPLACE FUNCTION public.portal_get_current_roe() RETURNS TABLE(roe NUMERIC, updated_at TIMESTAMPTZ) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN RETURN QUERY SELECT * FROM public._portal_get_current_roe_core(public.current_portal_customer_id()); END; $$;
CREATE OR REPLACE FUNCTION public.portal_list_operation_bls() RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN RETURN public._portal_list_operation_bls_core(public.current_portal_customer_id()); END; $$;

CREATE OR REPLACE FUNCTION public.portal_inspect_list_invoices(p_customer_id BIGINT) RETURNS TABLE(id BIGINT, invoice_number TEXT, issued_at TIMESTAMPTZ, due_date DATE, total_brl NUMERIC, total_paid_brl NUMERIC, balance_brl NUMERIC, status TEXT, invoice_type TEXT, vessels TEXT[], voyages TEXT[], vessel_voyages TEXT[], bls TEXT[], pods TEXT[]) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN RETURN QUERY SELECT * FROM public._portal_list_invoices_core(public._portal_inspect_guard(p_customer_id)); END; $$;
CREATE OR REPLACE FUNCTION public.portal_inspect_invoice_details(p_customer_id BIGINT, p_invoice_id BIGINT) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN RETURN public._portal_invoice_details_core(public._portal_inspect_guard(p_customer_id), p_invoice_id); END; $$;
CREATE OR REPLACE FUNCTION public.portal_inspect_list_demurrage_invoices(p_customer_id BIGINT) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN RETURN public._portal_list_demurrage_invoices_core(public._portal_inspect_guard(p_customer_id)); END; $$;
CREATE OR REPLACE FUNCTION public.portal_inspect_get_demurrage_invoice_detail(p_customer_id BIGINT, p_invoice_id BIGINT) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN RETURN public._portal_get_demurrage_invoice_detail_core(public._portal_inspect_guard(p_customer_id), p_invoice_id); END; $$;
CREATE OR REPLACE FUNCTION public.portal_inspect_list_consolidatable_receivables(p_customer_id BIGINT) RETURNS TABLE(receivable_id BIGINT, bl_id TEXT, customer_id BIGINT, customer_name TEXT, customer_cnpj_cpf TEXT, voyage_id BIGINT, vessel_name TEXT, voyage_number TEXT, individual_invoice_id BIGINT, individual_invoice_number TEXT, balance_brl NUMERIC, original_amount_brl NUMERIC, receivable_status TEXT, eligibility_status TEXT, eligibility_reason TEXT) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN RETURN QUERY SELECT * FROM public._portal_list_consolidatable_receivables_core(public._portal_inspect_guard(p_customer_id)); END; $$;
CREATE OR REPLACE FUNCTION public.portal_inspect_list_operation_bls(p_customer_id BIGINT) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN RETURN public._portal_list_operation_bls_core(public._portal_inspect_guard(p_customer_id)); END; $$;
CREATE OR REPLACE FUNCTION public.portal_inspect_get_profile(p_customer_id BIGINT) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN RETURN public._portal_get_profile_core(public._portal_inspect_guard(p_customer_id)); END; $$;
CREATE OR REPLACE FUNCTION public.portal_inspect_list_notifications(p_customer_id BIGINT, p_limit INTEGER DEFAULT 20) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN RETURN public._portal_list_notifications_core(public._portal_inspect_guard(p_customer_id), p_limit); END; $$;
CREATE OR REPLACE FUNCTION public.portal_inspect_notification_unread_count(p_customer_id BIGINT) RETURNS INTEGER LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN RETURN public._portal_notification_unread_count_core(public._portal_inspect_guard(p_customer_id)); END; $$;
CREATE OR REPLACE FUNCTION public.portal_inspect_get_current_roe(p_customer_id BIGINT) RETURNS TABLE(roe NUMERIC, updated_at TIMESTAMPTZ) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN PERFORM public._portal_inspect_guard(p_customer_id); RETURN QUERY SELECT * FROM public._portal_get_current_roe_core(p_customer_id); END; $$;

REVOKE ALL ON FUNCTION public._portal_list_operation_bls_without_transshipment_core(BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._portal_list_operation_bls_core(BIGINT) FROM PUBLIC, anon, authenticated;

DO $grants$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT proname, pg_get_function_identity_arguments(oid) args FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND (proname LIKE 'portal_inspect_%' OR proname LIKE '_portal_%_core') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', r.proname, r.args);
  END LOOP;
END;
$grants$;

GRANT EXECUTE ON FUNCTION public.portal_list_invoices() TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_invoice_details(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_demurrage_invoices() TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_demurrage_invoice_detail(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_consolidatable_receivables() TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_operation_bls() TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_notifications(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_notification_unread_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_current_roe() TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_inspect_list_invoices(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_inspect_invoice_details(BIGINT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_inspect_list_demurrage_invoices(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_inspect_get_demurrage_invoice_detail(BIGINT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_inspect_list_consolidatable_receivables(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_inspect_list_operation_bls(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_inspect_get_profile(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_inspect_list_notifications(BIGINT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_inspect_notification_unread_count(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_inspect_get_current_roe(BIGINT) TO authenticated;

-- Equipamentos can discover the same full provisioning view, but must not
-- trigger its self-heal writes; the event history is readable too. Operações
-- already had console access with masked fields (the only profile short of
-- v_full_access besides Equipamentos before this migration); it now gets the
-- same unmasked fields, keeping the ADR 0044 "read is global" line applied
-- uniformly instead of leaving one department as the odd one out.
ALTER FUNCTION public.portal_list_provisioning_console(BIGINT) RENAME TO portal_list_provisioning_console_legacy;
ALTER FUNCTION public.portal_list_provisioning_events(BIGINT, INTEGER) RENAME TO portal_list_provisioning_events_legacy;

DO $provisioning$
DECLARE v_def TEXT;
BEGIN
  v_def := pg_get_functiondef('public.portal_list_provisioning_console_legacy(bigint)'::regprocedure);
  v_def := replace(v_def, 'CREATE OR REPLACE FUNCTION public.portal_list_provisioning_console_legacy(p_customer_id bigint DEFAULT NULL)', 'CREATE FUNCTION public.portal_list_provisioning_console(p_customer_id BIGINT DEFAULT NULL)');
  v_def := replace(v_def, 'v_full_access BOOLEAN := v_role IN (''administrativo'',''documentacao'',''financeiro'');', 'v_full_access BOOLEAN := v_role IN (''administrativo'',''documentacao'',''financeiro'',''equipamentos'',''operacoes'');');
  v_def := replace(v_def, 'v_role NOT IN (''administrativo'',''documentacao'',''financeiro'',''operacoes'')', 'v_role NOT IN (''administrativo'',''documentacao'',''financeiro'',''operacoes'',''equipamentos'')');
  v_def := replace(v_def, '  PERFORM public.portal_repair_missing_accounts();', '  IF v_role <> ''equipamentos'' THEN\n    PERFORM public.portal_repair_missing_accounts();\n  END IF;');
  EXECUTE v_def;

  v_def := pg_get_functiondef('public.portal_list_provisioning_events_legacy(bigint,integer)'::regprocedure);
  v_def := replace(v_def, 'CREATE OR REPLACE FUNCTION public.portal_list_provisioning_events_legacy(p_customer_id bigint, p_limit integer DEFAULT 10)', 'CREATE FUNCTION public.portal_list_provisioning_events(p_customer_id BIGINT, p_limit INTEGER DEFAULT 10)');
  v_def := replace(v_def, 'v_role NOT IN (''administrativo'',''documentacao'',''financeiro'')', 'v_role NOT IN (''administrativo'',''documentacao'',''financeiro'',''equipamentos'')');
  EXECUTE v_def;
END;
$provisioning$;

REVOKE ALL ON FUNCTION public.portal_list_provisioning_console(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_list_provisioning_console(BIGINT) TO authenticated;
REVOKE ALL ON FUNCTION public.portal_list_provisioning_events(BIGINT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_list_provisioning_events(BIGINT, INTEGER) TO authenticated;
