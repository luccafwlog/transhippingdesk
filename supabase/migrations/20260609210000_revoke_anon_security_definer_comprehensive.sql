------------------------------------------------------------------------
-- Revogação abrangente de EXECUTE de anon em funções SECURITY DEFINER.
--
-- Contexto: o security advisor (lint 0028) acusa 24 funções SECURITY
-- DEFINER executáveis por anon. Desde o rework de auth do portal
-- (20260603130350), TODAS as funções portal_* de dados validam a sessão
-- via current_portal_customer_id() (que exige auth.uid() válido), e o
-- frontend só as chama após signInWithPassword — ou seja, sempre como
-- authenticated. O grant a anon é vestigial e só aumenta a superfície
-- de ataque não autenticada.
--
-- O que esta migration faz:
--   1. Revoga EXECUTE de anon (e PUBLIC) em TODAS as funções SECURITY
--      DEFINER do schema public — sem exceção de portal, pois nenhuma
--      chamada pré-autenticação existe mais no frontend.
--   2. Funções de trigger (RETURNS trigger) também perdem EXECUTE de
--      authenticated: triggers executam com privilégio do owner; o
--      caller não precisa (nem deve) poder invocá-las via RPC.
--
-- Verificado antes de escrever (banco de produção, 2026-06-09):
--   - portal_list_invoices, portal_list_consolidatable_receivables,
--     portal_create_consolidation, portal_invoice_details,
--     portal_list_demurrage_invoices, portal_get_demurrage_invoice_detail,
--     portal_obsolete_consolidation, portal_list_operation_bls usam
--     current_portal_customer_id() internamente (guard de auth.uid).
--   - detect_overdue_invoices e get_consolidated_invoice_item_breakdown
--     são chamadas pelo app interno (role authenticated) — mantêm
--     EXECUTE para authenticated.
--   - portal_login(text,text), portal_logout(text),
--     portal_get_session_overview(text), resolve_customer_portal_session(text)
--     e portal_check_auth_method(text) são do fluxo de token legado e não
--     têm mais nenhum call site no frontend (candidatas a remoção futura).
--
-- Rollback:
--   GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO anon;        -- caso a caso
--   GRANT EXECUTE ON FUNCTION public.<fn_trigger>() TO authenticated;
------------------------------------------------------------------------

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig,
           p.prorettype = 'trigger'::regtype AS is_trigger
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    IF r.is_trigger THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig);
    END IF;
  END LOOP;
END $$;
