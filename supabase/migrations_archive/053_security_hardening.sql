-- Migration 053: Security hardening — 3 fixes
--
-- R3: portal_check_auth_method — remover user enumeration.
--     Retorna resposta unificada para CNPJ inexistente e inativo,
--     impedindo varredura de CNPJs de clientes via API anon.
--
-- R5: check_provision_rate_limit — rate limit persistente para
--     provision-portal-user (substitui mapa em memória da Edge Function).
--
-- Tabela auxiliar: provision_rate_limit_log para rastrear chamadas.

------------------------------------------------------------------------
-- R3: Corrigir user enumeration em portal_check_auth_method
------------------------------------------------------------------------

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

  -- Resposta unificada para CNPJ inexistente e conta inativa.
  -- Não revelar se o CNPJ está cadastrado.
  IF NOT FOUND OR NOT v_account.active THEN
    RETURN jsonb_build_object('method', 'none');
  END IF;

  IF v_account.auth_user_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'method', 'supabase_auth',
      'portal_email', v_account.portal_email
    );
  END IF;

  RETURN jsonb_build_object('method', 'legacy_token');
END;
$$;

REVOKE ALL ON FUNCTION public.portal_check_auth_method(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_check_auth_method(TEXT) TO anon, authenticated;

------------------------------------------------------------------------
-- R5: Rate limit persistente para provision-portal-user
------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.provision_rate_limit_log (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     UUID         NOT NULL,
  called_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provision_rate_limit_user_window
  ON public.provision_rate_limit_log (user_id, called_at DESC);

ALTER TABLE public.provision_rate_limit_log ENABLE ROW LEVEL SECURITY;
-- Sem policies: inacessível diretamente — acesso apenas via SECURITY DEFINER.

-- Retorna TRUE se a chamada é permitida (registra a tentativa).
-- Retorna FALSE se o usuário excedeu 20 chamadas na última hora.
CREATE OR REPLACE FUNCTION public.check_provision_rate_limit(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM public.provision_rate_limit_log
    WHERE user_id = p_user_id
      AND called_at > now() - INTERVAL '1 hour';

  IF v_count >= 20 THEN
    RETURN false;
  END IF;

  INSERT INTO public.provision_rate_limit_log (user_id) VALUES (p_user_id);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.check_provision_rate_limit(UUID) FROM PUBLIC;
-- Executada com service_role pela Edge Function (bypass RLS implícito).
GRANT EXECUTE ON FUNCTION public.check_provision_rate_limit(UUID) TO service_role;

-- Limpeza automática: entradas com mais de 2 dias são irrelevantes.
SELECT cron.schedule(
  'cleanup-provision-rate-limit',
  '30 3 * * *',
  $$DELETE FROM public.provision_rate_limit_log WHERE called_at < now() - INTERVAL '2 days'$$
);
