-- 319: executor server-only e reconciliação a cada 15 minutos.
--
-- pg_cron chama apenas a Edge Function protegida. A função abaixo não é
-- executável por authenticated: o runner escolhe um usuário interno ativo
-- exclusivamente para compatibilidade com os detectores históricos que ainda
-- verificam auth.uid(). Os produtores dos blocos seguintes devem migrar para
-- as RPCs do agregado e poderão remover essa compatibilidade.

CREATE OR REPLACE FUNCTION public.run_alert_detectors()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor UUID;
  v_overdue INTEGER := 0;
  v_adr_pending INTEGER := 0;
  v_adr_deadline INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_actor
  FROM public.user_profiles
  WHERE active = true
  ORDER BY CASE WHEN role IN ('admin', 'administrativo') THEN 0 ELSE 1 END, created_at, id
  LIMIT 1;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Não há usuário interno ativo para executar os detectores.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('alerts.detector_runner', 'on', true);

  v_overdue := public.detect_overdue_invoices();
  v_adr_pending := public.detect_agency_report_pending();
  v_adr_deadline := public.detect_agency_report_deadline_missed();

  RETURN jsonb_build_object(
    'overdue_invoices', v_overdue,
    'agency_report_pending', v_adr_pending,
    'agency_report_deadline_missed', v_adr_deadline
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.run_alert_detectors() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_alert_detectors() TO service_role;

DO $$
DECLARE
  v_url TEXT := current_setting('app.settings.supabase_url', true);
  v_secret TEXT := current_setting('app.settings.alerts_detector_secret', true);
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'net') THEN
    IF NULLIF(v_url, '') IS NULL OR NULLIF(v_secret, '') IS NULL THEN
      RAISE WARNING 'alerts-foundation-detectors será agendado sem URL/segredo completos; a execução falhará visivelmente até app.settings.* ser configurado.';
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'alerts-foundation-detectors') THEN
      PERFORM cron.unschedule('alerts-foundation-detectors');
    END IF;
    PERFORM cron.schedule(
      'alerts-foundation-detectors',
      '*/15 * * * *',
      $job$SELECT net.http_post(url := COALESCE(NULLIF(current_setting('app.settings.supabase_url', true), ''), 'https://invalid-alerts-detector-config.invalid') || '/functions/v1/alerts-detector', headers := jsonb_build_object('Authorization', 'Bearer ' || COALESCE(NULLIF(current_setting('app.settings.alerts_detector_secret', true), ''), 'missing-alerts-detector-secret'), 'Content-Type', 'application/json'), body := '{}'::jsonb);$job$
    );
  END IF;
END;
$$;
