------------------------------------------------------------------------
-- Remove índice duplicado em invoices.
--
-- idx_invoices_customer_issued (011_schema_hardening.sql) e
-- idx_invoices_customer_issued_at (020_billing_hybrid_workflow.sql) têm
-- definição idêntica: btree (customer_id, issued_at DESC). O performance
-- advisor (duplicate_index) aponta a duplicata; manter os dois só custa
-- escrita e espaço. Mantém-se o mais antigo (idx_invoices_customer_issued).
--
-- Rollback:
--   CREATE INDEX idx_invoices_customer_issued_at
--     ON public.invoices (customer_id, issued_at DESC);
------------------------------------------------------------------------

DROP INDEX IF EXISTS public.idx_invoices_customer_issued_at;
