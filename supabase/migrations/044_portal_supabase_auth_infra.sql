-- Migration 044: Infraestrutura para migração do portal para Supabase Auth.
--
-- Contexto: o portal atual usa token em localStorage (vulnerável a XSS).
-- Esta migration adiciona auth_user_id à customer_portal_accounts, permitindo
-- que contas do portal sejam vinculadas a usuários Supabase Auth.
-- A provisão dos usuários Auth é feita via Edge Function provision-portal-user.
--
-- Estratégia de migração progressiva:
-- - Contas com auth_user_id: login via Supabase Auth (supabase.auth.signInWithPassword)
-- - Contas sem auth_user_id: login via token legado (compatibilidade)

ALTER TABLE public.customer_portal_accounts
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS portal_email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accounts_auth_user_id
  ON public.customer_portal_accounts (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- RPC para buscar visão geral da sessão por auth.uid() (sem token legado)
CREATE OR REPLACE FUNCTION public.portal_get_session_overview_v2()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account  RECORD;
  v_customer RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  SELECT a.id, a.customer_id, a.active
  INTO v_account
  FROM public.customer_portal_accounts AS a
  WHERE a.auth_user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  IF NOT v_account.active THEN
    RAISE EXCEPTION 'Acesso ao portal desativado. Entre em contato com o suporte.' USING ERRCODE = '28000';
  END IF;

  SELECT c.id, c.name, c.cnpj_cpf
  INTO v_customer
  FROM public.customers AS c
  WHERE c.id = v_account.customer_id;

  UPDATE public.customer_portal_accounts
  SET last_login_at = now()
  WHERE id = v_account.id;

  RETURN jsonb_build_object(
    'customer_id',   v_customer.id,
    'customer_name', v_customer.name,
    'cnpj_cpf',      v_customer.cnpj_cpf,
    'account_id',    v_account.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.portal_get_session_overview_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_get_session_overview_v2() TO authenticated;

-- Verifica se determinado cnpj_cpf já tem auth_user_id provisionado
-- (usado pelo frontend para decidir qual fluxo de login usar)
CREATE OR REPLACE FUNCTION public.portal_check_auth_method(p_cnpj_cpf TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account RECORD;
BEGIN
  SELECT a.auth_user_id, a.portal_email, a.active
  INTO v_account
  FROM public.customer_portal_accounts AS a
  JOIN public.customers AS c ON c.id = a.customer_id
  WHERE c.cnpj_cpf = p_cnpj_cpf;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('method', 'none', 'active', false);
  END IF;

  IF NOT v_account.active THEN
    RETURN jsonb_build_object('method', 'inactive', 'active', false);
  END IF;

  IF v_account.auth_user_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'method', 'supabase_auth',
      'portal_email', v_account.portal_email,
      'active', true
    );
  END IF;

  RETURN jsonb_build_object('method', 'legacy_token', 'active', true);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_check_auth_method(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_check_auth_method(TEXT) TO anon, authenticated;
