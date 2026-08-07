-- Corrige a medição do prazo para não manter alertas de escalas apagadas.
-- A migration 271 já criou os alertas; esta limpa os já abertos e impede que
-- uma futura execução da RPC os recrie para uma escala soft-deleted.
DO $cleanup$
BEGIN
  UPDATE public.alerts a
  SET status = 'closed', closed_at = COALESCE(a.closed_at, now())
  WHERE a.type = 'agency_report_deadline_missed'
    AND a.status <> 'closed'
    AND EXISTS (
      SELECT 1
      FROM public.audit_logs d
      WHERE d.entity_type = 'voyage_pod_schedule'
        AND d.entity_id = split_part(a.entity_id, '::', 1) || '::' || upper(btrim(split_part(a.entity_id, '::', 2)))
        AND d.field_name = 'deleted'
        AND d.new_value = 'true'
        AND NOT EXISTS (
          SELECT 1
          FROM public.audit_logs newer
          WHERE newer.entity_type = d.entity_type
            AND newer.entity_id = d.entity_id
            AND newer.field_name = d.field_name
            AND newer.changed_at > d.changed_at
        )
    );

END;
$cleanup$;

CREATE OR REPLACE FUNCTION public.reject_deleted_agency_report_deadline_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.type = 'agency_report_deadline_missed'
     AND EXISTS (
       SELECT 1
       FROM public.audit_logs d
       WHERE d.entity_type = 'voyage_pod_schedule'
         AND d.entity_id = split_part(NEW.entity_id, '::', 1) || '::' || upper(btrim(split_part(NEW.entity_id, '::', 2)))
         AND d.field_name = 'deleted'
         AND d.new_value = 'true'
         AND NOT EXISTS (
           SELECT 1
           FROM public.audit_logs newer
           WHERE newer.entity_type = d.entity_type
             AND newer.entity_id = d.entity_id
             AND newer.field_name = d.field_name
             AND newer.changed_at > d.changed_at
         )
     ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS reject_deleted_agency_report_deadline_alert ON public.alerts;
CREATE TRIGGER reject_deleted_agency_report_deadline_alert
  BEFORE INSERT ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION public.reject_deleted_agency_report_deadline_alert();
