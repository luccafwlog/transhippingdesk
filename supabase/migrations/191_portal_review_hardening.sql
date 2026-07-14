-- 191: Correções de segurança e operação identificadas na revisão da PR.

-- Helpers de auditoria nunca são endpoints públicos.
REVOKE ALL ON FUNCTION public._portal_actor_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._portal_log_event(BIGINT,BIGINT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;

-- O ator sistema só pode ser escolhido pelo contexto service_role, nunca pelo JSON
-- de uma chamada autenticada.
CREATE OR REPLACE FUNCTION public.portal_return_to_analysis(p_customer_id BIGINT, p_reason TEXT, p_actor_type TEXT DEFAULT NULL, p_request_id TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_role TEXT := public._portal_actor_role(); v_actor TEXT := CASE WHEN auth.role() = 'service_role' THEN 'sistema' ELSE v_role END; v_account public.customer_portal_accounts%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' AND v_role NOT IN ('administrativo','documentacao') THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_account FROM public.customer_portal_accounts WHERE customer_id=p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro de Portal não encontrado para o Cliente.' USING ERRCODE='P0002'; END IF;
  IF v_account.provisioning_decision='aguardando_analise' THEN RETURN; END IF;
  UPDATE public.customer_portal_accounts SET provisioning_decision='aguardando_analise' WHERE id=v_account.id;
  PERFORM public._portal_log_event(p_customer_id,v_account.id,NULL,v_account.provisioning_decision,'aguardando_analise',v_account.account_situation,v_account.account_situation,v_actor,p_reason,p_request_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.portal_return_to_analysis(BIGINT,TEXT,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.portal_return_to_analysis(BIGINT,TEXT,TEXT,TEXT) FROM anon;

-- Recovery possui um orçamento separado do login; CNPJ público não pode
-- bloquear o login por repetir apenas o endpoint de recuperação.
CREATE OR REPLACE FUNCTION public.portal_recovery_check_rate_limit(p_login TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_hash TEXT; v_count INTEGER;
BEGIN
  v_hash := encode(extensions.digest(regexp_replace(coalesce(p_login,''),'\D','','g'),'sha256'),'hex');
  SELECT count(*) INTO v_count FROM public.portal_login_attempts WHERE cnpj_hash=v_hash AND attempted_at > now()-interval '15 minutes' AND succeeded=false AND source='recovery';
  RETURN coalesce(v_count,0) >= 5;
END; $$;

CREATE OR REPLACE FUNCTION public.portal_recovery_register_failure(p_login TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
  INSERT INTO public.portal_login_attempts(cnpj_hash,succeeded,source)
  VALUES (encode(extensions.digest(regexp_replace(coalesce(p_login,''),'\D','','g'),'sha256'),'hex'),false,'recovery');
END; $$;

REVOKE ALL ON FUNCTION public.portal_recovery_check_rate_limit(TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.portal_recovery_register_failure(TEXT) FROM PUBLIC,anon,authenticated;
