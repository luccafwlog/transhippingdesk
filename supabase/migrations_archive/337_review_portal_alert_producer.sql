-- 337: restaura o produtor canônico de Conta de Portal não pronta na Revisão.

CREATE OR REPLACE FUNCTION public.compute_bl_review_pendencies(
  p_customer_id BIGINT, p_cargo_mode TEXT, p_bb_weight_ton NUMERIC
)
RETURNS TEXT[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_reasons TEXT[] := ARRAY[]::TEXT[];
  v_has_email BOOLEAN := false;
  v_portal_ready BOOLEAN := false;
BEGIN
  IF p_customer_id IS NULL THEN
    v_reasons := array_append(v_reasons, 'Cliente nao vinculado');
  ELSE
    SELECT EXISTS (SELECT 1 FROM public.customer_contacts c WHERE c.customer_id = p_customer_id AND NULLIF(btrim(c.email), '') IS NOT NULL) INTO v_has_email;
    IF NOT v_has_email THEN v_reasons := array_append(v_reasons, 'Cliente sem e-mail cadastrado'); END IF;
    SELECT EXISTS (SELECT 1 FROM public.customer_portal_accounts a WHERE a.customer_id = p_customer_id AND a.active = true AND a.auth_user_id IS NOT NULL) INTO v_portal_ready;
    IF NOT v_portal_ready THEN v_reasons := array_append(v_reasons, 'Acesso ao portal nao provisionado'); END IF;
  END IF;
  IF p_cargo_mode = 'carga_solta' AND (p_bb_weight_ton IS NULL OR p_bb_weight_ton <= 0) THEN
    v_reasons := array_append(v_reasons, 'Peso BB ausente');
  END IF;
  RETURN v_reasons;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_bl_review_alerts(
  p_bl_id TEXT, p_source TEXT DEFAULT 'bl_review_gate'
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_reasons TEXT[];
  v_source TEXT := COALESCE(NULLIF(btrim(p_source), ''), 'bl_review_gate');
  v_type TEXT;
BEGIN
  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND OR v_bl.review_status <> 'pending_review' THEN
    FOREACH v_type IN ARRAY ARRAY['review_customer_unlinked','review_customer_email_missing','review_portal_not_ready','review_breakbulk_weight_missing'] LOOP
      PERFORM public.resolve_alert_item(v_type, 'bl', p_bl_id, 'bl_review_resolved', '{}'::jsonb);
    END LOOP;
    RETURN;
  END IF;
  v_reasons := public.compute_bl_review_pendencies(v_bl.customer_id, v_bl.cargo_mode, v_bl.bb_weight_ton);
  PERFORM public.reconcile_bl_review_alerts_item('review_customer_unlinked', 'Cliente nao vinculado', 'Cliente não vinculado ao B/L ' || v_bl.id, p_bl_id, v_reasons, v_source);
  PERFORM public.reconcile_bl_review_alerts_item('review_customer_email_missing', 'Cliente sem e-mail cadastrado', 'Cliente sem e-mail cadastrado para B/L ' || v_bl.id, p_bl_id, v_reasons, v_source);
  PERFORM public.reconcile_bl_review_alerts_item('review_portal_not_ready', 'Acesso ao portal nao provisionado', 'Conta de Portal não pronta para B/L ' || v_bl.id, p_bl_id, v_reasons, v_source);
  PERFORM public.reconcile_bl_review_alerts_item('review_breakbulk_weight_missing', 'Peso BB ausente', 'Peso BB ausente no B/L ' || v_bl.id, p_bl_id, v_reasons, v_source);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_bl_review_alerts_item(
  p_type TEXT, p_reason TEXT, p_message TEXT, p_bl_id TEXT, p_reasons TEXT[], p_source TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
BEGIN
  IF p_reason = ANY(p_reasons) THEN
    PERFORM public.upsert_alert_item(p_type, 'bl', p_bl_id, p_message, p_source, '{}'::jsonb, CASE WHEN p_type = 'review_portal_not_ready' THEN '/clientes/portal' ELSE '/revisao' END);
  ELSE
    PERFORM public.resolve_alert_item(p_type, 'bl', p_bl_id, p_source, '{}'::jsonb);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_bl_review_alerts_item(TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_bl_review_alerts_item(TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_reconcile_bl_review_on_portal_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_customer_id BIGINT;
  v_bl_id TEXT;
BEGIN
  v_customer_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.customer_id ELSE NEW.customer_id END;
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR v_bl_id IN SELECT id FROM public.bls WHERE customer_id = v_customer_id AND review_status = 'pending_review' LOOP
    PERFORM public.reconcile_bl_review_alerts(v_bl_id, 'portal_account_change');
  END LOOP;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reconcile_bl_review_on_portal_change ON public.customer_portal_accounts;
CREATE TRIGGER trg_reconcile_bl_review_on_portal_change AFTER INSERT OR UPDATE OR DELETE ON public.customer_portal_accounts FOR EACH ROW EXECUTE FUNCTION public.trg_reconcile_bl_review_on_portal_change();

DROP TRIGGER IF EXISTS trg_reconcile_bl_review_on_contact_change ON public.customer_contacts;
CREATE TRIGGER trg_reconcile_bl_review_on_contact_change AFTER INSERT OR UPDATE OR DELETE ON public.customer_contacts FOR EACH ROW EXECUTE FUNCTION public.trg_reconcile_bl_review_on_portal_change();

REVOKE ALL ON FUNCTION public.compute_bl_review_pendencies(BIGINT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_bl_review_pendencies(BIGINT, TEXT, NUMERIC) TO service_role;
REVOKE ALL ON FUNCTION public.reconcile_bl_review_alerts(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_bl_review_alerts(TEXT, TEXT) TO service_role;
