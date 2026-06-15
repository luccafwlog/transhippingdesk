-- FASE 1A: Índices ausentes + revogar anon vestigial + remover funções legadas
--
-- 1. Índices para queries do portal (demurrage sem índices = full scan)
-- 2. Revogar EXECUTE de anon das 2 RPCs que escaparam da revogação
-- 3. Remover funções do fluxo de login legado (token), substituídas pelo Supabase Auth

-- ============================================================================
-- 1. Índices ausentes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_demurrage_invoices_customer_status
  ON public.demurrage_invoices (customer_id, status);

CREATE INDEX IF NOT EXISTS idx_demurrage_invoice_items_invoice
  ON public.demurrage_invoice_items (invoice_id);

CREATE INDEX IF NOT EXISTS idx_bl_receivables_customer_source
  ON public.bl_receivables (customer_id, source);

-- ============================================================================
-- 2. Revogar anon das 2 RPCs que ainda têm grant anon vestigial
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.portal_list_invoices() FROM anon;
REVOKE EXECUTE ON FUNCTION public.portal_invoice_details(bigint) FROM anon;

-- ============================================================================
-- 3. Remover funções do fluxo de login legado (token)
--    Todas foram substituídas pelo Supabase Auth (email+senha).
--    Nenhuma é chamada pelo frontend desde a migração 20260603130350.
-- ============================================================================

DROP FUNCTION IF EXISTS public.portal_login(text, text);
DROP FUNCTION IF EXISTS public.portal_logout(text);
DROP FUNCTION IF EXISTS public.portal_get_session_overview(text);
DROP FUNCTION IF EXISTS public.portal_check_auth_method(text);
DROP FUNCTION IF EXISTS public.resolve_customer_portal_session(text);
