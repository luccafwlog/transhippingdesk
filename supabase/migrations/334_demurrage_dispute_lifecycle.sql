-- 334: ciclo de vida autoritativo da Dispute e eventos do Portal.
-- Rollback: restaurar as funções 325/331 apenas em banco descartável.

CREATE OR REPLACE FUNCTION public.portal_add_dispute_message(p_demurrage_invoice_id BIGINT, p_body TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_invoice RECORD;
  v_dispute RECORD;
  v_dispute_id BIGINT;
  v_message_id BIGINT;
BEGIN
  IF NULLIF(btrim(p_body), '') IS NULL THEN RAISE EXCEPTION 'Informe a mensagem da disputa.' USING ERRCODE = '22023'; END IF;
  PERFORM public.check_portal_rate_limit('open_dispute', 3, 30);
  SELECT id, customer_id, doc_number INTO v_invoice
  FROM public.demurrage_invoices
  WHERE id = p_demurrage_invoice_id AND customer_id = v_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fatura de demurrage não encontrada.' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_dispute
  FROM public.demurrage_disputes
  WHERE demurrage_invoice_id = v_invoice.id AND state = 'aberta'
  ORDER BY id DESC LIMIT 1 FOR UPDATE;
  IF v_dispute.id IS NOT NULL AND v_dispute.next_responder <> 'cliente' THEN
    RAISE EXCEPTION 'Aguarde a resposta de Equipamentos.' USING ERRCODE = '42501';
  END IF;
  v_dispute_id := COALESCE(v_dispute.id, public.ensure_demurrage_dispute(v_invoice.id, v_customer_id, 'cliente', NULL));

  INSERT INTO public.demurrage_dispute_messages(dispute_id, author_id, author_type, body, next_responder, metadata)
  VALUES (v_dispute_id, auth.uid(), 'cliente', btrim(p_body), 'equipamentos', jsonb_build_object('channel', 'portal'))
  RETURNING id INTO v_message_id;
  UPDATE public.demurrage_disputes SET state = 'aberta', next_responder = 'equipamentos', resolved_at = NULL, cancelled_at = NULL WHERE id = v_dispute_id;
  UPDATE public.demurrage_invoices SET dispute_open = true, dispute_status = 'aberto', dispute_reason = COALESCE(dispute_reason, btrim(p_body)) WHERE id = v_invoice.id;
  INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
  SELECT v_customer_id, NULL, 'dispute_opened', 'Disputa registrada', 'Sua disputa de demurrage foi registrada.', '/demurrage'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.portal_notifications n
    WHERE n.customer_id = v_customer_id AND n.type = 'dispute_opened'
      AND n.created_at > now() - interval '30 minutes'
      AND n.message = 'Sua disputa de demurrage foi registrada.'
  );
  PERFORM public.block521_upsert_alert('portal_dispute_opened', 'demurrage_invoice', v_invoice.id::text,
    'Cliente enviou mensagem na Dispute ' || v_invoice.doc_number || '; resposta de Equipamentos pendente.',
    'portal_dispute_message', 'equipamentos', jsonb_build_object('dispute_id', v_dispute_id, 'message_id', v_message_id),
    '/demurrage?dispute=' || v_dispute_id);
  RETURN jsonb_build_object('dispute_id', v_dispute_id, 'message_id', v_message_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_demurrage_dispute_message(p_dispute_id BIGINT, p_body TEXT, p_next_responder TEXT DEFAULT 'cliente')
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_dispute public.demurrage_disputes%ROWTYPE;
  v_message_id BIGINT;
  v_resolved BOOLEAN := p_next_responder = 'ninguem';
BEGIN
  IF v_role <> 'equipamentos' THEN RAISE EXCEPTION 'Apenas Equipamentos pode responder a Dispute.' USING ERRCODE = '42501'; END IF;
  IF NULLIF(btrim(p_body), '') IS NULL THEN RAISE EXCEPTION 'Informe a mensagem da disputa.' USING ERRCODE = '22023'; END IF;
  IF p_next_responder NOT IN ('cliente', 'equipamentos', 'ninguem') THEN RAISE EXCEPTION 'Responsável inválido.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_dispute FROM public.demurrage_disputes WHERE id = p_dispute_id FOR UPDATE;
  IF NOT FOUND OR v_dispute.state <> 'aberta' THEN RAISE EXCEPTION 'Dispute não está aberta.' USING ERRCODE = '42501'; END IF;
  IF v_dispute.next_responder <> 'equipamentos' THEN RAISE EXCEPTION 'A Dispute aguarda manifestação do cliente.' USING ERRCODE = '42501'; END IF;

  INSERT INTO public.demurrage_dispute_messages(dispute_id, author_id, author_type, body, next_responder, metadata)
  VALUES (p_dispute_id, auth.uid(), 'equipamentos', btrim(p_body), p_next_responder, jsonb_build_object('channel', 'internal'))
  RETURNING id INTO v_message_id;
  IF v_resolved THEN
    UPDATE public.demurrage_disputes SET state = 'resolvida', next_responder = 'ninguem', resolved_at = now() WHERE id = p_dispute_id;
    UPDATE public.demurrage_invoices SET dispute_open = false, dispute_status = 'resolvido' WHERE id = v_dispute.demurrage_invoice_id;
  ELSE
    UPDATE public.demurrage_disputes SET state = 'aberta', next_responder = p_next_responder WHERE id = p_dispute_id;
    UPDATE public.demurrage_invoices SET dispute_open = true, dispute_status = 'aberto' WHERE id = v_dispute.demurrage_invoice_id;
  END IF;
  IF p_next_responder = 'cliente' THEN
    INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
    SELECT v_dispute.customer_id, NULL, 'dispute_responded', 'Disputa respondida', 'Equipamentos respondeu à sua disputa.', '/demurrage';
    PERFORM public.block521_resolve_alert('portal_dispute_opened', 'demurrage_invoice', v_dispute.demurrage_invoice_id::text, 'equipamentos', 'portal_dispute_message');
  ELSE
    PERFORM public.block521_resolve_alert('portal_dispute_opened', 'demurrage_invoice', v_dispute.demurrage_invoice_id::text, 'equipamentos', 'portal_dispute_message');
  END IF;
  RETURN jsonb_build_object('dispute_id', p_dispute_id, 'message_id', v_message_id, 'state', CASE WHEN v_resolved THEN 'resolvida' ELSE 'aberta' END);
END;
$function$;

REVOKE ALL ON FUNCTION public.portal_add_dispute_message(BIGINT, TEXT), public.add_demurrage_dispute_message(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_add_dispute_message(BIGINT, TEXT), public.add_demurrage_dispute_message(BIGINT, TEXT, TEXT) TO authenticated;
