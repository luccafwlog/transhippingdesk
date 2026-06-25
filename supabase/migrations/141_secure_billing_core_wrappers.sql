-- Renumbered from 20260622214500 (original timestamped migration: 20260622214500_secure_billing_core_wrappers.sql).
-- The guarded public wrappers call a revoked SECURITY DEFINER core.
-- As SECURITY INVOKER they execute the nested call as `authenticated` and fail
-- with 42501. Elevate only the wrappers; their existing admin/active-user
-- guards remain mandatory and the core stays unavailable for direct calls.
ALTER FUNCTION public.create_invoice_from_bls(
  TEXT[], BIGINT, DATE, TEXT, BOOLEAN, UUID
) SECURITY DEFINER;

ALTER FUNCTION public.create_invoice_from_bls_with_ledger(
  TEXT[], BIGINT, DATE, TEXT, BOOLEAN, UUID
) SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.create_invoice_from_bls_core(
  TEXT[], BIGINT, DATE, TEXT, BOOLEAN, UUID, TEXT, BIGINT
) FROM PUBLIC, anon, authenticated;
