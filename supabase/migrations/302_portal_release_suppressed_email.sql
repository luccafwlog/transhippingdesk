-- 302: A lista de bloqueio de emails do Portal ganha saída.
--
-- Problema de negócio: sete pontos do código consultam
-- `portal_suppressed_emails` e nenhum a apaga. Não havia rota, RPC nem tela que
-- removesse um endereço: o bloqueio era definitivo e nem o operador o desfazia.
-- Para resgatar um cliente cujo endereço foi bloqueado indevidamente, o
-- operador só podia cadastrar um endereço **diferente** -- ou seja, para
-- contornar um sinalizador errado ele gravava um dado errado no cadastro. O
-- sistema empurrava o operador a mentir para o registro, o que é pior que o
-- bloqueio.
--
-- E o bloqueio é opinião de terceiro sobre um fato que muda: quem decidiu
-- "definitivo" foi o Resend olhando uma tentativa num instante. Caixa cheia,
-- servidor em manutenção e domínio em migração dão o mesmo sintoma de endereço
-- morto.
--
-- Desbloquear reexpõe o domínio de envio a bounces, então a liberação exige
-- justificativa e deixa rastro de **quem liberou e por quê** em
-- `portal_provisioning_events`. Se virar hábito, o registro é o que mostra.
--
-- Alternativa descartada -- expirar o bloqueio sozinho após N dias: o sistema
-- não tem como saber que a caixa voltou; só pode chutar um prazo e voltar a
-- enviar para o vazio, gastando reputação do domínio. Quem sabe que voltou é o
-- operador, porque o cliente ligou. Faltava o lugar de registrar, não o prazo.
--
-- O bloqueio é único por endereço (178), não por Cliente: liberar alcança toda
-- conta que usa a mesma caixa. Duas consequências, e as duas estão tratadas
-- abaixo em vez de ignoradas. Primeira: o endereço tem de ser o DESTE Cliente,
-- senão a permissão sobre um Cliente viraria permissão para desbloquear
-- qualquer endereço do sistema, com o rastro gravado no histórico de quem não
-- pediu nada. Segunda: quando a caixa é compartilhada -- o console já conta
-- isso em `shared_email_count` --, cada Cliente afetado recebe o registro no
-- próprio histórico, porque para ele o endereço mudou de estado sem que
-- ninguém o tenha mencionado.
--
-- Rollback: DROP FUNCTION public.portal_release_suppressed_email(BIGINT,TEXT,TEXT).

CREATE OR REPLACE FUNCTION public.portal_release_suppressed_email(p_customer_id BIGINT, p_email TEXT, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_account public.customer_portal_accounts%ROWTYPE;
  v_email TEXT := lower(NULLIF(trim(coalesce(p_email,'')),''));
  v_removed INTEGER;
  v_compartilhada public.customer_portal_accounts%ROWTYPE;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('administrativo','documentacao') THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  IF NULLIF(trim(coalesce(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE='22023'; END IF;
  IF v_email IS NULL THEN RAISE EXCEPTION 'Email inválido.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_account FROM public.customer_portal_accounts WHERE customer_id=p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro de Portal não encontrado.' USING ERRCODE='P0002'; END IF;

  -- O endereço liberado tem de ser o que este Cliente usa. Sem isto, quem pode
  -- operar um Cliente qualquer poderia limpar o bloqueio de qualquer endereço
  -- do sistema, e o único rastro ficaria no histórico do Cliente escolhido para
  -- passar na guarda -- que não tem nada a ver com o endereço liberado.
  IF v_email IS DISTINCT FROM lower(v_account.recovery_email)
     AND v_email IS DISTINCT FROM lower(v_account.pending_recovery_email) THEN
    RAISE EXCEPTION 'Endereço não pertence a este Cliente.' USING ERRCODE='22023';
  END IF;

  DELETE FROM public.portal_suppressed_emails WHERE email = v_email;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  IF v_removed = 0 THEN RAISE EXCEPTION 'Endereço não está na lista de bloqueio.' USING ERRCODE='P0002'; END IF;

  -- O sinal de email quebrado (299) é consequência do bloqueio; liberar sem
  -- limpá-lo deixaria o console acusando falha num endereço que voltou a valer.
  UPDATE public.customer_portal_accounts SET recovery_email_status='ok'
  WHERE lower(recovery_email) = v_email AND recovery_email_status <> 'ok';

  PERFORM public._portal_log_event(
    p_customer_id, v_account.id, NULL,
    v_account.provisioning_decision, v_account.provisioning_decision,
    v_account.account_situation, v_account.account_situation,
    v_role,
    'Endereço ' || v_email || ' liberado da lista de bloqueio de emails. ' || trim(p_reason),
    NULL);

  -- Caixa compartilhada: a liberação já valeu para estes Clientes no DELETE
  -- acima. Registrar só no histórico de quem pediu deixaria os outros com o
  -- endereço reaberto e nenhuma linha explicando quando, por quem e por quê.
  FOR v_compartilhada IN
    SELECT * FROM public.customer_portal_accounts
    WHERE lower(recovery_email) = v_email AND customer_id <> p_customer_id
  LOOP
    PERFORM public._portal_log_event(
      v_compartilhada.customer_id, v_compartilhada.id, NULL,
      v_compartilhada.provisioning_decision, v_compartilhada.provisioning_decision,
      v_compartilhada.account_situation, v_compartilhada.account_situation,
      v_role,
      'Endereço ' || v_email || ' liberado da lista de bloqueio de emails na liberação feita para o Cliente #'
        || p_customer_id || ' (caixa compartilhada). ' || trim(p_reason),
      NULL);
  END LOOP;
END; $$;

REVOKE ALL ON FUNCTION public.portal_release_suppressed_email(BIGINT,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_release_suppressed_email(BIGINT,TEXT,TEXT) TO authenticated;
