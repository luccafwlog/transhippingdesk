-- Renumbered from 20260610094629 (original timestamped migration: 20260610094629_rls_initplan_performance_pass.sql).
------------------------------------------------------------------------
-- Passe de performance de RLS (audit F23/T12) — reescritas
-- comportamento-idênticas, sem mudança de autorização.
--
-- 1. auth_rls_initplan (12 WARNs): políticas que chamam auth.uid() /
--    auth.role() diretamente reavaliam a função por linha. Envolver em
--    (select ...) faz o planner avaliar uma única vez (InitPlan).
-- 2. multiple_permissive_policies (parcial):
--    - demurrage_rates: a política ALL de admin se sobrepunha à de
--      leitura em SELECT (para todas as roles, inclusive anon, pois
--      ambas eram TO public). Substituída por INSERT/UPDATE/DELETE
--      TO authenticated; a leitura de admins já é coberta pela política
--      de SELECT (admin é authenticated + ativo). Anon nunca passava em
--      nenhuma das duas (auth.uid() nulo / is_admin() falso) — restringir
--      a role é idêntico em comportamento.
--    - user_profiles: user_profiles_admin_update + user_profiles_self_update
--      fundidas em uma única política UPDATE com OR (políticas permissivas
--      já são OR-adas pelo Postgres; a fusão é equivalente).
--
-- NÃO consolidado (decisão de produto pendente): as políticas duplicadas
-- de vazios_importacao_manifests/containers. A migration 042 tentou
-- remover as antigas (auth.role() = 'authenticated') mas usou nomes
-- errados (vazios_importacao_* vs vazios_imp_*) e elas sobreviveram.
-- Removê-las tornaria DELETE admin-only e quebraria o reimport de baplie
-- por operadores (deleteBaplieManifestForVoyage). Aqui apenas corrigimos
-- o initplan delas; a consolidação exige decidir quem pode deletar.
--
-- Rollback: reverter cada ALTER/CREATE/DROP para a definição anterior
-- (ver pg_policies no estado pré-migration, citado acima em cada item).
------------------------------------------------------------------------

-- 1a. audit_logs
ALTER POLICY audit_logs_insert_self ON public.audit_logs
  WITH CHECK (public.is_active_user() AND changed_by IS NOT NULL AND changed_by = (SELECT auth.uid()));

-- 1b. user_profiles (initplan + fusão do UPDATE)
ALTER POLICY user_profiles_self_select ON public.user_profiles
  USING ((id = (SELECT auth.uid())) OR public.is_admin());

DROP POLICY IF EXISTS user_profiles_admin_update ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_self_update ON public.user_profiles;
CREATE POLICY user_profiles_update ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR (id = (SELECT auth.uid()) AND active = true))
  WITH CHECK (public.is_admin() OR (id = (SELECT auth.uid()) AND active = true));

-- 1c. demurrage_rates (initplan + sobreposição SELECT)
DROP POLICY IF EXISTS admin_gerencia_demurrage_rates ON public.demurrage_rates;
CREATE POLICY demurrage_rates_admin_insert ON public.demurrage_rates
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user() AND public.is_admin());
CREATE POLICY demurrage_rates_admin_update ON public.demurrage_rates
  FOR UPDATE TO authenticated
  USING (public.is_active_user() AND public.is_admin())
  WITH CHECK (public.is_active_user() AND public.is_admin());
CREATE POLICY demurrage_rates_admin_delete ON public.demurrage_rates
  FOR DELETE TO authenticated
  USING (public.is_active_user() AND public.is_admin());

ALTER POLICY autenticados_leem_demurrage_rates ON public.demurrage_rates
  TO authenticated
  USING (((SELECT auth.uid()) IS NOT NULL) AND public.is_active_user());

-- 1d. vazios_importacao_* (somente initplan; ver nota acima)
ALTER POLICY vazios_imp_manifests_select ON public.vazios_importacao_manifests
  USING ((SELECT auth.role()) = 'authenticated');
ALTER POLICY vazios_imp_manifests_insert ON public.vazios_importacao_manifests
  WITH CHECK ((SELECT auth.role()) = 'authenticated');
ALTER POLICY vazios_imp_manifests_update ON public.vazios_importacao_manifests
  USING ((SELECT auth.role()) = 'authenticated')
  WITH CHECK ((SELECT auth.role()) = 'authenticated');
ALTER POLICY vazios_imp_manifests_delete ON public.vazios_importacao_manifests
  USING ((SELECT auth.role()) = 'authenticated');

ALTER POLICY vazios_imp_containers_select ON public.vazios_importacao_containers
  USING ((SELECT auth.role()) = 'authenticated');
ALTER POLICY vazios_imp_containers_insert ON public.vazios_importacao_containers
  WITH CHECK ((SELECT auth.role()) = 'authenticated');
ALTER POLICY vazios_imp_containers_update ON public.vazios_importacao_containers
  USING ((SELECT auth.role()) = 'authenticated')
  WITH CHECK ((SELECT auth.role()) = 'authenticated');
ALTER POLICY vazios_imp_containers_delete ON public.vazios_importacao_containers
  USING ((SELECT auth.role()) = 'authenticated');
