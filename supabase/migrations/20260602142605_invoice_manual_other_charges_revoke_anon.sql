-- Revoga EXECUTE de anon nas RPCs de Other Charges manuais de fatura.
-- Supabase concede EXECUTE a anon por default privileges; revogamos explicitamente
-- (alinhado ao hardening em 20260530102907_revoke_anon_execute_security_definer.sql).
REVOKE EXECUTE ON FUNCTION public.add_manual_invoice_charge(BIGINT, TEXT, NUMERIC, NUMERIC, TEXT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_manual_invoice_charge(BIGINT, UUID) FROM anon;
