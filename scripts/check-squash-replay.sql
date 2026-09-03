-- Asserções pós-replay do schema consolidado v1.0 (PR 651 / ADR 0062).
--
-- Roda contra o Postgres descartável montado por scripts/setup-local-pg.sh,
-- DEPOIS das migrations consolidadas e ANTES do seed.sql: trava em banco real o que os
-- gates estáticos não enxergam (a classe inteira do bloqueante 1 — SQL que não
-- aplica — e as regressões de seed 2/3/4). Falha com EXCEPTION (exit != 0 via
-- ON_ERROR_STOP=1). Uso no CI: job migration-replay em .github/workflows/ci.yml.
--
-- Desenho anti-armadilha: este gate roda em TODA PR futura, então só trava
-- PISOS e PRESENÇAS dos objetos que os bloqueantes destruíram — nunca
-- igualdades absolutas contra o schema de hoje. A migration 005 que adicionar
-- uma tabela, um tipo de alerta ou uma baseline não pode falhar aqui.
-- Tripwire assumido e documentado: aposentar um 4º tipo de alerta (além do
-- trio 347/348) derruba o piso de ativas de propósito — quem aposentar atualiza
-- o piso e este comentário juntos.
--
-- Rollback: n/a (somente leitura; banco descartável).

DO $squash_replay$
DECLARE
  v_tabelas INTEGER;
  v_trgm INTEGER;
  v_catalog INTEGER;
  v_ativas INTEGER;
  v_funcs INTEGER;
  v_policies INTEGER;
  v_triggers INTEGER;
  v_nosearch INTEGER;
  v_norls INTEGER;
  v_table TEXT;
  v_function TEXT;
BEGIN
  -- Estrutura mínima sobrevivendo ao apply (bloqueante 1 morria na 001).
  -- Piso, não igualdade: tabelas futuras somem, nunca subtraem.
  SELECT COUNT(*) INTO v_tabelas FROM pg_tables WHERE schemaname = 'public';
  IF v_tabelas < 106 THEN
    RAISE EXCEPTION 'Tabelas em public: % (piso 106).', v_tabelas;
  END IF;
  -- Os DOIS índices trgm de customers: um EXISTS sobre o IN passa com metade.
  SELECT COUNT(*) INTO v_trgm FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN ('idx_customers_name_trgm', 'idx_customers_cnpj_cpf_trgm');
  IF to_regclass('public.customers') IS NULL OR v_trgm <> 2 THEN
    RAISE EXCEPTION 'Índices gin_trgm_ops de customers ausentes (% de 2): pg_trgm fora de public quebra o apply da 001.', v_trgm;
  END IF;

  -- Seed do catálogo de alertas: pisos + presenças (bloqueantes 2 e 3).
  -- Tipos futuros (ativos ou não) não quebram este gate; o que não pode
  -- voltar a acontecer é perder linha, perder ativo ou reativar aposentado.
  SELECT COUNT(*), COUNT(*) FILTER (WHERE active)
    INTO v_catalog, v_ativas FROM public.alert_type_catalog;
  IF v_catalog < 32 OR v_ativas < 29 THEN
    RAISE EXCEPTION 'alert_type_catalog: % linhas (% ativas), piso 32 (29).', v_catalog, v_ativas;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.alert_type_catalog WHERE type = 'portal_reprocessamento_falhou' AND active) THEN
    RAISE EXCEPTION 'Tipo portal_reprocessamento_falhou ausente ou inativo no catálogo.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.alert_type_catalog WHERE active AND type IN ('invoice_overdue', 'invoice_payment_invalid', 'invoice_cancel_blocked')) THEN
    RAISE EXCEPTION 'Aposentados 347/348 reativados: invoice_overdue, invoice_payment_invalid e invoice_cancel_blocked devem permanecer active = false.';
  END IF;

  -- Baselines do ADR (bloqueante 4): presença de cada chave, não contagem.
  IF NOT EXISTS (SELECT 1 FROM public.agency_report_pending_baselines WHERE baseline_key = 'voyage_pol_schedule_atd')
     OR NOT EXISTS (SELECT 1 FROM public.agency_report_pending_baselines WHERE baseline_key = 'agency_report_deadline_missed') THEN
    RAISE EXCEPTION 'agency_report_pending_baselines sem as 2 chaves de 251/271.';
  END IF;

  -- Pisos estruturais (M3 da revisao final): funcoes, policies,
  -- triggers, RLS e search_path das SECURITY DEFINER. Pisos, nao igualdades:
  -- a 005 adiciona rls_auto_enable (398 funcoes) sem quebrar este gate.
  SELECT COUNT(*) INTO v_funcs FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND NOT EXISTS (
       SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e'
     );
  IF v_funcs < 397 THEN
    RAISE EXCEPTION 'Funcoes do projeto em public: % (piso 397).', v_funcs;
  END IF;
  SELECT COUNT(*) INTO v_policies FROM pg_policies WHERE schemaname = 'public';
  IF v_policies < 273 THEN
    RAISE EXCEPTION 'Policies RLS em public: % (piso 273).', v_policies;
  END IF;
  SELECT COUNT(*) INTO v_triggers FROM pg_trigger t
    JOIN pg_class rel ON rel.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
   WHERE n.nspname = 'public' AND NOT t.tgisinternal;
  IF v_triggers < 144 THEN
    RAISE EXCEPTION 'Triggers em public: % (piso 144).', v_triggers;
  END IF;
  SELECT COUNT(*) INTO v_norls FROM pg_class rel
    JOIN pg_namespace n ON n.oid = rel.relnamespace
   WHERE n.nspname = 'public' AND rel.relkind = 'r' AND NOT rel.relrowsecurity;
  IF v_norls <> 0 THEN
    RAISE EXCEPTION 'Tabelas de public sem RLS: %.', v_norls;
  END IF;
  SELECT COUNT(*) INTO v_nosearch FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND NOT EXISTS (
       SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e'
     )
     AND (p.proconfig IS NULL OR NOT array_to_string(p.proconfig, chr(10)) ILIKE '%search_path%');
  IF v_nosearch <> 0 THEN
    RAISE EXCEPTION 'SECURITY DEFINER sem search_path: %.', v_nosearch;
  END IF;
  -- Grant líquido novo da 004 (sem ele, o navegador recebe 42501).
  IF NOT has_function_privilege('authenticated', 'public.delete_baplie_manifest_for_voyage(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'GRANT da 004 ausente para authenticated em delete_baplie_manifest_for_voyage.';
  END IF;

  -- RLS nao substitui ACL: o PostgREST verifica o grant antes da policy.
  FOREACH v_table IN ARRAY ARRAY[
    'agency_departure_reports', 'baplie_containers', 'billing_batches',
    'bl_transshipments', 'customer_demurrage_agreements',
    'demurrage_invoice_history', 'demurrage_invoice_items',
    'demurrage_invoices', 'demurrage_rates', 'portal_provisioning_events',
    'portal_suppressed_emails', 'vazios_export_operations',
    'voyage_export_schedules', 'voyage_omissions', 'voyage_route_ce_master'
  ] LOOP
    IF NOT has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION 'authenticated sem SELECT em public.%', v_table;
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY[
    'baplie_containers', 'billing_batches',
    'customer_demurrage_agreements', 'demurrage_invoice_items',
    'demurrage_invoices', 'demurrage_rates', 'vazios_export_operations',
    'voyage_export_schedules', 'voyage_route_ce_master'
  ] LOOP
    IF NOT has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'authenticated sem mutacao em public.%', v_table;
    END IF;
  END LOOP;

  -- INSERTs que usam BIGSERIAL precisam de USAGE na sequência, além do ACL
  -- da tabela. Sem isso o primeiro insert falha em nextval() com 42501.
  FOREACH v_table IN ARRAY ARRAY[
    'baplie_containers_id_seq', 'billing_batches_id_seq',
    'bl_transshipments_id_seq', 'customer_demurrage_agreements_id_seq',
    'demurrage_invoice_history_id_seq', 'demurrage_invoice_items_id_seq',
    'demurrage_invoices_id_seq', 'demurrage_rates_id_seq',
    'portal_provisioning_events_id_seq', 'portal_suppressed_emails_id_seq',
    'voyage_omissions_id_seq'
  ] LOOP
    IF NOT has_sequence_privilege('authenticated', format('public.%I', v_table), 'USAGE') THEN
      RAISE EXCEPTION 'authenticated sem USAGE em public.%', v_table;
    END IF;
  END LOOP;

  -- Defaults futuros devem nascer fechados, nao apenas as funcoes atuais.
  EXECUTE 'CREATE FUNCTION public.__check_default_acl() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$';
  IF has_function_privilege('anon', 'public.__check_default_acl()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.__check_default_acl()', 'EXECUTE') THEN
    EXECUTE 'DROP FUNCTION public.__check_default_acl()';
    RAISE EXCEPTION 'default EXECUTE de funcao futura continua aberto a anon/authenticated.';
  END IF;
  EXECUTE 'DROP FUNCTION public.__check_default_acl()';

  FOREACH v_function IN ARRAY ARRAY[
    'public._portal_log_event(bigint,bigint,bigint,text,text,text,text,text,text,text)',
    'public.portal_login_check_rate_limit(text)',
    'public.portal_login_register_failure(text)',
    'public.portal_login_register_success(text)',
    'public.portal_recovery_check_rate_limit(text)',
    'public.portal_recovery_register_failure(text)'
  ] LOOP
    IF NOT has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role sem EXECUTE em %', v_function;
    END IF;
  END LOOP;

  -- Um replay somente de migrations precisa entregar os catalogos que o app
  -- consulta antes de qualquer seed de desenvolvimento.
  IF (SELECT COUNT(*) FROM public.charge_tables) < 3
     OR (SELECT COUNT(*) FROM public.charge_table_items) < 24
     OR (SELECT COUNT(*) FROM public.demurrage_rates) < 12
     OR (SELECT COUNT(*) FROM public.depots) < 9
     OR (SELECT COUNT(*) FROM public.depot_services) < 50 THEN
    RAISE EXCEPTION 'Catalogos operacionais incompletos apos migrations: charge_tables=%, items=%, rates=%, depots=%, services=%',
      (SELECT COUNT(*) FROM public.charge_tables),
      (SELECT COUNT(*) FROM public.charge_table_items),
      (SELECT COUNT(*) FROM public.demurrage_rates),
      (SELECT COUNT(*) FROM public.depots),
      (SELECT COUNT(*) FROM public.depot_services);
  END IF;

  IF to_regproc('net.http_post') IS NULL OR to_regclass('cron.job') IS NULL
     OR to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION 'Prerequisitos pg_net, pg_cron ou Storage ausentes apos migrations.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'demurrage-disputes')
     OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'customer-communications') THEN
    RAISE EXCEPTION 'Buckets obrigatorios de Storage ausentes apos migrations.';
  END IF;

  RAISE NOTICE 'check-squash-replay OK: estrutura, ACL/RLS, defaults futuros, RPCs service_role, catalogos, Storage e prerequisitos operacionais.';
END;
$squash_replay$;
