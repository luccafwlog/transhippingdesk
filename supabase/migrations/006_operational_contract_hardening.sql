-- 006: fecha o contrato operacional descoberto na auditoria da PR 651.
--
-- Este arquivo e deliberadamente executavel: 001--004 podem ser apenas
-- marcadas como aplicadas durante a convergencia de um banco existente.
-- Portanto, efeitos que precisam chegar a producao ficam repetidos aqui de
-- forma idempotente: defaults, ACLs, baselines, grants de RPC e a guarda RLS.
--
-- Tambem torna explicitos os grants usados pelo navegador e pelas Edge
-- Functions. RLS continua sendo a autorizacao por linha; ACL decide se a
-- operacao pode sequer chegar a policy.
--
-- Rollback: executar os REVOKE/ALTER correspondentes somente apos confirmar
-- que o codigo nao depende mais desses acessos. Nao remover as baselines nem
-- os catalogos operacionais de um banco com dados.

-- ---------------------------------------------------------------------------
-- 1. Defaults futuros de funcoes: revogacao global + especifica do schema.
-- ---------------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. ACL das tabelas acessadas diretamente pelo cliente.
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

REVOKE ALL ON TABLE
  public.agency_departure_reports,
  public.baplie_containers,
  public.billing_batches,
  public.bl_transshipments,
  public.customer_demurrage_agreements,
  public.demurrage_invoice_history,
  public.demurrage_invoice_items,
  public.demurrage_invoices,
  public.demurrage_rates,
  public.portal_provisioning_events,
  public.portal_suppressed_emails,
  public.vazios_export_operations,
  public.voyage_export_schedules,
  public.voyage_omissions,
  public.voyage_route_ce_master
FROM PUBLIC, anon, authenticated;

-- Leitura direta do navegador.
GRANT SELECT ON TABLE
  public.agency_departure_reports,
  public.bl_transshipments,
  public.demurrage_invoice_history,
  public.demurrage_invoice_items,
  public.portal_provisioning_events,
  public.portal_suppressed_emails,
  public.voyage_omissions
TO authenticated;

-- As policies existentes destas tabelas ja definem os limites por operacao;
-- estes grants tornam alcancaveis as operacoes que o app e as policies declaram.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.baplie_containers,
  public.billing_batches,
  public.customer_demurrage_agreements,
  public.demurrage_invoice_items,
  public.demurrage_invoices,
  public.demurrage_rates,
  public.vazios_export_operations,
  public.voyage_export_schedules,
  public.voyage_route_ce_master
TO authenticated;

-- Edge Functions usam a chave service role; o acesso server-side nao deve
-- depender de defaults da plataforma.
GRANT ALL ON TABLE
  public.agency_departure_reports,
  public.baplie_containers,
  public.billing_batches,
  public.bl_transshipments,
  public.customer_demurrage_agreements,
  public.demurrage_invoice_history,
  public.demurrage_invoice_items,
  public.demurrage_invoices,
  public.demurrage_rates,
  public.portal_provisioning_events,
  public.portal_suppressed_emails,
  public.vazios_export_operations,
  public.voyage_export_schedules,
  public.voyage_omissions,
  public.voyage_route_ce_master
TO service_role;

REVOKE ALL ON SEQUENCE
  public.baplie_containers_id_seq,
  public.billing_batches_id_seq,
  public.bl_transshipments_id_seq,
  public.customer_demurrage_agreements_id_seq,
  public.demurrage_invoice_history_id_seq,
  public.demurrage_invoice_items_id_seq,
  public.demurrage_invoices_id_seq,
  public.demurrage_rates_id_seq,
  public.portal_provisioning_events_id_seq,
  public.portal_suppressed_emails_id_seq,
  public.voyage_omissions_id_seq
FROM PUBLIC, anon, authenticated;

GRANT USAGE, SELECT ON SEQUENCE
  public.baplie_containers_id_seq,
  public.billing_batches_id_seq,
  public.bl_transshipments_id_seq,
  public.customer_demurrage_agreements_id_seq,
  public.demurrage_invoice_history_id_seq,
  public.demurrage_invoice_items_id_seq,
  public.demurrage_invoices_id_seq,
  public.demurrage_rates_id_seq,
  public.portal_provisioning_events_id_seq,
  public.portal_suppressed_emails_id_seq,
  public.voyage_omissions_id_seq
TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. RPCs chamadas pelas Edge Functions com service_role.
-- ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public._portal_log_event(
  bigint, bigint, bigint, text, text, text, text, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_login_check_rate_limit(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_login_register_failure(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_login_register_success(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_recovery_check_rate_limit(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_recovery_register_failure(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Efeitos que nao podem ficar somente em migration repair.
-- ---------------------------------------------------------------------------

INSERT INTO public.agency_report_pending_baselines (baseline_key, captured_at)
VALUES
  ('voyage_pol_schedule_atd', clock_timestamp()),
  ('agency_report_deadline_missed', clock_timestamp())
ON CONFLICT (baseline_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Catalogos operacionais para um banco novo.
--
-- O seed continua sendo usado pelo reset, mas um deploy somente de migrations
-- tambem precisa deixar o sistema utilizavel. O bootstrap so preenche catalogos
-- vazios; nunca apaga ou substitui dados operacionais existentes.
-- ---------------------------------------------------------------------------

DO $charge_tables_bootstrap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.charge_tables) THEN
    INSERT INTO public.charge_tables (name, pod, cargo_mode, valid_from, valid_to, active, notes)
    VALUES
      ('Vitoria CNTR 2026', 'BRVIT', 'container', DATE '2026-01-01', DATE '2026-12-31', TRUE, NULL),
      ('Salvador CNTR 2026', 'BRSSA', 'container', DATE '2026-01-01', DATE '2026-12-31', TRUE, NULL),
      ('Vitoria BB 2026', 'BRVIX', 'carga_solta', DATE '2026-01-01', DATE '2026-12-31', TRUE, NULL);
  END IF;
END;
$charge_tables_bootstrap$;

DO $charge_items_bootstrap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.charge_table_items) THEN
    WITH desired(table_name, table_pod, table_mode, item_name, applies_to, container_type,
      cargo_profile, value_brl, currency, category, application_basis, unit_value_brl,
      unit_value_usd, manual_only, active, sort_order) AS (
      VALUES
        ('Vitoria CNTR 2026', 'BRVIT', 'container', 'THD', 'container', NULL, 'standard', 1420, 'BRL', 'base', 'container_distinct_voyage', 1420, NULL, FALSE, TRUE, 10),
        ('Vitoria CNTR 2026', 'BRVIT', 'container', 'THD', 'container', NULL, 'imo', 2130, 'BRL', 'base', 'container_distinct_voyage', 2130, NULL, FALSE, TRUE, 11),
        ('Vitoria CNTR 2026', 'BRVIT', 'container', 'THD', 'container', NULL, 'oog', 2840, 'BRL', 'base', 'container_distinct_voyage', 2840, NULL, FALSE, TRUE, 12),
        ('Vitoria CNTR 2026', 'BRVIT', 'container', 'ISPS', 'container', NULL, 'any', 115, 'BRL', 'base', 'container_distinct_voyage', 115, NULL, FALSE, TRUE, 20),
        ('Vitoria CNTR 2026', 'BRVIT', 'container', 'B/L Fee', 'bl', NULL, 'any', 600, 'BRL', 'base', 'bl', 600, NULL, FALSE, TRUE, 30),
        ('Vitoria CNTR 2026', 'BRVIT', 'container', 'Drop Off Fee', 'container', NULL, 'any', 150, 'BRL', 'base', 'container_distinct_voyage', 150, NULL, FALSE, TRUE, 40),
        ('Vitoria CNTR 2026', 'BRVIT', 'container', 'Damage Protection Fee', 'container', NULL, 'any', 185, 'BRL', 'base', 'container_distinct_voyage', 185, NULL, FALSE, TRUE, 50),
        ('Vitoria CNTR 2026', 'BRVIT', 'container', 'B/L Reissuing', 'bl', NULL, 'any', 600, 'BRL', 'other_charge', 'bl', 600, NULL, TRUE, TRUE, 60),
        ('Vitoria CNTR 2026', 'BRVIT', 'container', 'Correction Letter', 'bl', NULL, 'any', 600, 'BRL', 'other_charge', 'bl', 600, NULL, TRUE, TRUE, 70),
        ('Vitoria CNTR 2026', 'BRVIT', 'container', 'Late Correction Request', 'bl', NULL, 'any', 850, 'BRL', 'other_charge', 'bl', 850, NULL, TRUE, TRUE, 80),
        ('Vitoria CNTR 2026', 'BRVIT', 'container', 'Booking Cancelation Fee', 'teu', NULL, 'any', 0, 'USD', 'other_charge', 'teu', 0, 150, TRUE, TRUE, 90),
        ('Salvador CNTR 2026', 'BRSSA', 'container', 'THD', 'container', NULL, 'standard', 1717, 'BRL', 'base', 'container_distinct_voyage', 1717, NULL, FALSE, TRUE, 10),
        ('Salvador CNTR 2026', 'BRSSA', 'container', 'THD', 'container', NULL, 'imo', 2575.5, 'BRL', 'base', 'container_distinct_voyage', 2575.5, NULL, FALSE, TRUE, 11),
        ('Salvador CNTR 2026', 'BRSSA', 'container', 'THD', 'container', NULL, 'oog', 3434, 'BRL', 'base', 'container_distinct_voyage', 3434, NULL, FALSE, TRUE, 12),
        ('Salvador CNTR 2026', 'BRSSA', 'container', 'ISPS', 'container', NULL, 'any', 50, 'BRL', 'base', 'container_distinct_voyage', 50, NULL, FALSE, TRUE, 20),
        ('Salvador CNTR 2026', 'BRSSA', 'container', 'B/L Fee', 'bl', NULL, 'any', 600, 'BRL', 'base', 'bl', 600, NULL, FALSE, TRUE, 30),
        ('Salvador CNTR 2026', 'BRSSA', 'container', 'Drop Off Fee', 'container', NULL, 'any', 150, 'BRL', 'base', 'container_distinct_voyage', 150, NULL, FALSE, TRUE, 40),
        ('Salvador CNTR 2026', 'BRSSA', 'container', 'Damage Protection Fee', 'container', NULL, 'any', 185, 'BRL', 'base', 'container_distinct_voyage', 185, NULL, FALSE, TRUE, 50),
        ('Salvador CNTR 2026', 'BRSSA', 'container', 'B/L Reissuing', 'bl', NULL, 'any', 600, 'BRL', 'other_charge', 'bl', 600, NULL, TRUE, TRUE, 60),
        ('Salvador CNTR 2026', 'BRSSA', 'container', 'Correction Letter', 'bl', NULL, 'any', 600, 'BRL', 'other_charge', 'bl', 600, NULL, TRUE, TRUE, 70),
        ('Salvador CNTR 2026', 'BRSSA', 'container', 'Late Correction Request', 'bl', NULL, 'any', 850, 'BRL', 'other_charge', 'bl', 850, NULL, TRUE, TRUE, 80),
        ('Salvador CNTR 2026', 'BRSSA', 'container', 'Booking Cancelation Fee', 'teu', NULL, 'any', 0, 'USD', 'other_charge', 'teu', 0, 150, TRUE, TRUE, 90),
        ('Vitoria BB 2026', 'BRVIX', 'carga_solta', 'THD', 'bl', NULL, 'any', 62.5, 'BRL', 'base', 'weight_ton', 62.5, NULL, FALSE, TRUE, 100),
        ('Vitoria BB 2026', 'BRVIX', 'carga_solta', 'BL Fee', 'bl', NULL, 'any', 600, 'BRL', 'base', 'bl', 600, NULL, FALSE, TRUE, 100)
    )
    INSERT INTO public.charge_table_items (
      charge_table_id, name, applies_to, container_type, cargo_profile, value_brl,
      currency, category, application_basis, unit_value_brl, unit_value_usd,
      manual_only, active, sort_order
    )
    SELECT ct.id, d.item_name, d.applies_to, d.container_type, d.cargo_profile,
      d.value_brl, d.currency, d.category, d.application_basis, d.unit_value_brl,
      d.unit_value_usd, d.manual_only, d.active, d.sort_order
    FROM desired d
    JOIN public.charge_tables ct
      ON ct.name = d.table_name AND ct.pod = d.table_pod
     AND ct.cargo_mode = d.table_mode AND ct.valid_from = DATE '2026-01-01';
  END IF;
END;
$charge_items_bootstrap$;

DO $demurrage_bootstrap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.demurrage_rates) THEN
    INSERT INTO public.demurrage_rates (
      container_type, free_days, p1_day_from, p1_day_to, p1_usd,
      p2_day_from, p2_usd, valid_from, valid_to, active, notes
    )
    VALUES
      ('40FR', 21, 22, 30, 100, 31, 140, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
      ('20RQ', 10, 11, 19, 95, 20, 110, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
      ('20GP', 21, 22, 30, 30, 31, 50, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
      ('20RF', 10, 11, 19, 95, 20, 110, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
      ('40RQ', 10, 11, 19, 190, 20, 220, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
      ('20OT', 21, 22, 30, 50, 31, 80, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
      ('40HC', 21, 22, 30, 60, 31, 80, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
      ('40GP', 21, 22, 30, 60, 31, 80, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
      ('40OT', 21, 22, 30, 100, 31, 140, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
      ('40RF', 10, 11, 19, 190, 20, 220, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
      ('20HC', 21, 22, 30, 30, 31, 50, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos'),
      ('20FR', 21, 22, 30, 50, 31, 80, DATE '2026-08-09', NULL, TRUE, 'Brasil — dias corridos');
  END IF;
END;
$demurrage_bootstrap$;

DO $depots_bootstrap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.depots) THEN
    INSERT INTO public.depots (code, name, active, tipo, free_time_vazio_days, free_time_material_days, port_id)
    SELECT d.code, d.name, d.active, d.tipo, d.free_time_vazio_days,
      d.free_time_material_days, p.id
    FROM (VALUES
      ('CAPIXABA TERMINAIS', 'CAPIXABA TERMINAIS', TRUE, 'depot', 60, 60, NULL),
      ('J&W', 'J&W', TRUE, 'depot', 25, 25, NULL),
      ('PENEDO', 'PENEDO', TRUE, 'terminal_portuario', 0, 0, 'BRVIX'),
      ('PONTUAL', 'PONTUAL', TRUE, 'depot', 21, 21, NULL),
      ('PORTMAC', 'PORTMAC', TRUE, 'terminal_portuario', 0, 0, 'BRVIX'),
      ('TCVV', 'TCVV', TRUE, 'depot', 60, 60, NULL),
      ('TECON SSA', 'TECON SSA', TRUE, 'terminal_portuario', 0, 0, 'BRSSA'),
      ('TVV', 'TVV', TRUE, 'terminal_portuario', 0, 0, 'BRVIX'),
      ('ZIRAN', 'ZIRAN', TRUE, 'depot', 30, 30, NULL)
    ) AS d(code, name, active, tipo, free_time_vazio_days, free_time_material_days, port_locode)
    LEFT JOIN public.ports p ON p.locode = d.port_locode;
  END IF;
END;
$depots_bootstrap$;

DO $depot_services_bootstrap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.depot_services) THEN
    WITH desired(depot_code, name, natureza, rate_brl, active, container_type, condition, route_destino_code) AS (
      VALUES
        ('CAPIXABA TERMINAIS', 'HANDLING IN FULL', 'geral', 207.4, TRUE, NULL, NULL, NULL),
        ('CAPIXABA TERMINAIS', 'TRANSPORTATION FLAT EM BUNDLE', 'transporte', 211.75, TRUE, NULL, NULL, 'TVV'),
        ('CAPIXABA TERMINAIS', 'BUNDLE WOODEN PROTECTION', 'geral', 400, TRUE, NULL, NULL, NULL),
        ('CAPIXABA TERMINAIS', 'VISUAL CHECK', 'geral', 91.5, TRUE, NULL, NULL, NULL),
        ('CAPIXABA TERMINAIS', 'BUNDLE REORGANIZATION', 'geral', 54.9, TRUE, NULL, NULL, NULL),
        ('CAPIXABA TERMINAIS', 'CNTR W/ MATERIAL REORGANIZATION ', 'geral', 701.5, TRUE, NULL, NULL, NULL),
        ('CAPIXABA TERMINAIS', 'HANDLING OUT EMPTY', 'geral', 67.1, TRUE, NULL, NULL, NULL),
        ('CAPIXABA TERMINAIS', 'TRANSPORTATION FR/20 PARCIAL', 'transporte', 423.5, TRUE, NULL, NULL, 'PORTMAC'),
        ('CAPIXABA TERMINAIS', 'HANDLING IN EMPTY', 'geral', 67.1, TRUE, NULL, NULL, NULL),
        ('CAPIXABA TERMINAIS', 'TRANSPORTATION FR/20 PARCIAL', 'transporte', 423.5, TRUE, NULL, NULL, 'TVV'),
        ('CAPIXABA TERMINAIS', 'TRANSPORTATION 40HC/40GP/2*20GP', 'transporte', 423.5, TRUE, NULL, NULL, 'TVV'),
        ('CAPIXABA TERMINAIS', 'HANDLING OUT FULL', 'geral', 207.4, TRUE, NULL, NULL, NULL),
        ('CAPIXABA TERMINAIS', 'ARMAZENAGEM FULL', 'armazenagem', 6.71, TRUE, NULL, NULL, NULL),
        ('CAPIXABA TERMINAIS', 'ARMAZENAGEM EMPTY', 'armazenagem', 2.81, TRUE, NULL, NULL, NULL),
        ('J&W', 'ARMAZENAGEM', 'armazenagem', 4, TRUE, NULL, 'vazio', NULL),
        ('J&W', 'OVERTIME HANDLING OUT 50%', 'geral', 45, TRUE, NULL, NULL, NULL),
        ('J&W', $$TRANSPORTE 1X40''$$, 'transporte', 732.6, TRUE, NULL, NULL, 'TECON SSA'),
        ('J&W', $$TRANSPORTE 1X20''$$, 'geral', 366.3, TRUE, NULL, NULL, NULL),
        ('J&W', 'HANDLING OUT', 'geral', 90, TRUE, NULL, NULL, NULL),
        ('J&W', $$TRANSPORTE 2X20''$$, 'transporte', 732.6, TRUE, NULL, NULL, 'TECON SSA'),
        ('J&W', 'HANDLING IN', 'geral', 90, TRUE, NULL, NULL, NULL),
        ('J&W', 'OVERTIME HANDLING OUT 80%', 'geral', 90, TRUE, NULL, NULL, NULL),
        ('PENEDO', 'TRANSPORTE PACIFICO', 'transporte', 353.1, TRUE, NULL, NULL, 'PORTMAC'),
        ('PONTUAL', 'HANDLING OUT', 'geral', 90, TRUE, NULL, NULL, NULL),
        ('PONTUAL', 'OVERTIME HANDLING OUT 50%', 'geral', 45, TRUE, NULL, NULL, NULL),
        ('PONTUAL', 'OVERTIME TRANSPORTE 50%', 'transporte', 366.3, TRUE, NULL, NULL, 'TECON SSA'),
        ('PONTUAL', $$TRANSPORTE 1X40''$$, 'transporte', 732.6, TRUE, NULL, NULL, 'TECON SSA'),
        ('PONTUAL', $$TRANSPORTE 1X20''$$, 'geral', 732.6, TRUE, NULL, NULL, NULL),
        ('PONTUAL', 'ARMAZENAGEM ', 'armazenagem', 4, TRUE, NULL, 'vazio', NULL),
        ('PONTUAL', $$TRANSPORTE 2X20''$$, 'transporte', 732.6, TRUE, NULL, NULL, 'TECON SSA'),
        ('PONTUAL', 'HANDLING IN', 'geral', 90, TRUE, NULL, NULL, NULL),
        ('PONTUAL', 'OVERTIME TRANSPORTE 100%', 'transporte', 732.6, TRUE, NULL, NULL, 'TECON SSA'),
        ('PONTUAL', 'OVERTIME HANDLING OUT 100%', 'geral', 90, TRUE, NULL, NULL, NULL),
        ('TCVV', $$TRANSPORTE 2X20''$$, 'transporte', 465.18, TRUE, NULL, NULL, 'TVV'),
        ('TCVV', 'HANDLING IN', 'geral', 72, TRUE, NULL, NULL, NULL),
        ('TCVV', $$TRANSPORTE 1X40''$$, 'transporte', 465.18, TRUE, NULL, NULL, 'TVV'),
        ('TCVV', 'HANDLING OUT', 'geral', 72, TRUE, NULL, NULL, NULL),
        ('TCVV', 'OVERTIME HANDLING OUT 50%', 'geral', 45, TRUE, NULL, NULL, NULL),
        ('TCVV', 'OVERTIME HANDLING OUT 100%', 'geral', 90, TRUE, NULL, NULL, NULL),
        ('TCVV', 'ARMAZENAGEM', 'armazenagem', 2.15, TRUE, NULL, NULL, NULL),
        ('ZIRAN', $$TRANSPORTE 2X20''$$, 'transporte', 890, TRUE, NULL, NULL, 'TECON SSA'),
        ('ZIRAN', $$TRANSPORTE 1X40''$$, 'transporte', 890, TRUE, NULL, NULL, 'TECON SSA'),
        ('ZIRAN', 'OVERTIME TRANSPORTE 50%', 'transporte', 445, TRUE, NULL, NULL, 'TECON SSA'),
        ('ZIRAN', $$ARMAZENAGEM 40''$$, 'armazenagem', 3.14, TRUE, NULL, 'vazio', NULL),
        ('ZIRAN', 'OVERTIME HANDLING OUT 100%', 'geral', 75.15, TRUE, NULL, NULL, NULL),
        ('ZIRAN', 'HANDLING OUT', 'geral', 75.15, TRUE, NULL, NULL, NULL),
        ('ZIRAN', $$ARMAZENAGEM 20''$$, 'armazenagem', 1.58, TRUE, NULL, 'vazio', NULL),
        ('ZIRAN', 'HANDLING IN', 'geral', 75.15, TRUE, NULL, NULL, NULL),
        ('ZIRAN', 'OVERTIME HANDLING OUT 50%', 'geral', 37.58, TRUE, NULL, NULL, NULL),
        ('ZIRAN', 'OVERTIME TRANSPORTE 100%', 'transporte', 890, TRUE, NULL, NULL, 'TECON SSA')
    )
    INSERT INTO public.depot_services (depot_id, name, natureza, rate_brl, active, container_type, condition, route_destino_id)
    SELECT d.id, s.name, s.natureza, s.rate_brl, s.active, s.container_type,
      s.condition, rd.id
    FROM desired s
    JOIN public.depots d ON d.code = s.depot_code
    LEFT JOIN public.depots rd ON rd.code = s.route_destino_code;
  END IF;
END;
$depot_services_bootstrap$;

-- ---------------------------------------------------------------------------
-- 6. Guarda RLS futura, com as duas camadas anti-recursao.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $func_rls_auto_enable$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE schema_name = 'public'
      AND object_type = 'table'
      AND command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  LOOP
    EXECUTE format('ALTER TABLE IF EXISTS %s ENABLE ROW LEVEL SECURITY', r.object_identity);
    RAISE LOG 'ensure_rls enabled RLS on %', r.object_identity;
  END LOOP;
END;
$func_rls_auto_enable$;

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

-- A migration in-place may already have a stale trigger. Recreating it is
-- transactional and makes the tag filter part of the persisted contract.
DROP EVENT TRIGGER IF EXISTS ensure_rls;
CREATE EVENT TRIGGER ensure_rls
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();

-- ---------------------------------------------------------------------------
-- 7. Falha explicita quando o alvo nao tem pre-requisitos operacionais.
-- ---------------------------------------------------------------------------

DO $required_prerequisites$
BEGIN
  IF to_regproc('net.http_post') IS NULL THEN
    RAISE EXCEPTION '006: pg_net/net.http_post ausente; jobs HTTP nao podem operar.';
  END IF;
  IF to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION '006: pg_cron/cron.job ausente; jobs nao podem operar.';
  END IF;
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION '006: Storage/storage.buckets ausente; anexos nao podem operar.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'demurrage-disputes')
     OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'customer-communications') THEN
    RAISE EXCEPTION '006: buckets de Storage obrigatorios ausentes.';
  END IF;
END;
$required_prerequisites$;
