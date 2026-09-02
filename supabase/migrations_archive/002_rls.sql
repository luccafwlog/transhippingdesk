-- RLS compartilhado: todos os usuários autenticados podem ler e escrever.
-- A segregação é por perfil de interface, não por owner_id.

DO $$
DECLARE
  table_name TEXT;
  tables TEXT[] := ARRAY[
    'user_profiles',
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
    'customer_rate_overrides',
    'charge_tables',
    'charge_table_items',
    'charge_calculations',
    'bls',
    'bl_containers',
    'invoices',
    'invoice_items',
    'payments'
  ];
BEGIN
  FOREACH table_name IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_select_authenticated', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_insert_authenticated', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_update_authenticated', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_delete_authenticated', table_name);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.role() = ''authenticated'')',
      table_name || '_select_authenticated',
      table_name
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (auth.role() = ''authenticated'')',
      table_name || '_insert_authenticated',
      table_name
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (auth.role() = ''authenticated'') WITH CHECK (auth.role() = ''authenticated'')',
      table_name || '_update_authenticated',
      table_name
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (auth.role() = ''authenticated'')',
      table_name || '_delete_authenticated',
      table_name
    );
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
