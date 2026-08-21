-- 333: hardening pós-integração dos alertas e Disputes.
-- Corrige carriers legados, fecha a superfície RPC genérica e torna a
-- conversa de Demurrage uma fonte coerente para o alerta interno.
-- Rollback: reaplicar as definições de 318/323/325/331 e restaurar os grants
-- anteriores somente em banco descartável; não desfazer dados já migrados.

-- A sobrecarga legada não pode criar um carrier separado do agregado. Todos os
-- produtores de compatibilidade passam pelo RPC terminalizado de 323.
CREATE OR REPLACE FUNCTION public.upsert_alert_item(
  p_type TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_message TEXT,
  p_source TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_destination TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_department TEXT;
BEGIN
  SELECT responsible_department INTO v_department
  FROM public.alert_type_catalog
  WHERE type = p_type AND active;
  IF v_department IS NULL THEN
    RAISE EXCEPTION 'Tipo de alerta fora do catálogo: %', p_type USING ERRCODE = '22023';
  END IF;
  RETURN public.upsert_alert_item(
    p_type, p_entity_type, p_entity_id, p_message, p_source,
    v_department, COALESCE(p_metadata, '{}'::jsonb), p_destination
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_alert_item(
  p_type TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_source TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_item RECORD;
  v_found BOOLEAN := false;
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  FOR v_item IN
    SELECT i.id, i.alert_id, i.occurrence_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = p_type
      AND a.entity_type = p_entity_type
      AND a.entity_id = p_entity_id
      AND i.status = 'active'
    FOR UPDATE
  LOOP
    v_found := true;
    UPDATE public.alert_items
    SET status = 'resolved', updated_at = now(), resolved_at = now()
    WHERE id = v_item.id;
    INSERT INTO public.alert_item_events(
      alert_item_id, occurrence_id, event_type, previous_status,
      new_status, actor_id, metadata
    ) VALUES (
      v_item.id, v_item.occurrence_id, 'resolved', 'active', 'resolved',
      auth.uid(), COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('source', p_source)
    );
    PERFORM public.refresh_alert_aggregate(v_item.alert_id);
  END LOOP;
  RETURN v_found;
END;
$function$;

-- Compatibilidade direta não é uma API de escrita do browser.
REVOKE ALL ON FUNCTION public.upsert_alert_item(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_alert_item(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

-- Os produtores legados que ainda inserem em public.alerts devem ser absorvidos
-- no agregado e o carrier deve ser fechado imediatamente.
CREATE OR REPLACE FUNCTION public.route_catalog_alert_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.type <> 'aggregate'
     AND NEW.entity_type IS NOT NULL
     AND NEW.entity_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.alert_type_catalog WHERE type = NEW.type AND active)
     AND current_setting('alerts.foundation_direct_insert', true) IS DISTINCT FROM 'on' THEN
    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    PERFORM public.upsert_alert_item(
      NEW.type, NEW.entity_type, NEW.entity_id, NEW.message,
      'legacy_insert', '{}'::jsonb, NULL
    );
    UPDATE public.alerts
    SET status = 'closed', closed_at = COALESCE(closed_at, now())
    WHERE id = NEW.id;
    PERFORM set_config('alerts.foundation_trigger', 'off', true);
  END IF;
  RETURN NEW;
END;
$function$;

-- Migra os carriers existentes do evento de Dispute para o agregado único.
DO $backfill$
DECLARE
  v_row RECORD;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  FOR v_row IN
    SELECT a.id, a.entity_id, a.message
    FROM public.alerts a
    WHERE a.type = 'portal_dispute_opened'
      AND a.status <> 'closed'
      AND a.entity_type = 'demurrage_invoice'
  LOOP
    PERFORM public.upsert_alert_item(
      'portal_dispute_opened', 'demurrage_invoice', v_row.entity_id,
      v_row.message, 'alerts_333_backfill', '{}'::jsonb, '/demurrage'
    );
    UPDATE public.alerts
    SET status = 'closed', closed_at = COALESCE(closed_at, now())
    WHERE id = v_row.id;
  END LOOP;
END;
$backfill$;

-- RPCs de faturamento têm tipos e origem fixos; substituem a escrita genérica
-- usada pelo serviço de compatibilidade do browser.
CREATE OR REPLACE FUNCTION public.upsert_billing_alert(
  p_type TEXT, p_bl_id TEXT, p_message TEXT, p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  IF p_type NOT IN ('billing_calculation_blocked', 'billing_auto_issue_failed') THEN
    RAISE EXCEPTION 'Tipo de faturamento inválido.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bls WHERE id = p_bl_id) THEN
    RAISE EXCEPTION 'B/L não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.upsert_alert_item(
    p_type, 'bl', p_bl_id, p_message, 'billing_client_compatibility',
    'documentacao', COALESCE(p_metadata, '{}'::jsonb), '/taxas-locais'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_billing_alert(
  p_type TEXT, p_bl_id TEXT, p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  IF p_type NOT IN ('billing_calculation_blocked', 'billing_auto_issue_failed') THEN
    RAISE EXCEPTION 'Tipo de faturamento inválido.' USING ERRCODE = '22023';
  END IF;
  RETURN public.resolve_alert_item(p_type, 'bl', p_bl_id, 'billing_client_compatibility', p_metadata);
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_billing_alert(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_billing_alert(TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_billing_alert(TEXT, TEXT, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_billing_alert(TEXT, TEXT, JSONB) TO authenticated, service_role;

-- Nenhum detector é chamado pelo browser.
REVOKE ALL ON FUNCTION public.detect_agency_report_pending() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detect_agency_report_department_pending() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detect_agency_report_deadline_missed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detect_voyage_operation_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_agency_report_pending() TO service_role;
GRANT EXECUTE ON FUNCTION public.detect_agency_report_department_pending() TO service_role;
GRANT EXECUTE ON FUNCTION public.detect_agency_report_deadline_missed() TO service_role;
GRANT EXECUTE ON FUNCTION public.detect_voyage_operation_alerts() TO service_role;
