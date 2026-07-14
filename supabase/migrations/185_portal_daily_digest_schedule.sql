-- 185: Resumo diário do Portal às 08:00 America/Sao_Paulo (11:00 UTC).
SELECT cron.schedule('portal-daily-digest','0 11 * * *',$$SELECT net.http_post(url := current_setting('app.settings.supabase_url') || '/functions/v1/portal-daily-digest', headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.digest_secret')));$$);
