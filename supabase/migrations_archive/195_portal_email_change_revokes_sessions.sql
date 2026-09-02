-- 195: Troca de Email de Recuperação passa a encerrar sessões existentes.
--
-- Achado durante o gate de segurança "Troca de Email de Recuperação" do piloto
-- (#370): a troca (self-service via portal-recovery-email-change, ou assistida
-- via portal_assisted_email_change) não revogava sessões abertas em outros
-- dispositivos. Decisão de produto atualizada: mesmo racional da troca de
-- senha — alterar para onde a recuperação futura é enviada é sensível o
-- suficiente para exigir reautenticação em todos os dispositivos.
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
  IF v_account.auth_user_id IS NOT NULL THEN PERFORM public.portal_revoke_sessions(v_account.auth_user_id); END IF;
  PERFORM public._portal_log_event(p_customer_id,v_account.id,NULL,v_account.provisioning_decision,v_account.provisioning_decision,v_account.account_situation,v_account.account_situation,v_role,p_reason || ' Sessões anteriores encerradas.',p_request_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.portal_assisted_email_change(BIGINT,TEXT,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.portal_assisted_email_change(BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC, anon;
