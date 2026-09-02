-- F-06: RLS por role (admin/operator) + helper is_admin().
--
-- Contexto: o schema tem user_profiles.role ∈ {'admin','operator'} mas as
-- policies existentes liberavam CRUD total para qualquer usuário autenticado.
-- Esta migration:
--   1. Cria helper public.current_user_role() e public.is_admin() SECURITY DEFINER
--      capazes de serem chamadas dentro de policies sem recursão em user_profiles.
--   2. Substitui as policies "authenticated total" por policies role-aware:
--        - operadores podem SELECT/INSERT/UPDATE tudo que é operacional;
--        - operadores NÃO podem DELETE em tabelas sensíveis (voyages,
--          customers, invoices, payments, charge_tables, carriers, vessels,
--          ports, bls, bl_containers, vehicles, import_batches,
--          bl_breakbulk_items);
--        - apenas admin pode UPDATE/DELETE em dados financeiros (invoices,
--          payments, charge_tables, charge_table_items, customer_rate_overrides);
--        - apenas admin pode alterar user_profiles de outros usuários.
--   3. Mantém service_role com bypass implícito (RLS não se aplica ao
--      service_role do Supabase).
--
-- Limitação conhecida: o modelo atual não tem ownership por voyage/operador.
-- Quando esse modelo existir, estas policies devem ser ampliadas para filtrar
-- por voyage_id do operador. Por ora o endurecimento possível é limitar
-- operações destrutivas/financeiras ao perfil admin.

-- Helpers -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_admin()
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
      AND role = 'admin'
      AND active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_active_user()
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
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;

-- Substituição das policies -----------------------------------------------

DO $$
DECLARE
  t TEXT;
  -- Tabelas onde operator pode SELECT/INSERT/UPDATE, e apenas admin deleta.
  operator_tables TEXT[] := ARRAY[
    'audit_logs',
    'alerts',
    'carriers',
    'vessels',
    'ports',
    'voyages',
    'import_batches',
    'import_errors',
    'customers',
    'customer_contacts',
    'charge_calculations',
    'bls',
    'bl_containers',
    'bl_breakbulk_items',
    'vehicles'
  ];
  -- Tabelas financeiras/tarifação: somente admin altera ou deleta.
  admin_only_tables TEXT[] := ARRAY[
    'charge_tables',
    'charge_table_items',
    'customer_rate_overrides',
    'invoices',
    'invoice_items',
    'payments'
  ];
BEGIN
  -- Drop das policies antigas "*_authenticated" em todas as tabelas
  -- gerenciadas por este e pelo 002_rls.sql.
  FOREACH t IN ARRAY ARRAY[
    'user_profiles','audit_logs','alerts','carriers','vessels','ports',
    'voyages','import_batches','import_errors','customers','customer_contacts',
    'customer_rate_overrides','charge_tables','charge_table_items',
    'charge_calculations','bls','bl_containers','bl_breakbulk_items',
    'invoices','invoice_items','payments','vehicles'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert_authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update_authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete_authenticated', t);
  END LOOP;

  -- Tabelas operacionais: SELECT/INSERT/UPDATE para operator+admin ativos,
  -- DELETE apenas admin.
  FOREACH t IN ARRAY operator_tables LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_user())',
      t || '_select_active', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_active_user())',
      t || '_insert_active', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user())',
      t || '_update_active', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_admin())',
      t || '_delete_admin', t
    );
  END LOOP;

  -- Tabelas financeiras/tarifação: SELECT para qualquer ativo, mas
  -- INSERT/UPDATE/DELETE apenas admin.
  FOREACH t IN ARRAY admin_only_tables LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_user())',
      t || '_select_active', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_admin())',
      t || '_insert_admin', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())',
      t || '_update_admin', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_admin())',
      t || '_delete_admin', t
    );
  END LOOP;
END $$;

-- user_profiles: cada usuário pode ler/editar o próprio perfil; admin pode tudo.
DROP POLICY IF EXISTS user_profiles_select_active ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_insert_active ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_update_active ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_delete_admin ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_self_select ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_self_update ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_admin_all ON public.user_profiles;

CREATE POLICY user_profiles_self_select
ON public.user_profiles
FOR SELECT
TO authenticated
USING (id = auth.uid() OR public.is_admin());

CREATE POLICY user_profiles_self_update
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid() AND active = true)
WITH CHECK (id = auth.uid() AND active = true);

CREATE POLICY user_profiles_admin_insert
ON public.user_profiles
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY user_profiles_admin_update
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY user_profiles_admin_delete
ON public.user_profiles
FOR DELETE
TO authenticated
USING (public.is_admin());

-- invoice_counters: somente admin pode alterar diretamente (a função
-- assign_invoice_number roda como trigger e não depende de RLS).
DROP POLICY IF EXISTS invoice_counters_service_only ON public.invoice_counters;
DROP POLICY IF EXISTS invoice_counters_admin_all ON public.invoice_counters;

CREATE POLICY invoice_counters_admin_all
ON public.invoice_counters
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
