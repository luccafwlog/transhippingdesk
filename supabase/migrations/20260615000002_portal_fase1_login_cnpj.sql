-- FASE 1B: Login por CNPJ (ou email) + função de resolução
--
-- Adiciona coluna login_cnpj à customer_portal_accounts para permitir
-- que o cliente faça login informando CNPJ ou email.
--
-- A resolução é feita pela função portal_resolve_login:
--   - Se a entrada contém "@", busca por portal_email
--   - Se é 14 dígitos (CNPJ), busca por login_cnpj
--   - Se é 11 dígitos (CPF), busca por login_cnpj
--   - Caso contrário, tenta como email primeiro, depois como CNPJ

-- ============================================================================
-- 1. Coluna login_cnpj em customer_portal_accounts
-- ============================================================================

ALTER TABLE public.customer_portal_accounts
  ADD COLUMN IF NOT EXISTS login_cnpj TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accounts_login_cnpj
  ON public.customer_portal_accounts (login_cnpj)
  WHERE login_cnpj IS NOT NULL;

-- ============================================================================
-- 2. Função: portal_resolve_login(p_login)
--    Recebe CNPJ ou email, retorna o portal_email para usar no Supabase Auth.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.portal_resolve_login(p_login TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_normalized TEXT;
  v_email TEXT;
BEGIN
  IF p_login IS NULL OR trim(p_login) = '' THEN
    RAISE EXCEPTION 'Informe o CNPJ ou email para login.' USING ERRCODE = '22023';
  END IF;

  v_normalized := regexp_replace(trim(p_login), '\D', '', 'g');

  -- Se contém @, trata como email
  IF position('@' IN p_login) > 0 THEN
    SELECT a.portal_email INTO v_email
    FROM public.customer_portal_accounts AS a
    WHERE a.portal_email = lower(trim(p_login))
      AND a.active = true;

    IF v_email IS NULL THEN
      RAISE EXCEPTION 'Nenhuma conta de portal encontrada para este email.' USING ERRCODE = '28000';
    END IF;

    RETURN v_email;
  END IF;

  -- Se é CNPJ (14 dígitos) ou CPF (11 dígitos), busca por login_cnpj
  IF length(v_normalized) IN (11, 14) THEN
    SELECT a.portal_email INTO v_email
    FROM public.customer_portal_accounts AS a
    WHERE a.login_cnpj = v_normalized
      AND a.active = true;

    IF v_email IS NOT NULL THEN
      RETURN v_email;
    END IF;
  END IF;

  -- Fallback: tenta como email mesmo sem @ (pode ser email sem @, improvável)
  SELECT a.portal_email INTO v_email
  FROM public.customer_portal_accounts AS a
  WHERE a.portal_email = lower(trim(p_login))
    AND a.active = true;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Nenhuma conta de portal encontrada. Verifique o CNPJ ou email informado.' USING ERRCODE = '28000';
  END IF;

  RETURN v_email;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_resolve_login(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_resolve_login(TEXT) TO authenticated;

-- ============================================================================
-- 3. Atualizar upsert_customer_portal_account para aceitar login_cnpj
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_customer_portal_account(
  p_customer_id BIGINT,
  p_password TEXT,
  p_contact_email TEXT DEFAULT NULL,
  p_active BOOLEAN DEFAULT true,
  p_actor UUID DEFAULT NULL,
  p_login_cnpj TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_account_id BIGINT;
  v_normalized_cnpj TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao administrativa.' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(length(trim(COALESCE(p_password, ''))), 0) < 8 THEN
    RAISE EXCEPTION 'Senha do portal deve ter no minimo 8 caracteres.' USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  IF p_login_cnpj IS NOT NULL AND trim(p_login_cnpj) <> '' THEN
    v_normalized_cnpj := regexp_replace(trim(p_login_cnpj), '\D', '', 'g');
    IF length(v_normalized_cnpj) NOT IN (11, 14) THEN
      RAISE EXCEPTION 'CNPJ/CPF invalido para login do portal.' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.customer_portal_accounts (
    customer_id,
    contact_email,
    password_hash,
    active,
    created_by,
    login_cnpj
  )
  VALUES (
    p_customer_id,
    NULLIF(trim(COALESCE(p_contact_email, '')), ''),
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    COALESCE(p_active, true),
    v_actor,
    v_normalized_cnpj
  )
  ON CONFLICT (customer_id) DO UPDATE
  SET
    contact_email = EXCLUDED.contact_email,
    password_hash = EXCLUDED.password_hash,
    active = EXCLUDED.active,
    login_cnpj = EXCLUDED.login_cnpj,
    updated_at = now()
  RETURNING id INTO v_account_id;

  RETURN public.get_customer_portal_account(p_customer_id);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_customer_portal_account(BIGINT, TEXT, TEXT, BOOLEAN, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_customer_portal_account(BIGINT, TEXT, TEXT, BOOLEAN, UUID, TEXT) TO authenticated;

-- ============================================================================
-- 4. Atualizar portal_get_session_overview_v2 para retornar login_cnpj
-- ============================================================================

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

  SELECT a.id, a.customer_id, a.active, a.contact_email, a.login_cnpj
  INTO v_account
  FROM public.customer_portal_accounts AS a
  WHERE a.auth_user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  IF NOT v_account.active THEN
    RAISE EXCEPTION 'Acesso ao portal desativado. Entre em contato com o suporte.' USING ERRCODE = '28000';
  END IF;

  SELECT c.id, c.name, c.cnpj_cpf, c.pending_balance
  INTO v_customer
  FROM public.customers AS c
  WHERE c.id = v_account.customer_id;

  UPDATE public.customer_portal_accounts
  SET last_login_at = now()
  WHERE id = v_account.id;

  RETURN jsonb_build_object(
    'customer_id',       v_customer.id,
    'customer_name',     v_customer.name,
    'customer_cnpj_cpf', v_customer.cnpj_cpf,
    'cnpj_cpf',          v_customer.cnpj_cpf,
    'pending_balance',   v_customer.pending_balance,
    'contact_email',     v_account.contact_email,
    'account_id',        v_account.id,
    'login_cnpj',        v_account.login_cnpj
  );
END;
$$;

REVOKE ALL ON FUNCTION public.portal_get_session_overview_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_get_session_overview_v2() TO authenticated;

-- ============================================================================
-- 5. Atualizar get_customer_portal_account para retornar login_cnpj
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_customer_portal_account(p_customer_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas.' USING ERRCODE = '42501';
  END IF;

  SELECT TO_JSONB(t.*)
  INTO v_result
  FROM (
    SELECT
      a.id,
      a.customer_id,
      a.contact_email,
      a.active,
      a.login_cnpj,
      a.created_by,
      a.last_login_at,
      a.created_at,
      a.updated_at
    FROM public.customer_portal_accounts AS a
    WHERE a.customer_id = p_customer_id
  ) AS t;

  RETURN COALESCE(v_result, '{}'::JSONB);
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_portal_account(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_portal_account(BIGINT) TO authenticated;
