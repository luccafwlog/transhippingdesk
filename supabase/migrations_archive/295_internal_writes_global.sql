-- 295: remove a barreira departamental de escrita interna.
-- Exclusão operacional, Portal e administração de usuários permanecem exceções.

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;

-- Atualiza as policies que herdaram os helpers do modelo departamental. DELETE
-- é reconstruído explicitamente com is_admin(): o rastro prova a exclusão,
-- mas não desfaz a perda de um registro operacional.
DO $$
DECLARE
  p RECORD;
  v_roles TEXT;
  v_qual TEXT;
  v_check TEXT;
  v_name TEXT;
  v_read TEXT;
  v_write TEXT;
BEGIN
  FOR p IN
    SELECT * FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        COALESCE(qual, '') ~ 'is_active_non_equipamentos_user|is_equipamentos_user|can_edit_' OR
        COALESCE(with_check, '') ~ 'is_active_non_equipamentos_user|is_equipamentos_user|can_edit_' OR
        lower(regexp_replace(COALESCE(qual, ''), '[[:space:]()]', '', 'g')) LIKE '%auth.role=''authenticated''%' OR
        lower(regexp_replace(COALESCE(with_check, ''), '[[:space:]()]', '', 'g')) LIKE '%auth.role=''authenticated''%'
      )
  LOOP
    v_roles := array_to_string(p.roles, ', ');
    v_qual := COALESCE(p.qual, 'true');
    v_check := COALESCE(p.with_check, 'true');
    v_read := replace(replace(replace(replace(replace(v_qual,
      'public.is_active_non_equipamentos_user()', 'public.is_active_user()'),
      'public.is_equipamentos_user()', 'public.is_active_user()'),
      'public.can_edit_voyages()', 'public.is_active_user()'),
      'public.can_edit_customers()', 'public.is_active_user()'),
      'public.can_edit_local_charges()', 'public.is_active_user()');
    v_read := replace(replace(replace(replace(v_read,
      'can_edit_voyages()', 'public.is_active_user()'), 'can_edit_customers()', 'public.is_active_user()'),
      'can_edit_local_charges()', 'public.is_active_user()'), 'can_edit_depots()', 'public.is_active_user()');
    v_read := replace(replace(v_read, 'is_active_non_equipamentos_user()', 'public.is_active_user()'), 'is_equipamentos_user()', 'public.is_active_user()');
    v_write := replace(replace(replace(replace(replace(v_check,
      'public.is_active_non_equipamentos_user()', 'public.is_active_user()'),
      'public.is_equipamentos_user()', 'public.is_active_user()'),
      'public.can_edit_voyages()', 'public.is_active_user()'),
      'public.can_edit_customers()', 'public.is_active_user()'),
      'public.can_edit_local_charges()', 'public.is_active_user()');
    v_write := replace(replace(replace(replace(v_write,
      'can_edit_voyages()', 'public.is_active_user()'), 'can_edit_customers()', 'public.is_active_user()'),
      'can_edit_local_charges()', 'public.is_active_user()'), 'can_edit_depots()', 'public.is_active_user()');
    v_write := replace(replace(v_write, 'is_active_non_equipamentos_user()', 'public.is_active_user()'), 'is_equipamentos_user()', 'public.is_active_user()');
    IF p.cmd = 'DELETE' THEN
      v_read := 'public.is_admin()';
    END IF;
    IF p.cmd IN ('SELECT', 'ALL') AND lower(regexp_replace(v_read, '[[:space:]()]', '', 'g')) LIKE '%auth.role%authenticated%' THEN
      v_read := 'public.is_active_read_user()';
    END IF;
    IF p.cmd IN ('INSERT', 'UPDATE', 'ALL') AND lower(regexp_replace(v_write, '[[:space:]()]', '', 'g')) LIKE '%auth.role%authenticated%' THEN
      v_write := 'public.is_active_user()';
    END IF;

    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
    v_name := left(p.policyname, 45) || '_global';
    IF p.cmd = 'SELECT' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO %s USING (%s)', v_name, p.tablename, v_roles, v_read);
    ELSIF p.cmd = 'INSERT' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO %s WITH CHECK (%s)', v_name, p.tablename, v_roles, v_write);
    ELSIF p.cmd = 'UPDATE' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO %s USING (%s) WITH CHECK (%s)', v_name, p.tablename, v_roles, v_read, v_write);
    ELSIF p.cmd = 'DELETE' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO %s USING (%s)', v_name, p.tablename, v_roles, v_read);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO %s USING (%s)', v_name || '_select', p.tablename, v_roles, v_read);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO %s WITH CHECK (%s)', v_name || '_insert', p.tablename, v_roles, v_write);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO %s USING (%s) WITH CHECK (%s)', v_name || '_update', p.tablename, v_roles, v_read, v_write);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO %s USING (public.is_admin())', v_name || '_delete', p.tablename, v_roles);
    END IF;
  END LOOP;
END $$;

-- RPCs usam os mesmos helpers fora das policies. Reescrever o corpo preserva
-- assinaturas, grants e validações de estado já existentes.
DO $$
DECLARE
  f RECORD;
  v_def TEXT;
BEGIN
  FOR f IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname NOT IN ('is_active_user', 'is_active_non_equipamentos_user', 'is_equipamentos_user', 'can_edit_voyages', 'can_edit_customers', 'can_edit_local_charges', 'can_edit_depots')
      AND pg_get_functiondef(p.oid) ~ 'is_active_non_equipamentos_user|is_equipamentos_user|can_edit_(voyages|customers|local_charges|depots)'
  LOOP
    v_def := pg_get_functiondef(f.oid);
    v_def := replace(v_def, 'public.is_active_non_equipamentos_user()', 'public.is_active_user()');
    v_def := replace(v_def, 'public.is_equipamentos_user()', 'public.is_active_user()');
    v_def := replace(v_def, 'is_active_non_equipamentos_user()', 'public.is_active_user()');
    v_def := replace(v_def, 'is_equipamentos_user()', 'public.is_active_user()');
    v_def := replace(v_def, 'public.can_edit_voyages()', 'public.is_active_user()');
    v_def := replace(v_def, 'public.can_edit_customers()', 'public.is_active_user()');
    v_def := replace(v_def, 'public.can_edit_local_charges()', 'public.is_active_user()');
    v_def := replace(v_def, 'public.can_edit_depots()', 'public.is_active_user()');
    v_def := replace(v_def, 'can_edit_voyages()', 'public.is_active_user()');
    v_def := replace(v_def, 'can_edit_customers()', 'public.is_active_user()');
    v_def := replace(v_def, 'can_edit_local_charges()', 'public.is_active_user()');
    v_def := replace(v_def, 'can_edit_depots()', 'public.is_active_user()');
    EXECUTE v_def;
  END LOOP;
END $$;

-- Leituras que permaneceram com is_admin por engano em migrations antigas.
CREATE OR REPLACE FUNCTION public.get_consolidated_invoice_item_breakdown(p_invoice_id BIGINT)
RETURNS TABLE (bl_id TEXT, charge_calculation_id BIGINT, charge_table_id BIGINT, charge_item_id BIGINT, quantity NUMERIC, unit_value_brl NUMERIC, total_value_brl NUMERIC, currency TEXT, unit_value_usd NUMERIC, total_value_usd NUMERIC, calculation_key TEXT, charge_name TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT irl.bl_id, cc.id, cc.charge_table_id, cc.charge_item_id, cc.quantity, cc.unit_value_brl, cc.total_value_brl, cti.currency, cc.unit_value_usd, cc.total_value_usd, cc.calculation_key, cti.name
  FROM public.invoice_receivable_links irl
  JOIN public.charge_calculations cc ON cc.bl_id = irl.bl_id
  LEFT JOIN public.charge_table_items cti ON cti.id = cc.charge_item_id
  WHERE public.is_active_user() AND irl.invoice_id = p_invoice_id
    AND COALESCE(cc.total_value_brl, 0) > 0
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt')
  ORDER BY irl.bl_id, cc.id;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_portal_account(p_customer_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao.' USING ERRCODE = '42501';
  END IF;
  SELECT to_jsonb(t.*) INTO v_result
  FROM (SELECT a.id, a.customer_id, a.contact_email, a.active, a.auth_user_id, a.portal_email, a.login_cnpj, a.created_by, a.last_login_at, a.created_at, a.updated_at
        FROM public.customer_portal_accounts a WHERE a.customer_id = p_customer_id) t;
  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- list_invoice_details contém regras de formato extensas; seu gate é a única
-- alteração necessária e fica aplicado sem duplicar o corpo histórico.
DO $$
DECLARE v_def TEXT;
BEGIN
  v_def := pg_get_functiondef('public.list_invoice_details(bigint)'::regprocedure);
  v_def := replace(v_def, 'NOT public.is_admin()', 'NOT public.is_active_read_user()');
  EXECUTE v_def;
END $$;

-- O provisionamento continua escrito apenas por Administrativo + Documentação;
-- somente as leituras do console/histórico são abertas aos cinco departamentos.
DO $$
DECLARE v_def TEXT;
BEGIN
  v_def := pg_get_functiondef('public.portal_list_provisioning_console(bigint)'::regprocedure);
  v_def := regexp_replace(v_def, 'v_full_access BOOLEAN := v_role IN \([^;]+\);', 'v_full_access BOOLEAN := v_role IN (''administrativo'',''documentacao'',''financeiro'',''equipamentos'',''operacoes'');');
  v_def := replace(v_def, 'v_role NOT IN (''administrativo'',''documentacao'',''financeiro'',''operacoes'')', 'v_role NOT IN (''administrativo'',''documentacao'',''financeiro'',''operacoes'',''equipamentos'')');
  v_def := replace(v_def, 'v_role NOT IN (''administrativo'',''documentacao'',''financeiro'')', 'v_role NOT IN (''administrativo'',''documentacao'',''financeiro'',''operacoes'',''equipamentos'')');
  EXECUTE v_def;
  v_def := pg_get_functiondef('public.portal_list_provisioning_events(bigint,integer)'::regprocedure);
  v_def := replace(v_def, 'v_role NOT IN (''administrativo'',''documentacao'',''financeiro'')', 'v_role NOT IN (''administrativo'',''documentacao'',''financeiro'',''operacoes'',''equipamentos'')');
  EXECUTE v_def;
END $$;

DROP FUNCTION IF EXISTS public.can_edit_voyages();
DROP FUNCTION IF EXISTS public.can_edit_customers();
DROP FUNCTION IF EXISTS public.can_edit_local_charges();
DROP FUNCTION IF EXISTS public.can_edit_depots();
DROP FUNCTION IF EXISTS public.is_equipamentos_user();
DROP FUNCTION IF EXISTS public.is_active_non_equipamentos_user();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND cmd IN ('DELETE', 'ALL')
      AND tablename NOT IN ('audit_logs')
      AND (COALESCE(qual, '') LIKE '%is_active_user()%' OR COALESCE(qual, '') LIKE '%is_equipamentos_user()%')
  ) THEN
    RAISE EXCEPTION 'Migration 295 deixou uma policy DELETE aberta';
  END IF;
END $$;
