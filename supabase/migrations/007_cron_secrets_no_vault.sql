-- 007: a configuracao dos jobs pg_cron sai de `app.settings.*` e passa ao Vault.
--
-- Contexto (pendencia pos-merge da PR 651): a 005 previa alimentar os jobs HTTP
-- por GUCs `app.settings.*`. A role `postgres` do Supabase nao e superuser e nao
-- pode criar GUC de classe customizada: `ALTER DATABASE|ROLE ... SET
-- app.settings.supabase_url` falha com `permission denied to set parameter`.
-- Nao existe caminho para esse mecanismo sem privilegio de plataforma, entao a
-- convergencia de producao deixou os quatro jobs ativos com URL e segredo
-- LITERAIS dentro de `cron.job.command` — texto em claro, legivel por qualquer
-- conexao `postgres`/dashboard e presente em qualquer dump daquela tabela.
--
-- Decisao (ADR 0063): o mecanismo de configuracao passa a ser o Supabase Vault
-- (extensao `supabase_vault`, ja instalada), lido por uma funcao em schema
-- proprio, fora do PostgREST. O comando do job passa a citar apenas NOMES.
--
-- Propriedades:
--   - `vault.secrets` e `vault.decrypted_secrets` nao tem grant para anon nem
--     authenticated (ACL da plataforma: supabase_admin, postgres, service_role);
--   - `ops` nao concede USAGE a PUBLIC/anon/authenticated e nao esta na lista de
--     schemas expostos pela Data API, entao a funcao nao vira endpoint REST;
--   - a funcao e SECURITY INVOKER de proposito: quem nao alcanca o Vault por
--     privilegio proprio nao passa a alcancar por causa dela. O cron roda como
--     `postgres`, que ja tem o SELECT;
--   - rotacao passa a ser `vault.update_secret(...)`, sem tocar em cron.job.
--
-- Idempotente: reexecutar nao duplica segredo, job nem schema.
--
-- Rollback (reintroduz segredo literal no comando; so em emergencia):
--   SELECT cron.schedule('portal-daily-digest', '0 11 * * *', $$SELECT net.http_post(url := '<BASE>/functions/v1/portal-daily-digest', headers := jsonb_build_object('Authorization', 'Bearer ' || '<SEGREDO>'));$$);
--   -- idem para alerts-foundation-detectors, demurrage-dunning e
--   -- customer-communication-auto-runner; depois:
--   DROP FUNCTION IF EXISTS ops.dispatch_edge_job(text, text, text, text);
--   DROP SCHEMA IF EXISTS ops;
--   -- os segredos permanecem no Vault; remova-os so apos confirmar o rollback.

-- ===========================================================================
-- 1. Pre-requisitos
-- ===========================================================================

DO $prereq_007$
BEGIN
  IF to_regclass('vault.secrets') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION '007: extensao supabase_vault ausente; a configuracao dos jobs nao tem onde morar.';
  END IF;
  IF to_regproc('net.http_post') IS NULL THEN
    RAISE EXCEPTION '007: pg_net/net.http_post ausente; jobs HTTP nao podem operar.';
  END IF;
  IF to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION '007: pg_cron/cron.job ausente; jobs nao podem operar.';
  END IF;
END;
$prereq_007$;

-- ===========================================================================
-- 2. Schema `ops`: superficie operacional fora do alcance do cliente
-- ===========================================================================

CREATE SCHEMA IF NOT EXISTS ops;

COMMENT ON SCHEMA ops IS
  'Superficie operacional server-side (cron/pg_net). Nao exposta pela Data API; sem USAGE para anon/authenticated. Ver ADR 0063.';

-- Explicito porque a 007 pode encontrar um schema `ops` pre-existente: um
-- CREATE SCHEMA novo ja nasce sem grant para PUBLIC, mas nao se ele ja existia.
REVOKE ALL ON SCHEMA ops FROM PUBLIC;
REVOKE ALL ON SCHEMA ops FROM anon, authenticated;

-- ===========================================================================
-- 3. Dispatcher unico dos jobs HTTP
-- ===========================================================================
-- ponytail: uma funcao para os quatro jobs, e o segredo e lido a cada disparo.
-- Teto: quatro leituras por hora no pior caso, custo irrelevante diante de
-- decifrar uma vez e cachear. Se um dia houver dezenas de jobs de alta
-- frequencia, o caminho de upgrade e um cache por transacao — nunca
-- reintroduzir literal no comando do job.

CREATE OR REPLACE FUNCTION ops.dispatch_edge_job(
  p_function      text,
  p_secret_name   text,
  p_header_name   text DEFAULT 'Authorization',
  p_header_prefix text DEFAULT 'Bearer '
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $dispatch_edge_job$
DECLARE
  v_base   text;
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_base
    FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = p_secret_name;

  -- Banco novo / branch de Preview nasce com o Vault vazio. Avisar e nao
  -- disparar e melhor do que um POST para host invalido a cada 15 minutos.
  IF NULLIF(v_base, '') IS NULL OR NULLIF(v_secret, '') IS NULL THEN
    RAISE WARNING 'ops.dispatch_edge_job: Vault sem SUPABASE_URL e/ou %; job % nao disparado.',
      p_secret_name, p_function;
    RETURN NULL;
  END IF;

  RETURN net.http_post(
    url     := v_base || '/functions/v1/' || p_function,
    headers := jsonb_build_object(
                 p_header_name, p_header_prefix || v_secret,
                 'Content-Type', 'application/json'
               ),
    body    := '{}'::jsonb
  );
END;
$dispatch_edge_job$;

COMMENT ON FUNCTION ops.dispatch_edge_job(text, text, text, text) IS
  'Dispara uma Edge Function pelo pg_net lendo base e segredo do Vault. Chamada pelos jobs pg_cron, que rodam como postgres. SECURITY INVOKER: nao concede alcance ao Vault a quem nao tem.';

REVOKE ALL ON FUNCTION ops.dispatch_edge_job(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.dispatch_edge_job(text, text, text, text) FROM anon, authenticated;

-- ===========================================================================
-- 4. Semeadura do Vault a partir dos comandos legados
-- ===========================================================================
-- Roda uma unica vez, no banco que carrega os literais (producao). Nao gera
-- segredo novo e nao imprime valor: move o que ja existe para o cofre, para que
-- os consumidores (Edge Function Secrets de mesmo nome) sigam sincronizados.
-- Em banco novo nao ha o que extrair: avisa e segue.

DO $seed_vault_007$
DECLARE
  r        RECORD;
  v_cmd    text;
  v_value  text;
  v_frag   text;
  v_pos    integer;
  v_next   text;
BEGIN
  -- 4.1 Base da API. Nao e segredo; mora no mesmo lugar para que exista um
  -- unico caminho de leitura e uma unica rotacao.
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'SUPABASE_URL') THEN
    SELECT substring(command from $re$url := '(https://[^']+)/functions/v1/$re$)
      INTO v_value
      FROM cron.job
     WHERE command ~ 'net\.http_post'
     ORDER BY jobname
     LIMIT 1;
    IF v_value IS NULL THEN
      RAISE WARNING '007: nenhum job legado para derivar SUPABASE_URL; cadastre no Vault (docs/operations/segredos-cron.md).';
    ELSE
      PERFORM vault.create_secret(
        v_value, 'SUPABASE_URL',
        'Base da API do projeto (https://<ref>.supabase.co). Configuracao, nao segredo; vive no Vault para ter caminho unico de leitura e rotacao.');
    END IF;
  END IF;

  -- 4.2 Segredos dos quatro jobs.
  FOR r IN
    SELECT * FROM (VALUES
      ('portal-daily-digest',
       'PORTAL_DIGEST_SECRET',
       $re$Bearer ' \|\| '([^']+)'$re$,
       $fr$Bearer ' || '%s'$fr$),
      ('alerts-foundation-detectors',
       'ALERTS_DETECTOR_SECRET',
       $re$Bearer ' \|\| '([^']+)'$re$,
       $fr$Bearer ' || '%s'$fr$),
      ('demurrage-dunning',
       'DEMURRAGE_DUNNING_SECRET',
       $re$Bearer ' \|\| '([^']+)'$re$,
       $fr$Bearer ' || '%s'$fr$),
      ('customer-communication-auto-runner',
       'CUSTOMER_COMMUNICATION_AUTOMATION_SECRET',
       $re$'X-Communication-Automation-Secret', '([^']+)'$re$,
       $fr$'X-Communication-Automation-Secret', '%s'$fr$)
    ) AS t(jobname, secret_name, extract_re, frag_template)
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM vault.secrets WHERE name = r.secret_name);

    SELECT command INTO v_cmd FROM cron.job WHERE jobname = r.jobname;
    v_value := CASE WHEN v_cmd IS NULL THEN NULL ELSE substring(v_cmd from r.extract_re) END;

    -- Banco novo: o comando usa current_setting/COALESCE, nao literal.
    IF v_value IS NULL OR v_value = '' OR v_value LIKE 'missing-%' THEN
      RAISE WARNING '007: sem segredo literal recuperavel em %; cadastre % no Vault (docs/operations/segredos-cron.md).',
        r.jobname, r.secret_name;
      CONTINUE;
    END IF;

    -- O literal extraido precisa ser o literal INTEIRO. Se o segredo contiver
    -- aspas simples (escapadas como duas), `[^']+` truncaria e o cofre nasceria
    -- com valor errado: abortar e mais seguro do que quebrar o job em silencio.
    v_frag := format(r.frag_template, v_value);
    v_pos  := strpos(v_cmd, v_frag);
    v_next := substr(v_cmd, v_pos + length(v_frag), 1);
    IF v_pos = 0 OR v_next NOT IN (',', ')') THEN
      RAISE EXCEPTION '007: nao foi possivel extrair com seguranca o segredo de % (literal truncado ou formato inesperado); cadastre % no Vault manualmente antes de reaplicar.',
        r.jobname, r.secret_name;
    END IF;

    PERFORM vault.create_secret(
      v_value, r.secret_name,
      format('Segredo do job pg_cron %s. Espelha o Edge Function Secret de mesmo nome: rotacionar os dois juntos.', r.jobname));
  END LOOP;
END;
$seed_vault_007$;

-- ===========================================================================
-- 5. Reagendamento: o comando cita nomes, nunca valores
-- ===========================================================================
-- unschedule + schedule e a mesma forma idempotente usada pela 003/005: o
-- jobid muda, o nome (que e o contrato operacional) permanece.

DO $reschedule_007$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('portal-daily-digest', '0 11 * * *',
       $cmd$SELECT ops.dispatch_edge_job('portal-daily-digest', 'PORTAL_DIGEST_SECRET');$cmd$),
      ('alerts-foundation-detectors', '*/15 * * * *',
       $cmd$SELECT ops.dispatch_edge_job('alerts-detector', 'ALERTS_DETECTOR_SECRET');$cmd$),
      ('demurrage-dunning', '0 * * * *',
       $cmd$SELECT ops.dispatch_edge_job('demurrage-dunning', 'DEMURRAGE_DUNNING_SECRET');$cmd$),
      ('customer-communication-auto-runner', '*/15 * * * *',
       $cmd$SELECT ops.dispatch_edge_job('customer-communication-auto-runner', 'CUSTOMER_COMMUNICATION_AUTOMATION_SECRET', 'X-Communication-Automation-Secret', '');$cmd$)
    ) AS t(jobname, schedule, command)
  LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = r.jobname) THEN
      PERFORM cron.unschedule(r.jobname);
    END IF;
    PERFORM cron.schedule(r.jobname, r.schedule, r.command);
  END LOOP;
END;
$reschedule_007$;

-- ===========================================================================
-- 6. Verificacao executavel
-- ===========================================================================

DO $verify_007$
DECLARE
  v_vazando  text;
  v_faltando text;
BEGIN
  SELECT string_agg(jobname, ', ' ORDER BY jobname) INTO v_vazando
    FROM cron.job
   WHERE command ~ $re$Bearer ' \|\| '[^']$re$
      OR command ~ $re$'X-Communication-Automation-Secret',\s*'[^']$re$;
  IF v_vazando IS NOT NULL THEN
    RAISE EXCEPTION '007: jobs ainda expoem segredo literal no comando: %', v_vazando;
  END IF;

  SELECT string_agg(esperado, ', ' ORDER BY esperado) INTO v_faltando
    FROM unnest(ARRAY[
      'portal-daily-digest',
      'alerts-foundation-detectors',
      'demurrage-dunning',
      'customer-communication-auto-runner'
    ]) AS esperado
   WHERE NOT EXISTS (
     SELECT 1 FROM cron.job j
      WHERE j.jobname = esperado
        AND j.active
        AND j.command LIKE 'SELECT ops.dispatch_edge_job(%'
   );
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION '007: jobs HTTP ausentes, inativos ou fora do dispatcher: %', v_faltando;
  END IF;
END;
$verify_007$;
