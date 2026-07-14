-- 179: RPCs da máquina de estados do Portal.
CREATE OR REPLACE FUNCTION public._portal_actor_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
  SELECT CASE up.role WHEN 'admin' THEN 'administrativo' WHEN 'operator' THEN 'documentacao' ELSE up.role END
  FROM public.user_profiles up WHERE up.id = auth.uid() AND up.active = true;
$$;
REVOKE ALL ON FUNCTION public._portal_actor_role() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public._portal_log_event(
  p_customer_id BIGINT, p_account_id BIGINT, p_invite_id BIGINT,
  p_prev_decision TEXT, p_new_decision TEXT, p_prev_situation TEXT, p_new_situation TEXT,
  p_actor_type TEXT, p_reason TEXT, p_request_id TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  INSERT INTO public.portal_provisioning_events
    (customer_id, account_id, invite_id, previous_decision, new_decision,
     previous_situation, new_situation, actor_type, actor_id, reason, request_id)
  VALUES (p_customer_id, p_account_id, p_invite_id, p_prev_decision, p_new_decision,
          p_prev_situation, p_new_situation, p_actor_type, auth.uid(), p_reason, p_request_id);
END;
$$;
REVOKE ALL ON FUNCTION public._portal_log_event(BIGINT,BIGINT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.portal_set_exception(p_customer_id BIGINT, p_reason TEXT, p_request_id TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_role TEXT := public._portal_actor_role(); v_account public.customer_portal_accounts%ROWTYPE;
BEGIN
  IF v_role NOT IN ('administrativo','documentacao') THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_account FROM public.customer_portal_accounts WHERE customer_id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro de Portal não encontrado para o Cliente.' USING ERRCODE='P0002'; END IF;
  IF v_account.account_situation <> 'sem_conta' THEN RAISE EXCEPTION 'Exceção só se aplica a Cliente sem conta/convite em andamento.' USING ERRCODE='22023'; END IF;
  UPDATE public.customer_portal_accounts SET provisioning_decision='provisionamento_nao_necessario' WHERE id=v_account.id;
  PERFORM public._portal_log_event(p_customer_id,v_account.id,NULL,v_account.provisioning_decision,'provisionamento_nao_necessario',v_account.account_situation,v_account.account_situation,v_role,p_reason,p_request_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.portal_set_exception(BIGINT,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.portal_set_exception(BIGINT,TEXT,TEXT) FROM anon;

CREATE OR REPLACE FUNCTION public.portal_return_to_analysis(p_customer_id BIGINT, p_reason TEXT, p_actor_type TEXT DEFAULT NULL, p_request_id TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_role TEXT := public._portal_actor_role(); v_actor TEXT := COALESCE(p_actor_type,v_role); v_account public.customer_portal_accounts%ROWTYPE;
BEGIN
  IF v_actor <> 'sistema' AND v_role NOT IN ('administrativo','documentacao') THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_account FROM public.customer_portal_accounts WHERE customer_id=p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro de Portal não encontrado para o Cliente.' USING ERRCODE='P0002'; END IF;
  IF v_account.provisioning_decision='aguardando_analise' THEN RETURN; END IF;
  UPDATE public.customer_portal_accounts SET provisioning_decision='aguardando_analise' WHERE id=v_account.id;
  PERFORM public._portal_log_event(p_customer_id,v_account.id,NULL,v_account.provisioning_decision,'aguardando_analise',v_account.account_situation,v_account.account_situation,v_actor,p_reason,p_request_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.portal_return_to_analysis(BIGINT,TEXT,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.portal_return_to_analysis(BIGINT,TEXT,TEXT,TEXT) FROM anon;
