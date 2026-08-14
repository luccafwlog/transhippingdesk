-- 301: Token emitido antes da última troca de credencial deixa de valer.
--
-- Problema de negócio: `portal_revoke_sessions` (194) apaga `auth.sessions` e
-- `auth.refresh_tokens`, o que tira do titular da sessão antiga o direito de
-- **renovar** o access token -- mas não invalida o token que ele já tem em
-- mãos. Um JWT é aceito pela assinatura, sem consulta ao banco, então a sessão
-- antiga sobrevive à troca de senha ou de email pelo TTL do token (1 hora no
-- padrão do Supabase, que este projeto não altera). A tela promete
-- encerramento imediato; o banco entregava com atraso.
--
-- Na suspensão a janela nunca existiu, e por acidente feliz: as RPCs do Portal
-- releem `active` a cada chamada, então token válido não serve de nada com a
-- conta desativada. O guard de estado no ponto de leitura é o padrão certo --
-- falta só um estado a mais para ele vigiar. Este arquivo grava o instante da
-- última revogação de credencial e faz `current_portal_customer_id()` -- o
-- único ponto onde todas as leituras do Portal resolvem o cliente -- recusar
-- token anterior a esse marco. Não é um guard novo por RPC.
--
-- Alternativa descartada: encolher o TTL do access token. Reduz a janela sem
-- fechá-la e cobra tráfego de refresh em todas as telas.
--
-- Folga de 5 segundos: `iat` vem do emissor (GoTrue) e o marco vem do relógio
-- do banco. Sem folga, um desalinhamento de menos de um segundo derrubaria a
-- sessão recém-criada pelo próprio fluxo que revogou as anteriores.
--
-- Limitação registrada: se `auth.jwt()` não trouxer `iat` no contexto da RPC,
-- `v_iat` fica nulo e o guard não rejeita -- a checagem de `active` continua
-- valendo. Preferimos a limitação declarada aqui a espalhar checagens por RPC.
--
-- Rollback: DROP da coluna e restaurar os corpos das migrations 084 e 194.

ALTER TABLE public.customer_portal_accounts
  ADD COLUMN IF NOT EXISTS credentials_revoked_at TIMESTAMPTZ;

COMMENT ON COLUMN public.customer_portal_accounts.credentials_revoked_at IS
  'Instante da última revogação de credencial do Portal. Token com iat anterior é recusado por current_portal_customer_id().';

CREATE OR REPLACE FUNCTION public.portal_revoke_sessions(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  UPDATE public.customer_portal_accounts SET credentials_revoked_at = now() WHERE auth_user_id = p_user_id;
END; $$;
REVOKE ALL ON FUNCTION public.portal_revoke_sessions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_revoke_sessions(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.current_portal_customer_id()
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint;
  v_revoked_at timestamptz;
  v_issued_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  SELECT a.customer_id, a.credentials_revoked_at
  INTO v_customer_id, v_revoked_at
  FROM public.customer_portal_accounts AS a
  WHERE a.auth_user_id = auth.uid()
    AND a.active = true;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  IF v_revoked_at IS NOT NULL THEN
    v_issued_at := to_timestamp(NULLIF(auth.jwt() ->> 'iat', '')::double precision);
    IF v_issued_at IS NOT NULL AND v_issued_at < v_revoked_at - interval '5 seconds' THEN
      RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
    END IF;
  END IF;

  RETURN v_customer_id;
END;
$function$;

-- CREATE OR REPLACE preserva os grants existentes; restatados aqui para que a
-- fronteira fique legível no mesmo arquivo que muda o corpo do guard.
REVOKE ALL ON FUNCTION public.current_portal_customer_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_portal_customer_id() TO authenticated;
