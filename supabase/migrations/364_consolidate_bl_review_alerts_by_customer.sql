-- 364: consolidação dos alertas de revisão de B/L por cliente (Issue #628).
--
-- Agrupa as pendências de revisão documental de B/Ls por cliente (para B/Ls
-- vinculados) e por consignatário (para B/Ls não vinculados), quantificando os
-- B/Ls pendentes em uma única entrada operacional por entidade e reduzindo o
-- volume de alertas gerados em importações massivas.
--
-- Rollback: restaurar a definição da migration 337 para reconcile_bl_review_alerts.

CREATE OR REPLACE FUNCTION public.reconcile_customer_bl_review_alerts(
  p_customer_id BIGINT,
  p_consignee TEXT,
  p_source TEXT DEFAULT 'bl_review_gate'
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_source TEXT := COALESCE(NULLIF(btrim(p_source), ''), 'bl_review_gate');
  v_customer_name TEXT;
  v_customer_label TEXT;
  v_entity_id TEXT;
  v_consignee_key TEXT;
  v_has_email BOOLEAN := false;
  v_portal_ready BOOLEAN := false;
  v_total_pending INTEGER := 0;
  v_bb_pending INTEGER := 0;
  v_msg TEXT;
BEGIN
  IF p_customer_id IS NOT NULL THEN
    SELECT name INTO v_customer_name FROM public.customers WHERE id = p_customer_id;
    v_customer_label := COALESCE(v_customer_name, 'Cliente #' || p_customer_id::TEXT);
    v_entity_id := p_customer_id::TEXT;

    SELECT EXISTS (
      SELECT 1 FROM public.customer_contacts c
      WHERE c.customer_id = p_customer_id
        AND NULLIF(btrim(c.email), '') IS NOT NULL
    ) INTO v_has_email;

    SELECT EXISTS (
      SELECT 1 FROM public.customer_portal_accounts a
      WHERE a.customer_id = p_customer_id
        AND a.active = true
        AND a.auth_user_id IS NOT NULL
    ) INTO v_portal_ready;

    SELECT
      count(*),
      count(*) FILTER (WHERE cargo_mode = 'carga_solta' AND (bb_weight_ton IS NULL OR bb_weight_ton <= 0))
    INTO v_total_pending, v_bb_pending
    FROM public.bls
    WHERE customer_id = p_customer_id
      AND review_status = 'pending_review';

    -- 1. E-mail de contato ausente
    IF v_total_pending > 0 AND NOT v_has_email THEN
      v_msg := 'Cliente ' || v_customer_label || ': ' || v_total_pending ||
        CASE WHEN v_total_pending = 1 THEN ' B/L pendente de revisão (sem e-mail cadastrado)'
             ELSE ' B/Ls pendentes de revisão (sem e-mail cadastrado)' END;
      PERFORM public.upsert_alert_item(
        'review_customer_email_missing', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('customer_id', p_customer_id, 'pending_count', v_total_pending),
        '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_customer_email_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;

    -- 2. Conta de Portal não provisionada
    IF v_total_pending > 0 AND NOT v_portal_ready THEN
      v_msg := 'Cliente ' || v_customer_label || ': ' || v_total_pending ||
        CASE WHEN v_total_pending = 1 THEN ' B/L pendente (Conta de Portal não provisionada)'
             ELSE ' B/Ls pendentes (Conta de Portal não provisionada)' END;
      PERFORM public.upsert_alert_item(
        'review_portal_not_ready', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('customer_id', p_customer_id, 'pending_count', v_total_pending),
        '/clientes/portal?cliente=' || p_customer_id::TEXT
      );
    ELSE
      PERFORM public.resolve_alert_item('review_portal_not_ready', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;

    -- 3. Peso BB ausente
    IF v_bb_pending > 0 THEN
      v_msg := 'Cliente ' || v_customer_label || ': ' || v_bb_pending ||
        CASE WHEN v_bb_pending = 1 THEN ' B/L pendente de revisão (peso BB ausente)'
             ELSE ' B/Ls pendentes de revisão (peso BB ausente)' END;
      PERFORM public.upsert_alert_item(
        'review_breakbulk_weight_missing', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('customer_id', p_customer_id, 'pending_count', v_bb_pending),
        '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_breakbulk_weight_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;

    -- Para cliente já vinculado, não há pendência de vínculo
    PERFORM public.resolve_alert_item('review_customer_unlinked', 'customer', v_entity_id, v_source, '{}'::jsonb);

  ELSE
    -- B/Ls sem vínculo de cliente (chaveados por consignatário)
    v_consignee_key := COALESCE(NULLIF(btrim(p_consignee), ''), 'sem_cliente');
    v_entity_id := v_consignee_key;

    SELECT
      count(*),
      count(*) FILTER (WHERE cargo_mode = 'carga_solta' AND (bb_weight_ton IS NULL OR bb_weight_ton <= 0))
    INTO v_total_pending, v_bb_pending
    FROM public.bls
    WHERE customer_id IS NULL
      AND review_status = 'pending_review'
      AND COALESCE(NULLIF(btrim(consignee), ''), 'sem_cliente') = v_consignee_key;

    -- 1. Cliente não vinculado
    IF v_total_pending > 0 THEN
      v_msg := 'Cliente ' || v_consignee_key || ': ' || v_total_pending ||
        CASE WHEN v_total_pending = 1 THEN ' B/L pendente de vínculo com cliente'
             ELSE ' B/Ls pendentes de vínculo com cliente' END;
      PERFORM public.upsert_alert_item(
        'review_customer_unlinked', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('consignee', v_consignee_key, 'pending_count', v_total_pending),
        '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_customer_unlinked', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;

    -- 2. Peso BB ausente
    IF v_bb_pending > 0 THEN
      v_msg := 'Cliente ' || v_consignee_key || ': ' || v_bb_pending ||
        CASE WHEN v_bb_pending = 1 THEN ' B/L pendente de revisão (peso BB ausente)'
             ELSE ' B/Ls pendentes de revisão (peso BB ausente)' END;
      PERFORM public.upsert_alert_item(
        'review_breakbulk_weight_missing', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('consignee', v_consignee_key, 'pending_count', v_bb_pending),
        '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_breakbulk_weight_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;

    -- Para B/L sem cliente vinculado, e-mail e portal não se aplicam
    PERFORM public.resolve_alert_item('review_customer_email_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    PERFORM public.resolve_alert_item('review_portal_not_ready', 'customer', v_entity_id, v_source, '{}'::jsonb);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_customer_bl_review_alerts(BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_customer_bl_review_alerts(BIGINT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_bl_review_alerts(
  p_bl_id TEXT,
  p_source TEXT DEFAULT 'bl_review_gate'
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_source TEXT := COALESCE(NULLIF(btrim(p_source), ''), 'bl_review_gate');
  v_type TEXT;
BEGIN
  -- Resolve alertas legados criados por B/L individual
  FOREACH v_type IN ARRAY ARRAY[
    'review_customer_unlinked',
    'review_customer_email_missing',
    'review_portal_not_ready',
    'review_breakbulk_weight_missing'
  ] LOOP
    PERFORM public.resolve_alert_item(v_type, 'bl', p_bl_id, 'bl_review_consolidated', '{}'::jsonb);
  END LOOP;

  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id;
  IF FOUND THEN
    PERFORM public.reconcile_customer_bl_review_alerts(v_bl.customer_id, v_bl.consignee, v_source);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_bl_review_alerts(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_bl_review_alerts(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.detect_bl_review_pendencies()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_cust RECORD;
  v_cons RECORD;
  v_old_alert RECORD;
  v_count INTEGER := 0;
  v_type TEXT;
BEGIN
  PERFORM set_config('alerts.foundation_trigger', 'on', true);

  -- 1. Reconcilia clientes vinculados com B/Ls em pending_review
  FOR v_cust IN
    SELECT DISTINCT customer_id
    FROM public.bls
    WHERE review_status = 'pending_review'
      AND customer_id IS NOT NULL
  LOOP
    PERFORM public.reconcile_customer_bl_review_alerts(v_cust.customer_id, NULL, 'detector_bl_review');
    v_count := v_count + 1;
  END LOOP;

  -- 2. Reconcilia consignatários não vinculados com B/Ls em pending_review
  FOR v_cons IN
    SELECT DISTINCT COALESCE(NULLIF(btrim(consignee), ''), 'sem_cliente') AS consignee_key
    FROM public.bls
    WHERE review_status = 'pending_review'
      AND customer_id IS NULL
  LOOP
    PERFORM public.reconcile_customer_bl_review_alerts(NULL, v_cons.consignee_key, 'detector_bl_review');
    v_count := v_count + 1;
  END LOOP;

  -- 3. Resolve alertas ativos de clientes que não possuem mais pendências
  FOR v_old_alert IN
    SELECT DISTINCT a.entity_id, i.item_type
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.status = 'active'
      AND a.entity_type = 'customer'
      AND i.item_type IN (
        'review_customer_unlinked',
        'review_customer_email_missing',
        'review_portal_not_ready',
        'review_breakbulk_weight_missing'
      )
  LOOP
    IF v_old_alert.entity_id ~ '^[0-9]+$' THEN
      PERFORM public.reconcile_customer_bl_review_alerts(v_old_alert.entity_id::BIGINT, NULL, 'detector_bl_review_cleanup');
    ELSE
      PERFORM public.reconcile_customer_bl_review_alerts(NULL, v_old_alert.entity_id, 'detector_bl_review_cleanup');
    END IF;
  END LOOP;

  -- 4. Limpa itens legados por B/L
  FOREACH v_type IN ARRAY ARRAY[
    'review_customer_unlinked',
    'review_customer_email_missing',
    'review_portal_not_ready',
    'review_breakbulk_weight_missing'
  ] LOOP
    FOR v_old_alert IN
      SELECT a.entity_id
      FROM public.alert_items i
      JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.status = 'active'
        AND a.entity_type = 'bl'
        AND i.item_type = v_type
    LOOP
      PERFORM public.resolve_alert_item(v_type, 'bl', v_old_alert.entity_id, 'detector_bl_review_cleanup', '{}'::jsonb);
    END LOOP;
  END LOOP;

  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.detect_bl_review_pendencies() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_bl_review_pendencies() TO service_role;

CREATE OR REPLACE FUNCTION public.trg_reconcile_bl_review_alerts()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM set_config('alerts.foundation_trigger', 'on', true);

  IF TG_OP = 'DELETE' THEN
    PERFORM public.reconcile_customer_bl_review_alerts(OLD.customer_id, OLD.consignee, 'bl_deleted');
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM public.reconcile_customer_bl_review_alerts(NEW.customer_id, NEW.consignee, 'bl_inserted');
    RETURN NEW;
  ELSE
    IF OLD.review_status IS DISTINCT FROM NEW.review_status
       OR OLD.customer_id IS DISTINCT FROM NEW.customer_id
       OR OLD.consignee IS DISTINCT FROM NEW.consignee
       OR OLD.cargo_mode IS DISTINCT FROM NEW.cargo_mode
       OR OLD.bb_weight_ton IS DISTINCT FROM NEW.bb_weight_ton THEN
      PERFORM public.reconcile_customer_bl_review_alerts(NEW.customer_id, NEW.consignee, 'bl_updated');
      IF OLD.customer_id IS DISTINCT FROM NEW.customer_id
         OR OLD.consignee IS DISTINCT FROM NEW.consignee THEN
        PERFORM public.reconcile_customer_bl_review_alerts(OLD.customer_id, OLD.consignee, 'bl_customer_changed');
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
END;
$function$;

DROP TRIGGER IF EXISTS trg_reconcile_bl_review_alerts ON public.bls;
CREATE TRIGGER trg_reconcile_bl_review_alerts
  AFTER INSERT OR UPDATE OF review_status, customer_id, consignee, cargo_mode, bb_weight_ton OR DELETE ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.trg_reconcile_bl_review_alerts();

CREATE OR REPLACE FUNCTION public.trg_reconcile_bl_review_on_portal_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_customer_id BIGINT;
BEGIN
  v_customer_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.customer_id ELSE NEW.customer_id END;
  IF v_customer_id IS NOT NULL THEN
    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    PERFORM public.reconcile_customer_bl_review_alerts(v_customer_id, NULL, 'portal_account_change');
    PERFORM set_config('alerts.foundation_trigger', 'off', true);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_reconcile_bl_review_on_portal_change ON public.customer_portal_accounts;
CREATE TRIGGER trg_reconcile_bl_review_on_portal_change
  AFTER INSERT OR UPDATE OR DELETE ON public.customer_portal_accounts
  FOR EACH ROW EXECUTE FUNCTION public.trg_reconcile_bl_review_on_portal_change();

DROP TRIGGER IF EXISTS trg_reconcile_bl_review_on_contact_change ON public.customer_contacts;
CREATE TRIGGER trg_reconcile_bl_review_on_contact_change
  AFTER INSERT OR UPDATE OR DELETE ON public.customer_contacts
  FOR EACH ROW EXECUTE FUNCTION public.trg_reconcile_bl_review_on_portal_change();

-- Executa o detector para migrar/reconciliar os alertas existentes
SELECT public.detect_bl_review_pendencies();
