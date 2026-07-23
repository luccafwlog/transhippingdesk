-- RBAC de Cadastro de Depot: leitura interna; escrita Administrativo/Equipamentos.

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['depots', 'depot_tariffs', 'depot_services'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_select', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_insert', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_update', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_delete', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_read_user())',
      table_name || '_select', table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_equipamentos_user())',
      table_name || '_insert', table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_equipamentos_user()) WITH CHECK (public.is_admin() OR public.is_equipamentos_user())',
      table_name || '_update', table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_admin() OR public.is_equipamentos_user())',
      table_name || '_delete', table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.can_edit_depots()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND (public.is_admin() OR public.is_equipamentos_user())
$$;

REVOKE ALL ON FUNCTION public.can_edit_depots() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_depots() TO authenticated;
