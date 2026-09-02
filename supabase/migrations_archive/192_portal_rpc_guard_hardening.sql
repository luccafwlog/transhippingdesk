-- 192: Corrige falha de autorização nas RPCs de provisionamento do Portal.
--
-- Dois defeitos combinados, encontrados em teste de isolamento por CNPJ contra
-- o banco de produção (2026-07-14):
--   1. REVOKE ... FROM anon não remove o EXECUTE default do PUBLIC, então o
--      role `anon` (REST público) alcançava as RPCs.
--   2. As guardas `v_role <> 'administrativo'` / `v_role NOT IN (...)` retornam
--      NULL quando `_portal_actor_role()` é NULL (anon, ou qualquer identidade
--      `authenticated` sem perfil interno ativo — incluindo clientes do Portal),
--      então o `RAISE ... permission denied` não disparava (fail-open).
--
-- Como clientes do Portal também autenticam como role `authenticated`, a guarda
-- — e não o grant — é a fronteira efetiva. Aqui endurecemos ambas as camadas.
-- Escopo restrito ao Portal; o audit global de RBAC continua em frente separada.

-- Camada de privilégio: remove o EXECUTE herdado do PUBLIC. `authenticated` e
-- `service_role` mantêm os grants explícitos existentes.
REVOKE EXECUTE ON FUNCTION public.portal_set_exception(BIGINT,TEXT,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.portal_return_to_analysis(BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.portal_provisioning_backfill(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.portal_provisioning_preflight() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.portal_admin_change_cnpj(BIGINT,TEXT,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.portal_cancel_invite(BIGINT,TEXT,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.portal_assisted_email_change(BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.portal_current_role() FROM PUBLIC;

-- Camada de guarda: comparações NULL-safe para negar role indefinido.

CREATE OR REPLACE FUNCTION public.portal_set_exception(p_customer_id BIGINT, p_reason TEXT, p_request_id TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_role TEXT := public._portal_actor_role(); v_account public.customer_portal_accounts%ROWTYPE;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('administrativo','documentacao') THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_account FROM public.customer_portal_accounts WHERE customer_id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro de Portal não encontrado para o Cliente.' USING ERRCODE='P0002'; END IF;
  IF v_account.account_situation <> 'sem_conta' THEN RAISE EXCEPTION 'Exceção só se aplica a Cliente sem conta/convite em andamento.' USING ERRCODE='22023'; END IF;
  UPDATE public.customer_portal_accounts SET provisioning_decision='provisionamento_nao_necessario' WHERE id=v_account.id;
  PERFORM public._portal_log_event(p_customer_id,v_account.id,NULL,v_account.provisioning_decision,'provisionamento_nao_necessario',v_account.account_situation,v_account.account_situation,v_role,p_reason,p_request_id);
END; $$;

CREATE OR REPLACE FUNCTION public.portal_return_to_analysis(p_customer_id BIGINT, p_reason TEXT, p_actor_type TEXT DEFAULT NULL, p_request_id TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_role TEXT := public._portal_actor_role(); v_actor TEXT := CASE WHEN auth.role() = 'service_role' THEN 'sistema' ELSE v_role END; v_account public.customer_portal_accounts%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND (v_role IS NULL OR v_role NOT IN ('administrativo','documentacao')) THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_account FROM public.customer_portal_accounts WHERE customer_id=p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro de Portal não encontrado para o Cliente.' USING ERRCODE='P0002'; END IF;
  IF v_account.provisioning_decision='aguardando_analise' THEN RETURN; END IF;
  UPDATE public.customer_portal_accounts SET provisioning_decision='aguardando_analise' WHERE id=v_account.id;
  PERFORM public._portal_log_event(p_customer_id,v_account.id,NULL,v_account.provisioning_decision,'aguardando_analise',v_account.account_situation,v_account.account_situation,v_actor,p_reason,p_request_id);
END; $$;

CREATE OR REPLACE FUNCTION public.portal_provisioning_backfill(p_request_id TEXT DEFAULT NULL)
RETURNS TABLE(created_records BIGINT) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_role TEXT := public._portal_actor_role(); v_created BIGINT;
BEGIN
  IF v_role IS DISTINCT FROM 'administrativo' THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  WITH inserted AS (
    INSERT INTO public.customer_portal_accounts(customer_id,active,provisioning_decision,account_situation,login_cnpj)
    SELECT c.id,false,'aguardando_analise','sem_conta',regexp_replace(c.cnpj_cpf,'\D','','g')
    FROM public.customers c WHERE NOT EXISTS (SELECT 1 FROM public.customer_portal_accounts a WHERE a.customer_id=c.id)
    RETURNING id,customer_id
  )
  INSERT INTO public.portal_provisioning_events(customer_id,account_id,new_decision,new_situation,actor_type,actor_id,reason,request_id)
  SELECT customer_id,id,'aguardando_analise','sem_conta','sistema',auth.uid(),'Backfill inicial do Portal',p_request_id FROM inserted;
  GET DIAGNOSTICS v_created=ROW_COUNT;
  RETURN QUERY SELECT v_created;
END; $$;

CREATE OR REPLACE FUNCTION public.portal_provisioning_preflight()
RETURNS TABLE(total_customers BIGINT, existing_portal_records BIGINT, existing_auth_links BIGINT, existing_recovery_emails BIGINT, customers_missing_record BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND public._portal_actor_role() IS DISTINCT FROM 'administrativo' THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  RETURN QUERY
    SELECT (SELECT count(*) FROM public.customers),
           (SELECT count(*) FROM public.customer_portal_accounts),
           (SELECT count(*) FROM public.customer_portal_accounts WHERE auth_user_id IS NOT NULL),
           (SELECT count(*) FROM public.customer_portal_accounts WHERE recovery_email IS NOT NULL),
           (SELECT count(*) FROM public.customers c WHERE NOT EXISTS (SELECT 1 FROM public.customer_portal_accounts a WHERE a.customer_id=c.id));
END; $$;

CREATE OR REPLACE FUNCTION public.portal_admin_change_cnpj(p_customer_id BIGINT, p_new_cnpj TEXT, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_role TEXT:=public._portal_actor_role(); v_normalized TEXT:=regexp_replace(coalesce(p_new_cnpj,''),'\D','','g'); v_account public.customer_portal_accounts%ROWTYPE;
BEGIN
  IF v_role IS DISTINCT FROM 'administrativo' THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  IF length(v_normalized)<>14 THEN RAISE EXCEPTION 'CNPJ inválido.' USING ERRCODE='22023'; END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_account FROM public.customer_portal_accounts WHERE customer_id=p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro de Portal não encontrado para o Cliente.' USING ERRCODE='P0002'; END IF;
  PERFORM set_config('portal.allow_cnpj_change','true',true);
  UPDATE public.customers SET cnpj_cpf=v_normalized WHERE id=p_customer_id;
  UPDATE public.customer_portal_accounts SET login_cnpj=v_normalized WHERE id=v_account.id;
  PERFORM public._portal_log_event(p_customer_id,v_account.id,NULL,v_account.provisioning_decision,v_account.provisioning_decision,v_account.account_situation,v_account.account_situation,'administrativo',p_reason,NULL);
  PERFORM set_config('portal.allow_cnpj_change','false',true);
END; $$;

CREATE OR REPLACE FUNCTION public.portal_cancel_invite(p_customer_id BIGINT,p_reason TEXT,p_request_id TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_role TEXT:=public._portal_actor_role(); v_account public.customer_portal_accounts%ROWTYPE; v_invite BIGINT;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('administrativo','documentacao') THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_account FROM public.customer_portal_accounts WHERE customer_id=p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro de Portal não encontrado.' USING ERRCODE='P0002'; END IF;
  SELECT id INTO v_invite FROM public.portal_invites WHERE account_id=v_account.id AND purpose='convite' AND status='pendente' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF v_invite IS NULL THEN RAISE EXCEPTION 'Não há convite pendente para cancelar.' USING ERRCODE='P0002'; END IF;
  UPDATE public.portal_invites SET status='cancelado',cancelled_reason=p_reason WHERE id=v_invite;
  UPDATE public.customer_portal_accounts SET account_situation='sem_conta',provisioning_decision='aguardando_analise' WHERE id=v_account.id;
  PERFORM public._portal_log_event(p_customer_id,v_account.id,v_invite,v_account.provisioning_decision,'aguardando_analise',v_account.account_situation,'sem_conta',v_role,p_reason,p_request_id);
END; $$;

CREATE OR REPLACE FUNCTION public.portal_assisted_email_change(p_customer_id BIGINT,p_new_email TEXT,p_reason TEXT,p_request_id TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_role TEXT:=public._portal_actor_role(); v_account public.customer_portal_accounts%ROWTYPE;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('administrativo','documentacao') THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE='22023'; END IF;
  IF p_new_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Email inválido.' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.portal_suppressed_emails WHERE email=lower(p_new_email)) THEN RAISE EXCEPTION 'Endereço suprimido por bounce/complaint. Informe outro.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_account FROM public.customer_portal_accounts WHERE customer_id=p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro de Portal não encontrado.' USING ERRCODE='P0002'; END IF;
  UPDATE public.customer_portal_accounts SET recovery_email=lower(p_new_email),recovery_email_source='informado_manualmente',pending_recovery_email=NULL WHERE id=v_account.id;
  PERFORM public._portal_log_event(p_customer_id,v_account.id,NULL,v_account.provisioning_decision,v_account.provisioning_decision,v_account.account_situation,v_account.account_situation,v_role,p_reason,p_request_id);
END; $$;
