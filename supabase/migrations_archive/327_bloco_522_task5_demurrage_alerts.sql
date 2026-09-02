-- 327: Bloco 3 (#522), Task 5 — disputa Demurrage e produtores sem ação.
-- O contrato do épico #519 mantém a conversa de Dispute no Portal (#521), mas
-- só cria trabalho interno enquanto a próxima resposta for Equipamentos.
-- Esta migration é aditiva: não reescreve 318/321 nem apaga histórico.
-- Rollback: restaurar as definições anteriores dos RPCs Portal e o trigger de
-- roteamento sem o filtro desta versão.

-- A tabela demurrage_disputes é criada pelo #521. O fallback mantém a abertura
-- legada correta até que a tabela esteja aplicada; quando presente, ela é a
-- fonte de verdade da próxima ação.
CREATE OR REPLACE FUNCTION public.sync_demurrage_dispute_alert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_next_responder TEXT;
BEGIN
  v_next_responder := CASE
    WHEN NEW.dispute_open AND COALESCE(NEW.dispute_status, 'aberto') NOT IN ('resolvido', 'cancelado') THEN 'equipamentos'
    ELSE 'ninguem'
  END;

  IF to_regclass('public.demurrage_disputes') IS NOT NULL THEN
    EXECUTE $sql$
      SELECT d.next_responder FROM public.demurrage_disputes d
      WHERE d.demurrage_invoice_id = $1 AND d.state = 'aberta'
      ORDER BY d.updated_at DESC, d.id DESC LIMIT 1
    $sql$ INTO v_next_responder USING NEW.id;
  END IF;

  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  IF v_next_responder IN ('cliente', 'ninguem') THEN
    -- A conversa permanece visível; não existe cobrança interna.
    PERFORM public.resolve_alert_item(
      'portal_dispute_opened', 'demurrage_invoice', NEW.id::TEXT,
      'demurrage_dispute', jsonb_build_object('next_responder', v_next_responder)
    );
  ELSIF NEW.dispute_open
    AND COALESCE(NEW.dispute_status, 'aberto') NOT IN ('resolvido', 'cancelado')
    AND v_next_responder = 'equipamentos' THEN
    PERFORM public.upsert_alert_item(
      'portal_dispute_opened', 'demurrage_invoice', NEW.id::TEXT,
      'Disputa de invoice Demurrage ' || COALESCE(NEW.doc_number, '#' || NEW.id::TEXT) || '; ação de Equipamentos pendente.',
      'demurrage_dispute', jsonb_build_object('next_responder', v_next_responder), '/demurrage'
    );
  ELSE
    PERFORM public.resolve_alert_item(
      'portal_dispute_opened', 'demurrage_invoice', NEW.id::TEXT,
      'demurrage_dispute', jsonb_build_object('next_responder', COALESCE(v_next_responder, 'ninguem'))
    );
  END IF;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sync_demurrage_dispute_alert_on_change ON public.demurrage_invoices;
CREATE TRIGGER sync_demurrage_dispute_alert_on_change
  AFTER INSERT OR UPDATE OF dispute_open, dispute_status ON public.demurrage_invoices
  FOR EACH ROW EXECUTE FUNCTION public.sync_demurrage_dispute_alert();
REVOKE ALL ON FUNCTION public.sync_demurrage_dispute_alert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_demurrage_dispute_alert() TO service_role;

-- Reaplica os três RPCs finais conhecidos sem inserir carriers sem ação.
CREATE OR REPLACE FUNCTION public.portal_create_consolidation(p_receivable_ids BIGINT[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_ids BIGINT[];
  v_result JSONB;
BEGIN
  PERFORM public.check_portal_rate_limit('create_consolidation', 3, 10);
  SELECT ARRAY_AGG(DISTINCT id ORDER BY id) INTO v_ids
  FROM UNNEST(COALESCE(p_receivable_ids, ARRAY[]::BIGINT[])) AS u(id) WHERE id IS NOT NULL;
  IF EXISTS (SELECT 1 FROM public.bl_receivables br WHERE br.id = ANY(v_ids) AND br.customer_id <> v_customer_id) THEN
    RAISE EXCEPTION 'Selecao contem B/Ls de outro cliente.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bl_receivables br WHERE br.id = ANY(v_ids) AND NOT public.bl_has_portal_release(br.bl_id)) THEN
    RAISE EXCEPTION 'Selecao contem B/L sem CE Mercante liberado para o portal.' USING ERRCODE = '42501';
  END IF;
  v_result := public.create_local_consolidated_invoice_core(v_customer_id, p_receivable_ids, auth.uid(), 'portal');
  INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
  VALUES (v_customer_id, 'system', 'Fatura consolidada criada',
    'Sua fatura consolidada foi gerada com ' || array_length(p_receivable_ids, 1) || ' B/L(s).', '/portal/billing');
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.portal_create_consolidation(BIGINT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_create_consolidation(BIGINT[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.portal_obsolete_consolidation(p_invoice_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_invoice RECORD;
BEGIN
  PERFORM public.check_portal_rate_limit('obsolete_consolidation', 3, 15);
  SELECT i.id, i.status, i.invoice_type, i.customer_id, i.invoice_number INTO v_invoice
  FROM public.invoices i WHERE i.id = p_invoice_id AND i.customer_id = v_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fatura nao encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF v_invoice.invoice_type != 'consolidated' THEN RAISE EXCEPTION 'Esta fatura nao e uma consolidada.' USING ERRCODE = 'P0002'; END IF;
  IF v_invoice.status IN ('paid', 'covered', 'cancelled', 'obsolete') THEN RAISE EXCEPTION 'Esta fatura ja foi paga ou cancelada e nao pode ser desfeita.' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = p_invoice_id) THEN RAISE EXCEPTION 'Fatura com pagamento registrado nao pode ser desfeita.' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
  VALUES (p_invoice_id, 'obsolete', NULL, jsonb_build_object('reason', 'obsoleted_by_customer', 'origin', 'portal', 'customer_id', v_customer_id));
  UPDATE public.invoices SET status = 'obsolete', obsolete_reason = 'Desfeita pelo cliente pelo portal.', updated_at = now() WHERE id = p_invoice_id;
  UPDATE public.invoice_receivable_links SET status = 'obsolete' WHERE invoice_id = p_invoice_id AND status = 'active';
  INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
  VALUES (v_customer_id, 'system', 'Consolidacao desfeita',
    'A fatura ' || COALESCE(v_invoice.invoice_number, '#' || p_invoice_id) || ' foi desfeita. Os B/Ls estao disponiveis para nova consolidacao.', '/portal/billing');
  RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.portal_obsolete_consolidation(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_obsolete_consolidation(BIGINT) TO authenticated;

-- Fecha carriers antigos por evento de lifecycle; não remove alerts, items,
-- eventos, notificações ou audit_logs.
DO $cleanup$
DECLARE v_item RECORD;
BEGIN
  FOR v_item IN SELECT id, occurrence_id FROM public.alert_items WHERE status = 'active' AND item_type IN ('portal_invoice_created', 'portal_consolidation_obsoleted', 'invoice_payment_invalid', 'invoice_cancel_blocked') LOOP
    INSERT INTO public.alert_item_events (alert_item_id, occurrence_id, event_type, previous_status, new_status, actor_id, metadata)
    VALUES (v_item.id, v_item.occurrence_id, 'resolved', 'active', 'resolved', NULL, jsonb_build_object('source', 'bloco_522_task5', 'reason', 'no_internal_action'));
    UPDATE public.alert_items SET status = 'resolved', resolved_at = COALESCE(resolved_at, now()), updated_at = now() WHERE id = v_item.id;
  END LOOP;
  UPDATE public.alerts SET status = 'closed', closed_at = COALESCE(closed_at, now())
  WHERE type IN ('portal_invoice_created', 'portal_consolidation_obsoleted', 'invoice_payment_invalid', 'invoice_cancel_blocked')
     OR (type = 'aggregate' AND EXISTS (SELECT 1 FROM public.alert_items i WHERE i.alert_id = alerts.id AND i.item_type IN ('portal_invoice_created', 'portal_consolidation_obsoleted', 'invoice_payment_invalid', 'invoice_cancel_blocked'))
       AND NOT EXISTS (SELECT 1 FROM public.alert_items i WHERE i.alert_id = alerts.id AND i.status = 'active'));
END;
$cleanup$;

-- Compatibilidade para assinaturas históricas que ainda insiram diretamente.
DROP TRIGGER IF EXISTS route_catalog_alert_insert ON public.alerts;
CREATE TRIGGER route_catalog_alert_insert AFTER INSERT ON public.alerts
FOR EACH ROW WHEN (NEW.type NOT IN ('portal_invoice_created', 'portal_consolidation_obsoleted', 'invoice_payment_invalid', 'invoice_cancel_blocked'))
EXECUTE FUNCTION public.route_catalog_alert_insert();
