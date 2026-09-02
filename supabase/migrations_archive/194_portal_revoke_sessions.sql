-- 194: Revogação de sessões do Portal via delete direto em auth.sessions.
--
-- O endpoint admin do GoTrue `POST /auth/v1/admin/users/{id}/logout` retorna 404
-- nesta versão (v2.193.0). O helper revokePortalSessions dependia dele, então a
-- revogação falhava (HTTP 404 → exceção): na recuperação de senha isso causava
-- 500 mesmo com a senha já trocada, e — pior — as sessões não eram encerradas em
-- recuperação de senha e suspensão, violando a decisão do mapa ("nova senha /
-- suspensão encerram todas as sessões"). Esta RPC, chamada por service_role nas
-- Edge Functions, apaga as sessões e refresh tokens do usuário de forma confiável.
CREATE OR REPLACE FUNCTION public.portal_revoke_sessions(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
END; $$;
REVOKE ALL ON FUNCTION public.portal_revoke_sessions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_revoke_sessions(uuid) TO service_role;
