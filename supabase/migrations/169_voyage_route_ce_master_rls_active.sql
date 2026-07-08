-- Hardening de RLS: restringe voyage_route_ce_master a usuarios internos ativos.
--
-- Contexto: a migration 167 criou a tabela com policies permissivas para
--   leitura e escrita de todo usuario authenticated. Clientes do
--   Portal tambem autenticam via Supabase Auth e recebem o papel
--   `authenticated`, entao poderiam acessar CE Master por PostgREST fora da RPC
--   auditada. E a mesma classe corrigida na migration 160.
-- Correcao: reescreve as policies para usuarios ativos nas operacoes de leitura
--   e escrita, mantendo DELETE restrito a administradores. A RPC
--   set_voyage_route_ce_master continua SECURITY DEFINER e ja valida usuario
--   ativo + changed_by.
-- Escopo: aditivo; consumidores internos seguem funcionando por
--   `public.is_active_user()`. Portal nao deve acessar esta tabela diretamente.
-- Rollback: nao recriar policies permissivas sem controle equivalente.

ALTER TABLE public.voyage_route_ce_master ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read voyage_route_ce_master"   ON public.voyage_route_ce_master;
DROP POLICY IF EXISTS "insert voyage_route_ce_master" ON public.voyage_route_ce_master;
DROP POLICY IF EXISTS "update voyage_route_ce_master" ON public.voyage_route_ce_master;
DROP POLICY IF EXISTS "delete voyage_route_ce_master" ON public.voyage_route_ce_master;
DROP POLICY IF EXISTS voyage_route_ce_master_select_active ON public.voyage_route_ce_master;
DROP POLICY IF EXISTS voyage_route_ce_master_insert_active ON public.voyage_route_ce_master;
DROP POLICY IF EXISTS voyage_route_ce_master_update_active ON public.voyage_route_ce_master;
DROP POLICY IF EXISTS voyage_route_ce_master_delete_admin ON public.voyage_route_ce_master;

CREATE POLICY voyage_route_ce_master_select_active
  ON public.voyage_route_ce_master FOR SELECT
  TO authenticated USING (public.is_active_user());

CREATE POLICY voyage_route_ce_master_insert_active
  ON public.voyage_route_ce_master FOR INSERT
  TO authenticated WITH CHECK (public.is_active_user());

CREATE POLICY voyage_route_ce_master_update_active
  ON public.voyage_route_ce_master FOR UPDATE
  TO authenticated USING (public.is_active_user())
  WITH CHECK (public.is_active_user());

CREATE POLICY voyage_route_ce_master_delete_admin
  ON public.voyage_route_ce_master FOR DELETE
  TO authenticated USING (public.is_admin());
