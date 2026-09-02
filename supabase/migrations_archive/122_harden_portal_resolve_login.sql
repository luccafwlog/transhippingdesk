-- Renumbered from 20260615210000 (original timestamped migration: 20260615210000_harden_portal_resolve_login.sql).
-- Hardening do resolver anonimo CNPJ/CPF/email -> portal_email.
--
-- O frontend precisa chamar portal_resolve_login antes do signInWithPassword
-- quando o usuario informa CNPJ/CPF. Esta migration reduz enumeracao e abuso
-- mantendo o contrato atual: anon pode executar, mas tentativas sao limitadas
-- por hash do login normalizado e falhas retornam mensagem generica.

CREATE TABLE IF NOT EXISTS public.portal_login_resolution_attempts (
  id BIGSERIAL PRIMARY KEY,
  login_hash TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_login_resolution_attempts_lookup
  ON public.portal_login_resolution_attempts (login_hash, attempted_at DESC);

ALTER TABLE public.portal_login_resolution_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_login_resolution_attempts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_resolve_login(p_login TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_trimmed TEXT := lower(trim(COALESCE(p_login, '')));
  v_digits TEXT := regexp_replace(trim(COALESCE(p_login, '')), '\D', '', 'g');
  v_lookup_key TEXT;
  v_login_hash TEXT;
  v_cutoff TIMESTAMPTZ := now() - INTERVAL '10 minutes';
  v_count INT;
  v_email TEXT;
BEGIN
  IF v_trimmed = '' THEN
    RAISE EXCEPTION 'Credenciais invalidas para o portal do cliente.' USING ERRCODE = '28000';
  END IF;

  IF position('@' IN v_trimmed) > 0 THEN
    v_lookup_key := 'email:' || v_trimmed;
  ELSIF length(v_digits) IN (11, 14) THEN
    v_lookup_key := 'doc:' || v_digits;
  ELSE
    v_lookup_key := 'raw:' || v_trimmed;
  END IF;

  v_login_hash := encode(extensions.digest(v_lookup_key, 'sha256'), 'hex');

  DELETE FROM public.portal_login_resolution_attempts
  WHERE attempted_at < v_cutoff;

  SELECT COUNT(*) INTO v_count
  FROM public.portal_login_resolution_attempts
  WHERE login_hash = v_login_hash
    AND attempted_at >= v_cutoff;

  IF v_count >= 8 THEN
    RAISE EXCEPTION 'Muitas tentativas de acesso. Aguarde alguns minutos antes de tentar novamente.'
      USING ERRCODE = 'P0429';
  END IF;

  INSERT INTO public.portal_login_resolution_attempts (login_hash)
  VALUES (v_login_hash);

  IF position('@' IN v_trimmed) > 0 THEN
    SELECT a.portal_email INTO v_email
    FROM public.customer_portal_accounts AS a
    WHERE a.portal_email = v_trimmed
      AND a.active = true;
  ELSIF length(v_digits) IN (11, 14) THEN
    SELECT a.portal_email INTO v_email
    FROM public.customer_portal_accounts AS a
    WHERE a.login_cnpj = v_digits
      AND a.active = true;
  ELSE
    SELECT a.portal_email INTO v_email
    FROM public.customer_portal_accounts AS a
    WHERE a.portal_email = v_trimmed
      AND a.active = true;
  END IF;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Credenciais invalidas para o portal do cliente.' USING ERRCODE = '28000';
  END IF;

  RETURN v_email;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_resolve_login(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_resolve_login(TEXT) TO anon, authenticated;
