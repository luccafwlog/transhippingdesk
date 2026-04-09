-- Transhipping Desk - reset operacional para testes
-- Preserva:
-- - auth.users
-- - public.user_profiles
-- - public.carriers
-- - public.vessels
-- - public.ports
-- - public.voyages
-- - public.charge_tables
-- - public.charge_table_items
--
-- Remove:
-- - manifestos/import batches
-- - B/Ls e containers
-- - clientes e contatos
-- - calculos, invoices e pagamentos
-- - overrides comerciais
-- - auditoria, alertas e contador de invoice

BEGIN;

TRUNCATE TABLE
  public.payments,
  public.invoice_items,
  public.invoices,
  public.charge_calculations,
  public.bl_containers,
  public.bls,
  public.import_errors,
  public.import_batches,
  public.customer_contacts,
  public.customer_rate_overrides,
  public.customers,
  public.alerts,
  public.audit_logs,
  public.invoice_counters
RESTART IDENTITY;

COMMIT;

-- Conferencia rapida apos o reset:
-- SELECT 'import_batches' AS table_name, COUNT(*) AS total FROM public.import_batches
-- UNION ALL
-- SELECT 'bls', COUNT(*) FROM public.bls
-- UNION ALL
-- SELECT 'bl_containers', COUNT(*) FROM public.bl_containers
-- UNION ALL
-- SELECT 'customers', COUNT(*) FROM public.customers
-- UNION ALL
-- SELECT 'customer_contacts', COUNT(*) FROM public.customer_contacts
-- UNION ALL
-- SELECT 'audit_logs', COUNT(*) FROM public.audit_logs;
