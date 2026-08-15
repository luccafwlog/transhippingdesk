-- 300: Troca assistida de Email de Recuperação não deixa link self-service solto.
--
-- Problema de negócio: `portal_assisted_email_change` (195) zera
-- `pending_recovery_email` mas não invalida os convites `confirmacao_email`
-- pendentes da conta. Depois de uma troca assistida, o link que o cliente pediu
-- sozinho segue vivo por até 48h; ao ser clicado, a Edge Function queimava o
-- convite para só então descobrir que não havia troca a aplicar, e devolvia
-- "Link inválido ou expirado" -- mensagem falsa, porque o link estava válido e
-- quem o destruiu foi a própria chamada.
--
-- A checagem de `pending_recovery_email` nula continua sendo o que impede um
-- convite em trânsito de aplicar troca indevida; o que muda aqui é que a troca
-- assistida encerra o convite em vez de deixá-lo apodrecer. A reordenação do
-- consumo do convite vive na Edge Function `portal-recovery-email-change`.
--
-- O convite `recuperacao` pendente cai junto, e é o mais grave dos dois: o link
-- de recuperação **redefine a senha do Portal** e foi enviado ao endereço
-- ANTERIOR -- a caixa que o operador está trocando justamente porque o cliente
-- não a tem mais, ou porque ela nunca foi dele. Deixá-lo vivo por até uma hora
-- depois da troca é manter aberta, na caixa errada, a porta que a troca existe
-- para fechar. De quebra, é o convite que `findReusableRecoveryInvite` teria de
-- ignorar para que o cliente conseguisse um link novo no endereço corrigido.
--
-- O convite `convite` (ativação) NÃO é invalidado aqui: quem o substitui é o
-- fluxo de "Revisar email e reenviar" (`portal-invite-send`), que emite outro no
-- mesmo passo. Encerrá-lo por tabela deixaria a conta em `convite_pendente` sem
-- nenhum link vivo -- um cliente parado no meio da ativação, esperando um email
-- que ninguém mais vai mandar.
--
-- O endereço novo entra sem histórico de bounce, então `recovery_email_status`
-- (299) volta a 'ok' no mesmo UPDATE: manter o sinal do endereço anterior
-- acusaria de quebrado um endereço que nunca foi testado.
--
-- Rollback: restaurar o corpo da migration 195.

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
  UPDATE public.customer_portal_accounts SET recovery_email=lower(p_new_email),recovery_email_source='informado_manualmente',pending_recovery_email=NULL,recovery_email_status='ok' WHERE id=v_account.id;
  UPDATE public.portal_invites SET status='invalidado_por_reenvio' WHERE account_id=v_account.id AND purpose IN ('confirmacao_email','recuperacao') AND status='pendente';
  IF v_account.auth_user_id IS NOT NULL THEN PERFORM public.portal_revoke_sessions(v_account.auth_user_id); END IF;
  PERFORM public._portal_log_event(p_customer_id,v_account.id,NULL,v_account.provisioning_decision,v_account.provisioning_decision,v_account.account_situation,v_account.account_situation,v_role,p_reason || ' Sessões anteriores encerradas.',p_request_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.portal_assisted_email_change(BIGINT,TEXT,TEXT,TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_assisted_email_change(BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC, anon;
