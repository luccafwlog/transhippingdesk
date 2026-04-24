-- Migration 041: RLS nas tabelas criadas em 025 sem proteção + limpeza de sessões expiradas
--
-- A migration 025 criou 7 tabelas mas nunca ativou RLS. Se o projeto Supabase
-- tiver ALTER DEFAULT PRIVILEGES configurado (padrão), qualquer authenticated
-- poderia fazer SELECT em customer_portal_accounts (hashes bcrypt) e
-- customer_portal_sessions (hashes SHA-256 de tokens ativos).

------------------------------------------------------------------------
-- customer_portal_accounts: apenas admin acessa diretamente.
-- Acesso externo ocorre exclusivamente via SECURITY DEFINER functions.
------------------------------------------------------------------------

ALTER TABLE public.customer_portal_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cpa_admin_all ON public.customer_portal_accounts;
CREATE POLICY cpa_admin_all
  ON public.customer_portal_accounts
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

------------------------------------------------------------------------
-- customer_portal_sessions: idem — apenas admin acessa diretamente.
------------------------------------------------------------------------

ALTER TABLE public.customer_portal_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cps_admin_all ON public.customer_portal_sessions;
CREATE POLICY cps_admin_all
  ON public.customer_portal_sessions
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

------------------------------------------------------------------------
-- billing_runs: ativo pode ler; apenas admin escreve.
------------------------------------------------------------------------

ALTER TABLE public.billing_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_runs_select_active ON public.billing_runs;
DROP POLICY IF EXISTS billing_runs_write_admin  ON public.billing_runs;

CREATE POLICY billing_runs_select_active
  ON public.billing_runs FOR SELECT
  TO authenticated USING (public.is_active_user());

CREATE POLICY billing_runs_insert_admin
  ON public.billing_runs FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY billing_runs_update_admin
  ON public.billing_runs FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY billing_runs_delete_admin
  ON public.billing_runs FOR DELETE
  TO authenticated USING (public.is_admin());

------------------------------------------------------------------------
-- billing_run_logs: ativo pode ler; apenas admin escreve.
------------------------------------------------------------------------

ALTER TABLE public.billing_run_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_run_logs_select_active ON public.billing_run_logs;

CREATE POLICY billing_run_logs_select_active
  ON public.billing_run_logs FOR SELECT
  TO authenticated USING (public.is_active_user());

CREATE POLICY billing_run_logs_insert_admin
  ON public.billing_run_logs FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY billing_run_logs_delete_admin
  ON public.billing_run_logs FOR DELETE
  TO authenticated USING (public.is_admin());

------------------------------------------------------------------------
-- billing_batches: ativo pode ler; apenas admin escreve.
------------------------------------------------------------------------

ALTER TABLE public.billing_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_batches_select_active ON public.billing_batches;

CREATE POLICY billing_batches_select_active
  ON public.billing_batches FOR SELECT
  TO authenticated USING (public.is_active_user());

CREATE POLICY billing_batches_insert_admin
  ON public.billing_batches FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY billing_batches_update_admin
  ON public.billing_batches FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY billing_batches_delete_admin
  ON public.billing_batches FOR DELETE
  TO authenticated USING (public.is_admin());

------------------------------------------------------------------------
-- pricing_rule_versions: ativo pode ler; apenas admin escreve.
------------------------------------------------------------------------

ALTER TABLE public.pricing_rule_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pricing_rule_versions_select_active ON public.pricing_rule_versions;

CREATE POLICY pricing_rule_versions_select_active
  ON public.pricing_rule_versions FOR SELECT
  TO authenticated USING (public.is_active_user());

CREATE POLICY pricing_rule_versions_insert_admin
  ON public.pricing_rule_versions FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY pricing_rule_versions_update_admin
  ON public.pricing_rule_versions FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY pricing_rule_versions_delete_admin
  ON public.pricing_rule_versions FOR DELETE
  TO authenticated USING (public.is_admin());

------------------------------------------------------------------------
-- customer_reconciliation_queue: ativo pode ler; apenas admin escreve.
------------------------------------------------------------------------

ALTER TABLE public.customer_reconciliation_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crq_select_active ON public.customer_reconciliation_queue;

CREATE POLICY crq_select_active
  ON public.customer_reconciliation_queue FOR SELECT
  TO authenticated USING (public.is_active_user());

CREATE POLICY crq_insert_admin
  ON public.customer_reconciliation_queue FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY crq_update_admin
  ON public.customer_reconciliation_queue FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY crq_delete_admin
  ON public.customer_reconciliation_queue FOR DELETE
  TO authenticated USING (public.is_admin());

------------------------------------------------------------------------
-- Limpeza automática de sessões expiradas via pg_cron
-- Remove sessões com mais de 1 dia após expiração para evitar acúmulo.
------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

SELECT cron.schedule(
  'cleanup-portal-sessions',
  '0 3 * * *',
  $$DELETE FROM public.customer_portal_sessions
      WHERE expires_at < now() - INTERVAL '1 day'$$
);
