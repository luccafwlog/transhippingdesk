-- Asserções pós-replay do schema consolidado v1.0 (PR 651 / ADR 0062).
--
-- Roda contra o Postgres descartável montado por scripts/setup-local-pg.sh,
-- DEPOIS das 4 migrations e ANTES do seed.sql: trava em banco real o que os
-- gates estáticos não enxergam (a classe inteira do bloqueante 1 — SQL que não
-- aplica — e as regressões de seed 2/3/4). Falha com EXCEPTION (exit != 0 via
-- ON_ERROR_STOP=1). Uso no CI: job migration-replay em .github/workflows/ci.yml.
--
-- Desenho anti-armadilha: este gate roda em TODA PR futura, então só trava
-- PISOS e PRESENÇAS dos objetos que os bloqueantes destruíram — nunca
-- igualdades absolutas contra o schema de hoje. A migration 005 que adicionar
-- uma tabela, um tipo de alerta ou uma baseline não pode falhar aqui.
--
-- Rollback: n/a (somente leitura; banco descartável).

DO $squash_replay$
DECLARE
  v_tabelas INTEGER;
  v_trgm INTEGER;
  v_catalog INTEGER;
  v_ativas INTEGER;
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

  -- Grant líquido novo da 004 (sem ele, o navegador recebe 42501).
  IF NOT has_function_privilege('authenticated', 'public.delete_baplie_manifest_for_voyage(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'GRANT da 004 ausente para authenticated em delete_baplie_manifest_for_voyage.';
  END IF;

  RAISE NOTICE 'check-squash-replay OK: >=106 tabelas, 2 índices trgm, catálogo >=32/29, 2 baselines, grant 004.';
END;
$squash_replay$;
