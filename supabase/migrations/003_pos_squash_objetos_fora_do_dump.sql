-- 003: restaura o que um pg_dump de `public` estruturalmente não carrega.
--
-- As 001 e 002 nascem de um pg_dump do schema `public` de produção. Três
-- classes de objeto vivas em produção ficam FORA desse recorte e por isso não
-- aparecem em nenhum dump dele:
--
--   1. pg_default_acl — os ALTER DEFAULT PRIVILEGES da migration arquivada 297
--      (ADR 0047). A parte que precisa rodar antes da criação dos objetos está
--      na 001; a varredura de resíduo está aqui.
--   2. schema `cron` — os 8 jobs pg_cron das migrations arquivadas 041, 053,
--      181, 185, 190, 319, 378 e 381.
--   3. schema `storage` — os buckets e as policies de storage.objects das
--      migrations arquivadas 325, 373 e 375.
--
-- Sem esta migration um ambiente novo (branch de preview do Supabase, `supabase
-- db reset`) sobe com toda a automação agendada desligada em silêncio e sem os
-- buckets de anexo de contestação e de comunicados.
--
-- Regenerar o dump NÃO recupera nada disto: a camada precisa ser reaplicada à
-- mão. Ver item 5 da ADR 0062 e o aviso em `scripts/README.md`.
--
-- Tudo aqui é idempotente e guardado: roda sem erro em bancos sem pg_cron,
-- pg_net ou storage (o Postgres descartável usado no replay local).


-- ===========================================================================
-- Varredura default-deny de EXECUTE em funções (ADR 0047 / migration 297)
-- ===========================================================================
-- A parte 1 (default do schema) vive na 001, porque default privilege só vale
-- no momento da criação do objeto. Esta é a parte 2 da 297, fiel ao original:
-- a varredura do resíduo em FUNÇÕES. Ela NÃO é redundante com a 001, e não
-- deve ser removida por parecer:
--
--   - No Supabase, a 001 fecha o default aberto da plataforma; a varredura é a
--     rede para o caso de os objetos nascerem sob outro papel.
--   - Em Postgres puro (o banco descartável do replay local) a 001 é inócua:
--     `ALTER DEFAULT PRIVILEGES ... REVOKE` não desfaz o EXECUTE embutido que o
--     PostgreSQL dá a PUBLIC quando nunca houve um default configurado — o
--     `pg_default_acl` fica vazio e `proacl` continua NULL. Ali é esta varredura
--     que fecha as 397 funções.
--
-- Escopo deliberadamente restrito a funções, como a 297: nenhuma migration
-- arquivada revogou tabela ou sequência de `anon`, e revogar aqui criaria
-- política nova que diverge produção de preview. A fronteira de tabelas é a
-- RLS, reproduzida pela 002.
--
-- Nada aqui remove os GRANT explícitos da 002: apenas PUBLIC e `anon` (e
-- `authenticated` em função de trigger, que nunca é chamada por RPC) são
-- revogados. `service_role` fica intocado, como na 297 — é por ele que as Edge
-- Functions alcançam as RPCs sem grant explícito.
--
-- Exceção única e explícita: public.portal_ship_schedule(), vitrine pública da
-- programação de navios (ADR 0013 / achado A-02 da auditoria 2026-08-14).

DO $default_deny$
DECLARE
  r RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature,
           p.prorettype = 'trigger'::regtype AS is_trigger
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND pg_get_userbyid(p.proowner) = current_user
      AND p.proname <> 'portal_ship_schedule'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.signature);
    IF r.is_trigger THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.signature);
    END IF;
    v_count := v_count + 1;
  END LOOP;
  -- Guarda de sanidade herdada da 297: contagem zero significa que o filtro
  -- deixou de casar (dono ou schema mudou) e a varredura virou no-op
  -- silenciosa — falhar é melhor do que aplicar sem efeito.
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Nenhuma função de public varrida; verifique o filtro antes de aplicar.';
  END IF;
  RAISE NOTICE 'Funções varridas: %', v_count;
END;
$default_deny$;


-- ===========================================================================
-- Agendamentos pg_cron
-- ===========================================================================
-- Os jobs vivem no schema `cron`, fora de `public`, e por isso não aparecem no
-- dump que originou este arquivo. Sem esta seção, um banco novo sobe com toda a
-- automação desligada em silêncio: expiração de convites, resumo diário do
-- Portal, detectores de alerta, régua de Demurrage e o runner de comunicados.
-- Estado final das migrations arquivadas 041, 053, 181, 185, 190, 319, 378 e
-- 381. O job `mark-overdue-invoices` (031) NÃO é recriado: a 348 o desligou.

DO $cron_ext$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    BEGIN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'pg_cron indisponivel neste banco (%); os jobs agendados nao serao criados.', SQLERRM;
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    BEGIN
      -- pg_net é não-relocável: instala-se sempre no schema `net`. Com
      -- WITH SCHEMA o CREATE falha, o handler abaixo rebaixa para WARNING e
      -- os quatro jobs HTTP nunca são agendados por esse caminho.
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'pg_net indisponivel neste banco (%); os jobs HTTP nao serao criados.', SQLERRM;
    END;
  END IF;
END;
$cron_ext$;

-- 041: limpeza de sessões expiradas do Portal.
DO $cron_sessions$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-portal-sessions') THEN
      PERFORM cron.unschedule('cleanup-portal-sessions');
    END IF;
    PERFORM cron.schedule(
      'cleanup-portal-sessions', '0 3 * * *',
      $job$DELETE FROM public.customer_portal_sessions WHERE expires_at < now() - INTERVAL '1 day'$job$
    );
  END IF;
END;
$cron_sessions$;

-- 053: limpeza do log de rate limit de provisionamento.
DO $cron_rate_limit$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-provision-rate-limit') THEN
      PERFORM cron.unschedule('cleanup-provision-rate-limit');
    END IF;
    PERFORM cron.schedule(
      'cleanup-provision-rate-limit', '30 3 * * *',
      $job$DELETE FROM public.provision_rate_limit_log WHERE called_at < now() - INTERVAL '2 days'$job$
    );
  END IF;
END;
$cron_rate_limit$;

-- 181: marca convites do Portal expirados e abre o alerta correspondente.
DO $cron_invites$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'portal-mark-expired-invites') THEN
      PERFORM cron.unschedule('portal-mark-expired-invites');
    END IF;
    PERFORM cron.schedule(
      'portal-mark-expired-invites', '*/15 * * * *',
      $job$SELECT public.portal_mark_expired_invites();$job$
    );
  END IF;
END;
$cron_invites$;

-- 190: recomputa as pendências gerais exibidas no Portal.
DO $cron_pendencies$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'portal-refresh-general-pendencies') THEN
      PERFORM cron.unschedule('portal-refresh-general-pendencies');
    END IF;
    PERFORM cron.schedule(
      'portal-refresh-general-pendencies', '*/15 * * * *',
      $job$SELECT public.portal_refresh_general_pendencies();$job$
    );
  END IF;
END;
$cron_pendencies$;

-- 185: resumo diário do Portal às 08:00 America/Sao_Paulo (11:00 UTC).
DO $cron_digest$
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
$cron_digest$;

-- 319: runner unificado dos detectores de alerta.
DO $cron_alerts$
DECLARE
  v_url TEXT := current_setting('app.settings.supabase_url', true);
  v_secret TEXT := current_setting('app.settings.alerts_detector_secret', true);
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND to_regproc('net.http_post') IS NOT NULL THEN
    IF NULLIF(v_url, '') IS NULL OR NULLIF(v_secret, '') IS NULL THEN
      RAISE WARNING 'alerts-foundation-detectors sera agendado sem URL/segredo completos; a execucao falhara visivelmente ate app.settings.* ser configurado.';
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
$cron_alerts$;

-- 378: régua de cobrança de Demurrage.
DO $cron_dunning$
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
      RAISE WARNING 'demurrage-dunning sera agendado sem URL/segredo completos; a execucao falhara visivelmente ate app.settings.* ser configurado.';
    END IF;
    PERFORM cron.schedule(
      'demurrage-dunning',
      '0 * * * *',
      $job$SELECT net.http_post(url := COALESCE(NULLIF(current_setting('app.settings.supabase_url', true), ''), 'https://invalid-demurrage-dunning-config.invalid') || '/functions/v1/demurrage-dunning', headers := jsonb_build_object('Authorization', 'Bearer ' || COALESCE(NULLIF(current_setting('app.settings.demurrage_dunning_secret', true), ''), 'missing-demurrage-dunning-secret'), 'Content-Type', 'application/json'), body := '{}'::jsonb);$job$
    );
  END IF;
END;
$cron_dunning$;

-- 381: runner de automação de comunicados ao cliente.
DO $cron_communications$
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
$cron_communications$;


-- ===========================================================================
-- Buckets e policies de Storage
-- ===========================================================================
-- `storage.buckets` e `storage.objects` vivem fora de `public` e também não
-- aparecem no dump. Sem esta seção, os anexos de contestação de Demurrage e de
-- comunicados ao cliente falham em qualquer ambiente novo. Estado final das
-- migrations arquivadas 325 (disputas) e 373 + 375 (comunicados: a 375 removeu
-- as policies de insert/update/delete porque o upload passa pela Edge Function).

DO $storage_disputes$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
      VALUES ('demurrage-disputes', 'demurrage-disputes', false, 10485760, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'text/plain'])
      ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760
    $sql$;
    EXECUTE 'DROP POLICY IF EXISTS demurrage_dispute_objects_read ON storage.objects';
    EXECUTE $sql$
      CREATE POLICY demurrage_dispute_objects_read ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'demurrage-disputes' AND (public.is_active_user() OR (name LIKE (public.current_portal_customer_id()::text || '/%'))))
    $sql$;
    EXECUTE 'DROP POLICY IF EXISTS demurrage_dispute_objects_insert ON storage.objects';
    EXECUTE $sql$
      CREATE POLICY demurrage_dispute_objects_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'demurrage-disputes' AND (public.is_active_user() OR (name LIKE (public.current_portal_customer_id()::text || '/%'))))
    $sql$;
  END IF;
END;
$storage_disputes$;

DO $storage_communications$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES ('customer-communications', 'customer-communications', false, 10485760, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'text/plain'])
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        public = false,
        file_size_limit = 10485760,
        allowed_mime_types = EXCLUDED.allowed_mime_types
    $sql$;
    EXECUTE 'DROP POLICY IF EXISTS customer_communications_objects_read ON storage.objects';
    EXECUTE $sql$
      CREATE POLICY customer_communications_objects_read ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'customer-communications' AND public.is_active_read_user())
    $sql$;
    -- 375: upload, alteração e remoção passam exclusivamente pela Edge Function
    -- (service_role); nenhuma policy de escrita para `authenticated`.
    EXECUTE 'DROP POLICY IF EXISTS customer_communications_objects_insert ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS customer_communications_objects_update ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS customer_communications_objects_delete ON storage.objects';
  END IF;
END;
$storage_communications$;
