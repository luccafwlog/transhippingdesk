-- Migration 040: Security hardening
--
-- 1. Alarga o CHECK constraint de user_profiles.role para incluir os novos roles
--    que o frontend já reconhece (administrativo, financeiro, operacoes, documentacao).
-- 2. Corrige is_admin() para incluir role='administrativo' (alinhamento com frontend).
-- 3. Cria portal_login_attempts para rate limiting do portal do cliente.
-- 4. Substitui portal_login com: rate limiting por CNPJ (10 tentativas / 15 min)
--    e correção do timing oracle (sempre executa crypt() via dummy hash).

------------------------------------------------------------------------
-- 1. Alargar CHECK constraint de user_profiles.role
------------------------------------------------------------------------

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
    CHECK (role IN ('admin', 'operator', 'administrativo', 'financeiro', 'operacoes', 'documentacao'));

------------------------------------------------------------------------
-- 2. Corrigir is_admin() para incluir 'administrativo'
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'administrativo')
      AND active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

------------------------------------------------------------------------
-- 3. Tabela de log de tentativas de login no portal
------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.portal_login_attempts (
  id            BIGSERIAL PRIMARY KEY,
  cnpj_hash     TEXT        NOT NULL,  -- SHA-256 do CNPJ normalizado (não o CNPJ em texto)
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  succeeded     BOOLEAN     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_portal_login_attempts_cnpj_window
  ON public.portal_login_attempts (cnpj_hash, attempted_at DESC);

ALTER TABLE public.portal_login_attempts ENABLE ROW LEVEL SECURITY;
-- Sem policies = inacessível diretamente por anon/authenticated.
-- A função SECURITY DEFINER bypassa RLS como owner.

-- Limpeza automática: pg_cron pode ser configurado externamente para executar:
-- DELETE FROM public.portal_login_attempts WHERE attempted_at < now() - INTERVAL '30 days';

------------------------------------------------------------------------
-- 4. Substituir portal_login com rate limiting e correção de timing oracle
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.portal_login(
  p_cnpj_cpf TEXT,
  p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cnpj_norm   TEXT;
  v_cnpj_hash   TEXT;
  v_recent      INT;
  v_account     RECORD;
  -- Dummy bcrypt hash custo 6. Garante que sempre há uma chamada crypt()
  -- mesmo quando o CNPJ não existe, eliminando o timing oracle.
  v_dummy_hash  TEXT := '$2a$06$aaaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  v_ok          BOOLEAN;
  v_token       TEXT;
  v_token_hash  TEXT;
BEGIN
  -- 1. Normalizar e hashear o CNPJ para usar como chave de rate limit.
  --    O hash impede enumeração de CNPJs mesmo com acesso direto à tabela.
  v_cnpj_norm := public.normalize_document_text(COALESCE(p_cnpj_cpf, ''));
  v_cnpj_hash := encode(extensions.digest(v_cnpj_norm, 'sha256'), 'hex');

  -- 2. Rate limit: máximo 10 tentativas por CNPJ nos últimos 15 minutos.
  SELECT COUNT(*) INTO v_recent
    FROM public.portal_login_attempts
    WHERE cnpj_hash = v_cnpj_hash
      AND attempted_at > now() - INTERVAL '15 minutes';

  IF COALESCE(v_recent, 0) >= 10 THEN
    INSERT INTO public.portal_login_attempts (cnpj_hash, succeeded)
      VALUES (v_cnpj_hash, false);
    RAISE EXCEPTION 'Muitas tentativas de acesso. Aguarde antes de tentar novamente.'
      USING ERRCODE = 'P0429';
  END IF;

  -- 3. Buscar conta do portal pelo CNPJ normalizado.
  SELECT
    a.id,
    a.customer_id,
    a.password_hash,
    a.contact_email,
    c.name,
    c.cnpj_cpf
  INTO v_account
  FROM public.customer_portal_accounts AS a
  JOIN public.customers AS c ON c.id = a.customer_id
  WHERE public.normalize_document_text(c.cnpj_cpf) = v_cnpj_norm
    AND a.active = true;

  -- 4. Sempre chamar crypt() para evitar timing oracle.
  --    Quando o CNPJ não existe (NOT FOUND), compara contra o dummy hash,
  --    garantindo latência equivalente à de uma senha incorreta.
  v_ok := extensions.crypt(
            COALESCE(p_password, ''),
            CASE WHEN FOUND THEN v_account.password_hash ELSE v_dummy_hash END
          ) = CASE WHEN FOUND THEN v_account.password_hash ELSE v_dummy_hash END;

  -- 5. Registrar a tentativa (independente do resultado).
  INSERT INTO public.portal_login_attempts (cnpj_hash, succeeded)
    VALUES (v_cnpj_hash, FOUND AND v_ok);

  -- 6. Rejeitar com código e mensagem únicos, sem revelar se o CNPJ existe.
  IF NOT FOUND OR NOT v_ok THEN
    RAISE EXCEPTION 'Credenciais invalidas para o portal.' USING ERRCODE = '28000';
  END IF;

  -- 7. Emitir sessão (lógica idêntica à implementação anterior).
  v_token      := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  INSERT INTO public.customer_portal_sessions (
    account_id,
    customer_id,
    token_hash,
    expires_at,
    last_seen_at
  )
  VALUES (
    v_account.id,
    v_account.customer_id,
    v_token_hash,
    now() + INTERVAL '12 hours',
    now()
  );

  UPDATE public.customer_portal_accounts
    SET last_login_at = now()
    WHERE id = v_account.id;

  RETURN jsonb_build_object(
    'token',             v_token,
    'customer_id',       v_account.customer_id,
    'customer_name',     v_account.name,
    'customer_cnpj_cpf', v_account.cnpj_cpf,
    'contact_email',     v_account.contact_email,
    'expires_at',        now() + INTERVAL '12 hours'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.portal_login(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_login(TEXT, TEXT) TO anon, authenticated;
