-- 185: Resumo diário do Portal às 08:00 America/Sao_Paulo (11:00 UTC).
DO $$
DECLARE v_url TEXT := current_setting('app.settings.supabase_url', true); v_secret TEXT := current_setting('app.settings.digest_secret', true);
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') AND NULLIF(v_url, '') IS NOT NULL AND NULLIF(v_secret, '') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'portal-daily-digest') THEN
      PERFORM cron.unschedule('portal-daily-digest');
    END IF;
    PERFORM cron.schedule('portal-daily-digest','0 11 * * *',format($job$SELECT net.http_post(url := %L || '/functions/v1/portal-daily-digest', headers := jsonb_build_object('Authorization', 'Bearer ' || %L));$job$, v_url, v_secret));
  END IF;
END;
$$;
