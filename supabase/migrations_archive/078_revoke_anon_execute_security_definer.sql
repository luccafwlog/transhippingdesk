-- Renumbered from 20260530102907 (original timestamped migration: 20260530102907_revoke_anon_execute_security_definer.sql).
-- Migration: revogar EXECUTE de `anon` em funções SECURITY DEFINER internas
--
-- Intent: fechar o lint 0028 (anon_security_definer_function_executable).
-- Funções SECURITY DEFINER rodam com privilégios do owner; expô-las à role
-- anônima permite que qualquer cliente com a anon key as invoque sem login.
-- Affected: funções SECURITY DEFINER em `public`, EXCETO as do portal do
-- cliente, que são legitimamente chamadas pré-autenticação (token legado).
-- Breaking?: não para o app interno (usa `authenticated`); o portal continua
-- com acesso anon às funções portal_* / resolve_customer_portal_session.
--
-- Observação: a role `authenticated` (equipe interna logada) mantém EXECUTE.
-- O hardening aqui remove apenas o acesso ANÔNIMO às funções não-portal.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef                       -- apenas SECURITY DEFINER
      AND p.proname NOT LIKE 'portal\_%'     -- funções do portal: manter anon
      AND p.proname NOT IN (
        'resolve_customer_portal_session'    -- usada pelo fluxo de token legado
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
  END LOOP;
END $$;

-- Rollback:
--   Reconceder caso necessário (não recomendado):
--   GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO anon;
