\set ON_ERROR_STOP on

-- Execute com psql -f depois do replay completo em PostgreSQL descartavel
-- (scripts/setup-local-pg.sh --reset). Cobre o Prazo de Conclusao do ADR
-- (ADR 0039, Task 3): calculo de dia util em SQL, deteccao por departamento,
-- exclusao de escala omitida e de ATD anterior a vigencia, e fechamento do
-- alerta junto com o Fechamento do ADR.

BEGIN;

INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-4000-8000-000000000261', 'rbac-adr-prazo@example.invalid')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profiles (id, full_name, role, active)
VALUES ('00000000-0000-4000-8000-000000000261', 'Teste ADR Prazo', 'administrativo', true)
ON CONFLICT (id) DO UPDATE
SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, active = EXCLUDED.active;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000261', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

-- 1) Dia util em SQL espelha calculateAgencyReportDeadlineDate (TS, Task 1):
--    ATD de segunda vence na quinta; de sexta e de sabado vencem na quarta
--    seguinte (fim de semana nunca conta).
DO $deadline_date$
BEGIN
  IF public.agency_report_deadline_date(DATE '2026-08-03') <> DATE '2026-08-06' THEN
    RAISE EXCEPTION 'ATD de segunda deveria vencer na quinta.';
  END IF;
  IF public.agency_report_deadline_date(DATE '2026-08-07') <> DATE '2026-08-12' THEN
    RAISE EXCEPTION 'ATD de sexta deveria vencer na quarta seguinte.';
  END IF;
  IF public.agency_report_deadline_date(DATE '2026-08-08') <> DATE '2026-08-12' THEN
    RAISE EXCEPTION 'ATD de sabado deveria vencer na quarta seguinte.';
  END IF;
  IF public.agency_report_deadline_date(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'ATD nulo deveria produzir vencimento nulo.';
  END IF;
END;
$deadline_date$;

RESET ROLE;

-- Vigencia empurrada para o passado, para que os cenarios abaixo (ATD em
-- 2026-08-01, ja vencido frente ao "hoje" real da migration) sejam medidos.
UPDATE public.agency_report_pending_baselines
SET captured_at = TIMESTAMPTZ '2026-01-01 00:00:00+00'
WHERE baseline_key = 'agency_report_deadline_missed';

INSERT INTO public.carriers (id, name) OVERRIDING SYSTEM VALUE
VALUES (900261, 'Armador Teste ADR Prazo')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.vessels (id, name, carrier_id) OVERRIDING SYSTEM VALUE
VALUES (900261, 'Navio Teste ADR Prazo', 900261)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.voyages (id, vessel_id, voyage_number) OVERRIDING SYSTEM VALUE
VALUES (900261, 900261, 'ADRPRAZO001')
ON CONFLICT (id) DO NOTHING;

-- Escala medida: ATD de sabado 2026-08-01, vencimento quarta 2026-08-05,
-- ja no passado frente a qualquer "hoje" real ao rodar este teste.
INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at)
VALUES ('voyage_pod_schedule', '900261::BRSSZ', 'atd', NULL, '2026-08-01', '00000000-0000-4000-8000-000000000261', now());

-- Escala omitida com ATD igualmente vencido: nunca deve alertar (fora da
-- medicao em definitivo).
INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at)
VALUES
  ('voyage_pod_schedule', '900261::BROMT', 'atd', NULL, '2026-08-01', '00000000-0000-4000-8000-000000000261', now()),
  ('voyage_pod_schedule', '900261::BROMT', 'omitted', 'false', 'true', '00000000-0000-4000-8000-000000000261', now());

-- Escala com ATD anterior a vigencia (baseline fixada em 2026-01-01 acima):
-- o compromisso nao retroage.
INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at)
VALUES ('voyage_pod_schedule', '900261::BRRET', 'atd', NULL, '2025-12-01', '00000000-0000-4000-8000-000000000261', now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000261', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $detect$
DECLARE
  v_inserted INTEGER;
  v_inserted_again INTEGER;
  v_open_count INTEGER;
BEGIN
  v_inserted := public.detect_agency_report_deadline_missed();
  IF v_inserted <> 3 THEN
    RAISE EXCEPTION 'Esperava 3 alertas (um por departamento) para a escala vencida, veio %.', v_inserted;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.alerts
    WHERE type = 'agency_report_deadline_missed' AND entity_id LIKE '900261::BROMT::%'
  ) THEN
    RAISE EXCEPTION 'Escala omitida gerou alerta de vencimento.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.alerts
    WHERE type = 'agency_report_deadline_missed' AND entity_id LIKE '900261::BRRET::%'
  ) THEN
    RAISE EXCEPTION 'ATD anterior a vigencia gerou alerta de vencimento (compromisso retroagiu).';
  END IF;

  -- Dedupe: reexecutar nao duplica.
  v_inserted_again := public.detect_agency_report_deadline_missed();
  IF v_inserted_again <> 0 THEN
    RAISE EXCEPTION 'Deteccao nao e idempotente: reexecucao inseriu % alertas.', v_inserted_again;
  END IF;

  SELECT COUNT(*) INTO v_open_count FROM public.alerts
  WHERE type = 'agency_report_deadline_missed' AND entity_id LIKE '900261::BRSSZ::%' AND status <> 'closed';
  IF v_open_count <> 3 THEN
    RAISE EXCEPTION 'Esperava 3 alertas abertos para BRSSZ, veio %.', v_open_count;
  END IF;
END;
$detect$;

-- Fechamento do ADR fecha os alertas de vencimento (rede de seguranca),
-- do mesmo jeito que ja fecha o alerta legado de pendencia por secao.
DO $close$
DECLARE
  v_report_id UUID;
  v_open_after_close INTEGER;
BEGIN
  v_report_id := public.ensure_agency_departure_report(900261, 'BRSSZ');

  -- Assinar um departamento exige as suas secoes resolvidas primeiro
  -- (migration 223).
  PERFORM public.set_agency_report_signoff(900261, 'BRSSZ', 'datas', 'nothing_to_declare');
  PERFORM public.set_agency_report_signoff(900261, 'BRSSZ', 'carga_descarregada', 'nothing_to_declare');
  PERFORM public.set_agency_report_signoff(900261, 'BRSSZ', 'carga_carregada', 'nothing_to_declare');
  PERFORM public.set_agency_report_signoff(900261, 'BRSSZ', 'veiculos', 'nothing_to_declare');
  PERFORM public.set_agency_report_signoff(900261, 'BRSSZ', 'vazios_embarcados', 'nothing_to_declare');
  PERFORM public.set_agency_report_signoff(900261, 'BRSSZ', 'vazios_descarregados', 'nothing_to_declare');

  -- Assina pelo RPC real (nao insert direto): a tabela nao concede INSERT a
  -- authenticated (RLS), so o SECURITY DEFINER escreve. O usuario de teste
  -- tem role 'administrativo', autorizado para os 3 departamentos.
  PERFORM public.set_agency_report_department_signoff(900261, 'BRSSZ', 'operacoes', true, NULL);
  PERFORM public.set_agency_report_department_signoff(900261, 'BRSSZ', 'documentacao', true, NULL);
  PERFORM public.set_agency_report_department_signoff(900261, 'BRSSZ', 'equipamentos', true, NULL);

  PERFORM public.close_agency_departure_report(
    900261, 'BRSSZ',
    '{"header":{},"sections":{},"occurrences":[],"signoffs":[]}'::jsonb
  );

  SELECT COUNT(*) INTO v_open_after_close FROM public.alerts
  WHERE type = 'agency_report_deadline_missed' AND entity_id LIKE '900261::BRSSZ::%' AND status <> 'closed';
  IF v_open_after_close <> 0 THEN
    RAISE EXCEPTION 'Fechamento do ADR nao fechou os alertas de vencimento (% ainda abertos).', v_open_after_close;
  END IF;
END;
$close$;

RESET ROLE;

ROLLBACK;

SELECT 'ADR Prazo de Conclusao (deadline_missed) runtime OK' AS result;
