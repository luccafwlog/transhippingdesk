-- 005: reparo pós-squash em produção — pg_net, jobs HTTP e guarda RLS.
--
-- Contexto (revisão final da PR 651): o Cenário B do runbook
-- (docs/operations/squash-schema-v1-deploy.md) só reescreve
-- supabase_migrations.schema_migrations, então a 003 nunca executa em bancos
-- já provisionados. Produção tem 5 jobs e nenhum pg_net: o portal-daily-digest
-- falha todo dia às 11:00 UTC com ERROR: schema "net" does not exist, e os 3
-- runners HTTP (alerts-foundation-detectors, demurrage-dunning,
-- customer-communication-auto-runner) nunca foram agendados. Esta migration
-- aplica em produção exatamente o que a 003 aplica em bancos novos — por ser
-- versão nova, ela EXECUTA de verdade no push, ao contrário de 001–003.
--
-- Também versiona public.rls_auto_enable() + event trigger ensure_rls (drift
-- manual em produção, ausente do arquivo morto e do consolidado): rede de
-- segurança que habilita RLS em toda tabela nova de public. Em bancos novos a
-- 002 já habilita RLS em todas as 106 tabelas; a guarda cobre o futuro.
--
-- Tudo aqui é idempotente e guardado: roda sem erro em bancos sem pg_cron,
-- pg_net ou storage, e sem privilégio para event triggers (nesse caso avisa
-- em vez de abortar). Ver item 5 da ADR 0062 e nota editorial nº 3.
--
-- Rollback:
--   SELECT cron.unschedule('portal-daily-digest');
--   SELECT cron.unschedule('alerts-foundation-detectors');
--   SELECT cron.unschedule('demurrage-dunning');
--   SELECT cron.unschedule('customer-communication-auto-runner');
--   DROP EVENT TRIGGER IF EXISTS ensure_rls;
--   DROP FUNCTION IF EXISTS public.rls_auto_enable();

-- ===========================================================================
-- 1. Extensões pg_cron / pg_net (mesmo padrão guardado da 003)
-- ===========================================================================

DO $ext_005$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    BEGIN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '005: pg_cron indisponivel neste banco (%); os jobs agendados nao serao criados.', SQLERRM;
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    BEGIN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '005: pg_net indisponivel neste banco (%); os jobs HTTP nao serao criados.', SQLERRM;
    END;
  END IF;
END;
$ext_005$;

-- ===========================================================================
-- 2. Jobs HTTP (reafirmação idempotente da 003 para bancos já provisionados)
-- ===========================================================================
-- Em bancos novos a 003 já agendou estes jobs; aqui o unschedule + schedule
-- garante o mesmo estado final em produção sem duplicar. Definições idênticas
-- às da 003 — a 003 continua canônica para bancos novos.

-- 185: resumo diário do Portal às 08:00 America/Sao_Paulo (11:00 UTC).
-- Só agenda com GUCs configurados (nenhuma migration do repo os define);
-- sem eles, a ausência do digest é o comportamento esperado, não falha.
DO $cron_digest_005$
DECLARE
  v_url TEXT := current_setting('app.settings.supabase_url', true);
  v_secret TEXT := current_setting('app.settings.digest_secret', true);
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND to_regproc('net.http_post') IS NOT NULL
     AND NULLIF(v_url, '') IS NOT NULL
     AND NULLIF(v_secret, '') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'portal-daily-digest') THEN
      PERFORM cron.unschedule('portal-daily-digest');
    END IF;
    PERFORM cron.schedule(
      'portal-daily-digest', '0 11 * * *',
      format(
        $job$SELECT net.http_post(url := %L || '/functions/v1/portal-daily-digest', headers := jsonb_build_object('Authorization', 'Bearer ' || %L));$job$,
        v_url, v_secret
      )
    );
  END IF;
END;
$cron_digest_005$;

-- 319: runner unificado dos detectores de alerta.
DO $cron_alerts_005$
DECLARE
  v_url TEXT := current_setting('app.settings.supabase_url', true);
  v_secret TEXT := current_setting('app.settings.alerts_detector_secret', true);
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND to_regproc('net.http_post') IS NOT NULL THEN
    IF NULLIF(v_url, '') IS NULL OR NULLIF(v_secret, '') IS NULL THEN
      RAISE WARNING '005: alerts-foundation-detectors sera agendado sem URL/segredo completos; a execucao falhara visivelmente ate app.settings.* ser configurado.';
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
$cron_alerts_005$;

-- 378: régua de cobrança de Demurrage.
DO $cron_dunning_005$
DECLARE
  v_url TEXT := current_setting('app.settings.supabase_url', true);
  v_secret TEXT := current_setting('app.settings.demurrage_dunning_secret', true);
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND to_regproc('net.http_post') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'demurrage-dunning') THEN
      PERFORM cron.unschedule('demurrage-dunning');
    END IF;
    IF NULLIF(v_url, '') IS NULL OR NULLIF(v_secret, '') IS NULL THEN
      RAISE WARNING '005: demurrage-dunning sera agendado sem URL/segredo completos; a execucao falhara visivelmente ate app.settings.* ser configurado.';
    END IF;
    PERFORM cron.schedule(
      'demurrage-dunning',
      '0 * * * *',
      $job$SELECT net.http_post(url := COALESCE(NULLIF(current_setting('app.settings.supabase_url', true), ''), 'https://invalid-demurrage-dunning-config.invalid') || '/functions/v1/demurrage-dunning', headers := jsonb_build_object('Authorization', 'Bearer ' || COALESCE(NULLIF(current_setting('app.settings.demurrage_dunning_secret', true), ''), 'missing-demurrage-dunning-secret'), 'Content-Type', 'application/json'), body := '{}'::jsonb);$job$
    );
  END IF;
END;
$cron_dunning_005$;

-- 381: runner de automação de comunicados ao cliente.
DO $cron_communications_005$
DECLARE
  v_url TEXT := current_setting('app.settings.supabase_url', true);
  v_secret TEXT := current_setting('app.settings.customer_communication_automation_secret', true);
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND to_regproc('net.http_post') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'customer-communication-auto-runner') THEN
      PERFORM cron.unschedule('customer-communication-auto-runner');
    END IF;
    PERFORM cron.schedule(
      'customer-communication-auto-runner', '*/15 * * * *',
      $job$SELECT net.http_post(url := COALESCE(NULLIF(current_setting('app.settings.supabase_url', true), ''), 'https://invalid-communication-config.invalid') || '/functions/v1/customer-communication-auto-runner', headers := jsonb_build_object('X-Communication-Automation-Secret', COALESCE(NULLIF(current_setting('app.settings.customer_communication_automation_secret', true), ''), 'missing-secret'), 'Content-Type', 'application/json'), body := '{}'::jsonb);$job$
    );
  END IF;
END;
$cron_communications_005$;

-- ===========================================================================
-- 3. Guarda RLS para tabelas futuras (versiona o drift manual de produção)
-- ===========================================================================
-- Produção tem public.rls_auto_enable() + event trigger ensure_rls, ausentes do
-- arquivo morto e do consolidado (398 funções em P contra 397 no schema). Sem
-- esta seção, um banco novo nasce sem a rede de segurança: tabela criada sem
-- RLS fica legível até alguém notar. Definição canônica mínima — habilita RLS
-- em toda tabela nova de public; policies continuam declaradas por migration.
-- Se a definição em produção divergir desta, reconciliar pelo
-- pg_get_functiondef antes de convergir (ver runbook).

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func_rls_auto_enable$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE schema_name = 'public' AND object_type = 'table'
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', r.object_identity);
  END LOOP;
END;
$func_rls_auto_enable$;

-- Função de event trigger nunca é chamada por RPC: fecha como as demais de
-- trigger (padrão da 297/003). service_role fica intocado.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

DO $event_trigger_005$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ensure_rls') THEN
    BEGIN
      CREATE EVENT TRIGGER ensure_rls
        ON ddl_command_end
        WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
        EXECUTE FUNCTION public.rls_auto_enable();
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE WARNING '005: sem privilegio para CREATE EVENT TRIGGER neste banco; ensure_rls nao criado. Criar manualmente como superuser (ver runbook).';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '005: ensure_rls nao criado (%).', SQLERRM;
    END;
  END IF;
END;
$event_trigger_005$;
