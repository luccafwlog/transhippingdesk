-- 321: follow-ups da revisão da fundação de alertas.
--
-- Corrige dois casos de compatibilidade sem editar as migrations 317–320 já
-- aplicadas em branches de preview: pagamento parcial não resolve uma fatura
-- ainda vencida e carriers legados são consumidos quando o item é anexado a
-- um agregado existente.
--
-- Rollback: reaplicar os corpos de 318_alerts_foundation_lifecycle.sql para
-- resolve_invoice_alerts_on_status_change e route_catalog_alert_insert.

CREATE OR REPLACE FUNCTION public.resolve_invoice_alerts_on_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    IF NEW.status IN ('paid', 'partially_paid', 'cancelled') THEN
      PERFORM public.resolve_alert_item(
        'invoice_payment_invalid', 'invoice', NEW.id::TEXT,
        'invoice_status_change', jsonb_build_object('invoice_status', NEW.status)
      );
    END IF;
    IF NEW.status = 'cancelled' THEN
      PERFORM public.resolve_alert_item(
        'invoice_cancel_blocked', 'invoice', NEW.id::TEXT,
        'invoice_status_change', jsonb_build_object('invoice_status', NEW.status)
      );
    END IF;
    IF NEW.status IN ('paid', 'cancelled', 'covered', 'obsolete')
       OR (NEW.status = 'partially_paid' AND NEW.balance_brl IS NOT NULL AND NEW.balance_brl <= 0.01) THEN
      PERFORM public.resolve_alert_item(
        'invoice_overdue', 'invoice', NEW.id::TEXT,
        'invoice_status_change', jsonb_build_object(
          'invoice_status', NEW.status,
          'balance_brl', NEW.balance_brl
        )
      );
    END IF;
    PERFORM set_config('alerts.foundation_trigger', 'off', true);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS resolve_invoice_alerts_on_status_change ON public.invoices;
CREATE TRIGGER resolve_invoice_alerts_on_status_change
  AFTER INSERT OR UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.resolve_invoice_alerts_on_status_change();

REVOKE ALL ON FUNCTION public.resolve_invoice_alerts_on_status_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_invoice_alerts_on_status_change() TO service_role;

CREATE OR REPLACE FUNCTION public.route_catalog_alert_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_existing_alert_id BIGINT;
  v_upsert_result JSONB;
  v_upsert_alert_id BIGINT;
BEGIN
  IF NEW.type <> 'aggregate'
     AND NEW.entity_type IS NOT NULL
     AND NEW.entity_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.alert_type_catalog WHERE type = NEW.type AND active)
     AND current_setting('alerts.foundation_direct_insert', true) IS DISTINCT FROM 'on' THEN
    SELECT i.alert_id INTO v_existing_alert_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = NEW.type
      AND a.entity_type = NEW.entity_type
      AND a.entity_id = NEW.entity_id
      AND i.alert_id <> NEW.id
    ORDER BY (i.status = 'active') DESC, i.id DESC
    LIMIT 1;

    IF v_existing_alert_id IS NOT NULL THEN
      UPDATE public.alerts
      SET status = 'closed', closed_at = COALESCE(closed_at, now())
      WHERE id = NEW.id;
    END IF;

    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    v_upsert_result := public.upsert_alert_item(
      NEW.type, NEW.entity_type, NEW.entity_id, NEW.message,
      'legacy_insert', '{}'::jsonb, NULL
    );
    PERFORM set_config('alerts.foundation_trigger', 'off', true);

    v_upsert_alert_id := NULLIF(v_upsert_result->>'alert_id', '')::BIGINT;
    IF v_upsert_alert_id IS DISTINCT FROM NEW.id THEN
      UPDATE public.alerts
      SET status = 'closed', closed_at = COALESCE(closed_at, now())
      WHERE id = NEW.id AND status <> 'closed';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS route_catalog_alert_insert ON public.alerts;
CREATE TRIGGER route_catalog_alert_insert
  AFTER INSERT ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION public.route_catalog_alert_insert();

REVOKE ALL ON FUNCTION public.route_catalog_alert_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.route_catalog_alert_insert() TO service_role;
