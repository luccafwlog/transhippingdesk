-- 186: papel público mínimo, cancelamento e ciclo de suspensão.
CREATE OR REPLACE FUNCTION public.portal_current_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$ SELECT public._portal_actor_role(); $$;
GRANT EXECUTE ON FUNCTION public.portal_current_role() TO authenticated;
REVOKE ALL ON FUNCTION public.portal_current_role() FROM anon;

CREATE OR REPLACE FUNCTION public.portal_cancel_invite(p_customer_id BIGINT,p_reason TEXT,p_request_id TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_role TEXT:=public._portal_actor_role(); v_account public.customer_portal_accounts%ROWTYPE; v_invite BIGINT;
BEGIN
  IF v_role NOT IN ('administrativo','documentacao') THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_account FROM public.customer_portal_accounts WHERE customer_id=p_customer_id FOR UPDATE;
  UPDATE public.portal_invites SET status='cancelado',cancelled_reason=p_reason WHERE account_id=v_account.id AND status='pendente' RETURNING id INTO v_invite;
  IF v_invite IS NULL THEN RAISE EXCEPTION 'Não há convite pendente para cancelar.' USING ERRCODE='P0002'; END IF;
  UPDATE public.customer_portal_accounts SET account_situation='sem_conta',provisioning_decision='aguardando_analise' WHERE id=v_account.id;
  PERFORM public._portal_log_event(p_customer_id,v_account.id,v_invite,v_account.provisioning_decision,'aguardando_analise',v_account.account_situation,'sem_conta',v_role,p_reason,p_request_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.portal_cancel_invite(BIGINT,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.portal_cancel_invite(BIGINT,TEXT,TEXT) FROM anon;
