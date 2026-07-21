-- Agency Departure Report: mensagens legíveis nos alertas de pendência pós-ATD.
-- Intent: a mensagem direciona o departamento dono (ADR 0027); chave crua de
-- seção e papel em código minavam a leitura. Reescreve a geração e faz
-- backfill dos alertas ainda não fechados. entity_id permanece máquina
-- (voyageId::porto::secao) — é contrato de dedupe/fechamento e de deep-link.
-- Rollback: reaplicar a definição de detect_agency_report_pending() da
-- migration 214 e DROP das duas funções de label.

CREATE OR REPLACE FUNCTION public.agency_report_section_label(p_section TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_section
    WHEN 'datas' THEN 'Datas'
    WHEN 'carga_descarregada' THEN 'Carga descarregada'
    WHEN 'carga_carregada' THEN 'Carga carregada'
    WHEN 'veiculos' THEN 'Veículos'
    WHEN 'vazios_embarcados' THEN 'Vazios embarcados'
    WHEN 'vazios_descarregados' THEN 'Vazios descarregados'
    WHEN 'ocorrencias' THEN 'Ocorrências'
    ELSE p_section
  END;
$$;

CREATE OR REPLACE FUNCTION public.agency_report_department_label(p_department TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_department
    WHEN 'operacoes' THEN 'Operações'
    WHEN 'documentacao' THEN 'Documentação'
    WHEN 'equipamentos' THEN 'Equipamentos'
    ELSE COALESCE(p_department, '—')
  END;
$$;

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
    SELECT DISTINCT ON (entity_id) entity_id, new_value, changed_at
    FROM public.audit_logs
    WHERE entity_type = 'voyage_pod_schedule' AND field_name = 'atd'
    ORDER BY entity_id, changed_at DESC
  ),
  departed AS (
    SELECT
      split_part(entity_id, '::', 1)::BIGINT AS voyage_id,
      upper(trim(split_part(entity_id, '::', 2))) AS port
    FROM latest_atd
    WHERE COALESCE(trim(new_value), '') <> ''
      -- Evita criar pendências retroativas na primeira detecção após o deploy.
      AND changed_at >= TIMESTAMPTZ '2026-07-19 00:00:00+00'
  ),
  sections AS (
    SELECT unnest(ARRAY[
      'datas', 'carga_descarregada', 'carga_carregada', 'veiculos',
      'vazios_embarcados', 'vazios_descarregados', 'ocorrencias'
    ]) AS section
  ),
  pending AS (
    SELECT d.voyage_id, d.port, s.section
    FROM departed d
    CROSS JOIN sections s
    LEFT JOIN public.agency_departure_reports r
      ON r.voyage_id = d.voyage_id AND r.port = d.port
    LEFT JOIN public.agency_departure_report_signoffs so
      ON so.report_id = r.id AND so.section = s.section
    WHERE COALESCE(r.status, 'open') = 'open'
      AND COALESCE(so.state, 'pending') = 'pending'
  ),
  inserted AS (
    INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
    SELECT
      'agency_report_section_pending',
      'agency_departure_report',
      p.voyage_id || '::' || p.port || '::' || p.section,
      'ADR ' || p.port || ': seção "' || public.agency_report_section_label(p.section)
        || '" pendente — '
        || public.agency_report_department_label(public.agency_report_section_owner(p.section)) || '.',
      'open'
    FROM pending p
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.alerts a
      WHERE a.type = 'agency_report_section_pending'
        AND a.entity_type = 'agency_departure_report'
        AND a.entity_id = p.voyage_id || '::' || p.port || '::' || p.section
        AND a.status <> 'closed'
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.agency_report_section_label(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agency_report_department_label(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_report_section_label(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agency_report_department_label(TEXT) TO authenticated;

-- Backfill: reescreve a mensagem dos alertas ainda não fechados a partir do
-- entity_id (voyageId::porto::secao). Alertas fechados são histórico.
UPDATE public.alerts
SET message = 'ADR ' || split_part(entity_id, '::', 2) || ': seção "'
  || public.agency_report_section_label(split_part(entity_id, '::', 3))
  || '" pendente — '
  || public.agency_report_department_label(public.agency_report_section_owner(split_part(entity_id, '::', 3)))
  || '.'
WHERE type = 'agency_report_section_pending'
  AND entity_type = 'agency_departure_report'
  AND status <> 'closed';
