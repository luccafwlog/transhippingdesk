-- Renumbered from 20260530102909 (original timestamped migration: 20260530102909_tighten_permissive_rls_policies.sql).
-- Migration: remover policies RLS sempre-verdadeiras (lint 0024)
--
-- Intent: baplie_containers e voyage_export_schedules concediam INSERT/UPDATE/
-- DELETE irrestrito a QUALQUER usuário autenticado (USING/ WITH CHECK = true).
-- Alinhar ao modelo das demais tabelas operacionais: exigir usuário ativo.
-- Affected tables: public.baplie_containers, public.voyage_export_schedules.
-- Breaking?: não para equipe interna ativa; bloqueia apenas contas inativas.

-- baplie_containers ---------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can insert baplie_containers" ON public.baplie_containers;
DROP POLICY IF EXISTS "Authenticated users can update baplie_containers" ON public.baplie_containers;
DROP POLICY IF EXISTS "Authenticated users can delete baplie_containers" ON public.baplie_containers;

CREATE POLICY "baplie_containers_insert_active" ON public.baplie_containers
  FOR INSERT TO authenticated WITH CHECK (public.is_active_user());
CREATE POLICY "baplie_containers_update_active" ON public.baplie_containers
  FOR UPDATE TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());
CREATE POLICY "baplie_containers_delete_active" ON public.baplie_containers
  FOR DELETE TO authenticated USING (public.is_active_user());

-- voyage_export_schedules ---------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can insert voyage_export_schedules" ON public.voyage_export_schedules;
DROP POLICY IF EXISTS "Authenticated users can update voyage_export_schedules" ON public.voyage_export_schedules;
DROP POLICY IF EXISTS "Authenticated users can delete voyage_export_schedules" ON public.voyage_export_schedules;

CREATE POLICY "voyage_export_schedules_insert_active" ON public.voyage_export_schedules
  FOR INSERT TO authenticated WITH CHECK (public.is_active_user());
CREATE POLICY "voyage_export_schedules_update_active" ON public.voyage_export_schedules
  FOR UPDATE TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());
CREATE POLICY "voyage_export_schedules_delete_active" ON public.voyage_export_schedules
  FOR DELETE TO authenticated USING (public.is_active_user());

-- Rollback:
--   Recriar as policies originais com USING/WITH CHECK (true) por comando.
