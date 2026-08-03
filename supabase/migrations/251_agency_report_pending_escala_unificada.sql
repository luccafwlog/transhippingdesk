-- Agency Departure Report: alerta pos-ATD enxerga escala unificada.
-- Intent: detectar pendencias departamentais de ADR quando a escala brasileira
-- ja tem ATD no portador operacional POD ou no registro documental POL.
-- Afetadas: detect_agency_report_pending.
-- Consumidores: src/services/alerts.ts.
-- Rollback: reaplicar a definicao de detect_agency_report_pending da migration
--           228_agency_report_section_observation.sql e remover a tabela
--           public.agency_report_pending_baselines.

-- Server-only, one-shot capture of the migration application moment. The
-- function below uses this only for the newly covered POL ATD source.
CREATE TABLE public.agency_report_pending_baselines (
  baseline_key TEXT PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE public.agency_report_pending_baselines IS
  'Baselines internos de deteccao de pendencias do ADR, capturados na aplicacao da migration.';

REVOKE ALL ON TABLE public.agency_report_pending_baselines FROM PUBLIC, anon, authenticated;
ALTER TABLE public.agency_report_pending_baselines ENABLE ROW LEVEL SECURITY;

INSERT INTO public.agency_report_pending_baselines (baseline_key, captured_at)
VALUES ('voyage_pol_schedule_atd', clock_timestamp());

CREATE OR REPLACE FUNCTION public.detect_agency_report_pending()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_inserted INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;

  WITH latest_atd AS (
    SELECT DISTINCT ON (entity_type, entity_id) entity_type, entity_id, new_value, changed_at
    FROM public.audit_logs
    WHERE entity_type IN ('voyage_pod_schedule', 'voyage_pol_schedule')
      AND field_name = 'atd'
    ORDER BY entity_type, entity_id, changed_at DESC
  ),
  departed AS (
    SELECT DISTINCT
      split_part(entity_id, '::', 1)::BIGINT AS voyage_id,
      upper(trim(split_part(entity_id, '::', 2))) AS port
    FROM latest_atd
    WHERE COALESCE(trim(new_value), '') <> ''
      AND upper(trim(split_part(entity_id, '::', 2))) LIKE 'BR%'
      AND (
        (
          entity_type = 'voyage_pod_schedule'
          -- Corte original da migration 214: POD ja era alcancado pelo alerta.
          AND changed_at >= TIMESTAMPTZ '2026-07-19 00:00:00+00'
        )
        OR (
          entity_type = 'voyage_pol_schedule'
          -- Corte capturado na aplicacao da 251: POL nao e retroativo.
          AND changed_at >= (
            SELECT captured_at
            FROM public.agency_report_pending_baselines
            WHERE baseline_key = 'voyage_pol_schedule_atd'
          )
        )
      )
  ),
  departments AS (
    SELECT unnest(ARRAY['operacoes', 'documentacao', 'equipamentos']) AS department
  ),
  pending AS (
    SELECT d.voyage_id, d.port, dep.department
    FROM departed d
    CROSS JOIN departments dep
    LEFT JOIN public.agency_departure_reports r
      ON r.voyage_id = d.voyage_id AND r.port = d.port
    WHERE COALESCE(r.status, 'open') = 'open'
      AND EXISTS (
        SELECT 1 FROM (VALUES
          ('datas'), ('carga_descarregada'), ('carga_carregada'), ('veiculos'),
          ('vazios_embarcados'), ('vazios_descarregados'), ('operacao_patio')
        ) AS all_sections(section)
        LEFT JOIN public.agency_departure_report_signoffs so
          ON so.report_id = r.id AND so.section = all_sections.section
        WHERE public.agency_report_section_owner(all_sections.section) = dep.department
          AND COALESCE(so.state, 'pending') = 'pending'
      )
  ),
  inserted AS (
    INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
    SELECT
      'agency_report_department_pending',
      'agency_departure_report',
      p.voyage_id || '::' || p.port || '::' || p.department,
      'ADR ' || p.port || ': departamento "' || p.department || '" pendente.',
      'open'
    FROM pending p
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.alerts a
      WHERE a.type = 'agency_report_department_pending'
        AND a.entity_type = 'agency_departure_report'
        AND a.entity_id = p.voyage_id || '::' || p.port || '::' || p.department
        AND a.status <> 'closed'
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.detect_agency_report_pending() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_agency_report_pending() TO authenticated;
