-- Fix portal auth/provisioning functions to resolve crypto helpers from the
-- extensions schema when running under SECURITY DEFINER with a restricted
-- search_path.

CREATE OR REPLACE FUNCTION public.upsert_customer_portal_account(
  p_customer_id BIGINT,
  p_password TEXT,
  p_contact_email TEXT DEFAULT NULL,
  p_active BOOLEAN DEFAULT true,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_account_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao administrativa.' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(length(trim(COALESCE(p_password, ''))), 0) < 8 THEN
    RAISE EXCEPTION 'Senha do portal deve ter no minimo 8 caracteres.' USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  INSERT INTO public.customer_portal_accounts (
    customer_id,
    contact_email,
    password_hash,
    active,
    created_by
  )
  VALUES (
    p_customer_id,
    NULLIF(trim(COALESCE(p_contact_email, '')), ''),
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    COALESCE(p_active, true),
    v_actor
  )
  ON CONFLICT (customer_id) DO UPDATE
  SET
    contact_email = EXCLUDED.contact_email,
    password_hash = EXCLUDED.password_hash,
    active = EXCLUDED.active,
    updated_at = now()
  RETURNING id INTO v_account_id;

  RETURN public.get_customer_portal_account(p_customer_id);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_customer_portal_account(BIGINT, TEXT, TEXT, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_customer_portal_account(BIGINT, TEXT, TEXT, BOOLEAN, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_customer_portal_session(p_session_token TEXT)
RETURNS TABLE (
  session_id BIGINT,
  account_id BIGINT,
  customer_id BIGINT,
  contact_email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token_hash TEXT;
BEGIN
  v_token_hash := encode(extensions.digest(COALESCE(p_session_token, ''), 'sha256'), 'hex');

  RETURN QUERY
  WITH session_row AS (
    SELECT
      s.id AS session_id,
      s.account_id,
      s.customer_id,
      a.contact_email
    FROM public.customer_portal_sessions AS s
    JOIN public.customer_portal_accounts AS a ON a.id = s.account_id
    WHERE s.token_hash = v_token_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND a.active = true
    LIMIT 1
  )
  UPDATE public.customer_portal_sessions AS s
  SET last_seen_at = now()
  FROM session_row
  WHERE s.id = session_row.session_id
  RETURNING s.id, s.account_id, s.customer_id, session_row.contact_email;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_customer_portal_session(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_customer_portal_session(TEXT) TO anon, authenticated;

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
  v_account RECORD;
  v_token TEXT;
  v_token_hash TEXT;
BEGIN
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
  WHERE public.normalize_document_text(c.cnpj_cpf) = public.normalize_document_text(p_cnpj_cpf)
    AND a.active = true;

  IF NOT FOUND OR v_account.password_hash <> extensions.crypt(COALESCE(p_password, ''), v_account.password_hash) THEN
    RAISE EXCEPTION 'Credenciais invalidas para o portal.' USING ERRCODE = '28000';
  END IF;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
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
    'token', v_token,
    'customer_id', v_account.customer_id,
    'customer_name', v_account.name,
    'customer_cnpj_cpf', v_account.cnpj_cpf,
    'contact_email', v_account.contact_email,
    'expires_at', now() + INTERVAL '12 hours'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.portal_login(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_login(TEXT, TEXT) TO anon, authenticated;
