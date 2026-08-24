-- 341_alerts_rls_hardening.sql
-- Hardening de segurança e RLS na tabela base public.alerts.
--
-- Contexto:
-- As tabelas alert_items, alert_item_dismissals e internal_notifications (criadas na 318)
-- já tiveram INSERT, UPDATE, DELETE revogados de authenticated/anon/PUBLIC,
-- canalizando todo o ciclo de vida para RPCs SECURITY DEFINER auditadas e detectores
-- server-side (ADR 0004, ADR 0034, ADR 0053).
--
-- Esta migration:
-- 1. Revoga INSERT, UPDATE, DELETE diretos na tabela public.alerts de authenticated, anon e PUBLIC.
-- 2. Mantém SELECT liberado para usuários autenticados ativos (is_active_user()).
-- 3. Substitui policies legadas de escrita em public.alerts por bloqueio ou restrição admin.

DO $$
BEGIN
  -- Remover policies legadas de DML permissivo em alerts
  DROP POLICY IF EXISTS alerts_insert_authenticated ON public.alerts;
  DROP POLICY IF EXISTS alerts_update_authenticated ON public.alerts;
  DROP POLICY IF EXISTS alerts_delete_authenticated ON public.alerts;
  DROP POLICY IF EXISTS "Authenticated users can insert alerts" ON public.alerts;
  DROP POLICY IF EXISTS "Authenticated users can update alerts" ON public.alerts;
  DROP POLICY IF EXISTS "Authenticated users can delete alerts" ON public.alerts;
  DROP POLICY IF EXISTS alerts_select_authenticated ON public.alerts;
  DROP POLICY IF EXISTS alerts_select_active ON public.alerts;
END $$;

-- Leitura restrita a usuários internos ativos
CREATE POLICY alerts_select_active
  ON public.alerts
  FOR SELECT
  TO authenticated
  USING (public.is_active_user());

-- Revogar mutações diretas da API REST/GraphQL do Supabase
REVOKE INSERT, UPDATE, DELETE ON public.alerts FROM authenticated, anon, PUBLIC;
GRANT SELECT ON public.alerts TO authenticated;
