-- Migration: corrigir escalonamento de privilégio em user_profiles
--
-- Intent: impedir que um usuário autenticado promova a si mesmo a admin.
-- Affected tables: public.user_profiles.
-- Breaking?: não (apenas adiciona uma trava; o fluxo legítimo de admin continua).
--
-- Contexto da vulnerabilidade
-- ---------------------------
-- A policy `user_profiles_self_update` (migração 010) permite que o usuário
-- atualize a própria linha com `WITH CHECK (id = auth.uid() AND active = true)`.
-- Esse WITH CHECK NÃO restringe a coluna `role`, e a role `authenticated` tem
-- GRANT UPDATE na tabela. Logo, qualquer usuário logado (operações,
-- documentação, financeiro) podia, inclusive via PostgREST direto com a anon
-- key, executar:
--     PATCH /rest/v1/user_profiles?id=eq.<proprio-id>  { "role": "administrativo" }
-- e obter privilégio total de admin.
--
-- Correção: trigger BEFORE UPDATE que rejeita qualquer mudança em `role` ou
-- `active` quando o autor da operação não é admin. Operações de service_role
-- (Edge Functions, jobs) têm auth.uid() = NULL e passam normalmente.

CREATE OR REPLACE FUNCTION public.prevent_user_profile_privilege_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- service_role / contexto sem usuário autenticado (Edge Functions, jobs):
  -- não há sessão de usuário, RLS já não se aplica — liberar.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Mudanças em campos sensíveis (role, active) só por admin.
  IF (NEW.role IS DISTINCT FROM OLD.role
      OR NEW.active IS DISTINCT FROM OLD.active)
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem alterar role ou active de um perfil.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_user_profile_privilege_escalation() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_prevent_user_profile_privilege_escalation ON public.user_profiles;
CREATE TRIGGER trg_prevent_user_profile_privilege_escalation
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_user_profile_privilege_escalation();

-- Rollback:
--   drop trigger if exists trg_prevent_user_profile_privilege_escalation on public.user_profiles;
--   drop function if exists public.prevent_user_profile_privilege_escalation();
