-- Renumbered from 20260614140808 (original timestamped migration: 20260614140808_revoke_anon_reverse_payment_rpcs.sql).
-- Defense-in-depth: reverse_invoice_payment e reverse_demurrage_payment ja
-- exigem is_admin() internamente (anon recebe excecao em runtime), mas nao
-- devem ter superficie de execucao anon. Alinha ao padrao das migrations
-- revoke_anon_* existentes. Os grants default do Supabase para anon em funcoes
-- novas no schema public nao haviam sido removidos.
REVOKE ALL ON FUNCTION public.reverse_invoice_payment(BIGINT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_invoice_payment(BIGINT, TEXT, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.reverse_demurrage_payment(BIGINT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_demurrage_payment(BIGINT, TEXT, UUID) TO authenticated;
