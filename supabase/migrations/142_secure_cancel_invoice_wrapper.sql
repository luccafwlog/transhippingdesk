-- Renumbered from 20260622215000 (original timestamped migration: 20260622215000_secure_cancel_invoice_wrapper.sql).
-- cancel_invoice is the guarded public boundary for invoice cancellation.
-- It validates auth.uid(), active-user status, and the admin role before
-- touching invoices, batches, B/Ls, Granite records, and audit logs. Execute
-- that boundary with owner privileges instead of exposing those tables.
ALTER FUNCTION public.cancel_invoice(
  BIGINT, TEXT, UUID
) SECURITY DEFINER;
