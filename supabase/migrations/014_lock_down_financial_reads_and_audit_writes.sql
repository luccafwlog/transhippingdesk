-- Endurecimento complementar do hardening tecnico:
-- 1. leitura financeira/tarifaria restrita a admin;
-- 2. audit_logs nao pode mais ser alterado livremente por qualquer usuario ativo.

DO $$
DECLARE
  t TEXT;
  admin_read_tables TEXT[] := ARRAY[
    'charge_tables',
    'charge_table_items',
    'customer_rate_overrides',
    'charge_calculations',
    'invoices',
    'invoice_items',
    'payments'
  ];
BEGIN
  FOREACH t IN ARRAY admin_read_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_active', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_admin', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_admin())',
      t || '_select_admin', t
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS audit_logs_select_active ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_insert_active ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_insert_self ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_update_active ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_update_admin ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_delete_admin ON public.audit_logs;

CREATE POLICY audit_logs_select_active
ON public.audit_logs
FOR SELECT
TO authenticated
USING (public.is_active_user());

CREATE POLICY audit_logs_insert_self
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_active_user()
  AND changed_by IS NOT NULL
  AND changed_by = auth.uid()
);

CREATE POLICY audit_logs_update_admin
ON public.audit_logs
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY audit_logs_delete_admin
ON public.audit_logs
FOR DELETE
TO authenticated
USING (public.is_admin());
