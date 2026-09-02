-- Agency Departure Report: alerta de vencimento do Prazo de Conclusao do ADR
-- por departamento (ADR 0039).
-- Intent: o alerta pos-ATD existente (migrations 214/225/251,
-- detect_agency_report_pending) diz que ha pendencia, mas nao conhece
-- data-limite. Esta migration adiciona um segundo alerta, independente,
-- que dispara quando o Prazo de Conclusao do ADR (ATD da escala unificada +
-- 3 dias uteis, dia do ATD nunca conta) vence sem que o departamento tenha
-- assinado (assinatura vigente de
-- agency_departure_report_department_signoffs.signed_at). Os dois alertas
-- convivem: dizem coisas diferentes e nenhum substitui o outro.
-- Afetadas: nova funcao agency_report_deadline_date (dia util em SQL,
-- espelha calculateAgencyReportDeadlineDate de
-- src/services/agencyReportDeadline.ts); nova funcao
-- detect_agency_report_deadline_missed; nova linha de vigencia em
-- agency_report_pending_baselines (tabela ja existe, migration 251); e
-- close_agency_departure_report, que passa a fechar tambem os alertas de
-- vencimento no Fechamento do ADR, do mesmo jeito que ja fecha os alertas de
-- pendencia legados por secao.
-- Consumidores: src/services/alerts.ts (detectAgencyReportDeadlineMissed),
-- src/pages/Alertas.tsx.
-- Rollback: DROP FUNCTION public.detect_agency_report_deadline_missed(),
--           DROP FUNCTION public.agency_report_deadline_date(DATE), reaplicar
--           close_agency_departure_report da migration 256, e apagar a linha
--           'agency_report_deadline_missed' de agency_report_pending_baselines.

-- 1) Vigencia do compromisso: escalas com ATD anterior a este instante nunca
--    sao medidas (mesmo mecanismo de baseline das migrations 214/251, mas
--    aqui comparado contra a data do ATD, nao contra o changed_at do
--    audit_log — e o ATD, nao o registro do ATD, que e o T0 do prazo).
INSERT INTO public.agency_report_pending_baselines (baseline_key, captured_at)
VALUES ('agency_report_deadline_missed', clock_timestamp())
ON CONFLICT (baseline_key) DO NOTHING;

-- 2) Dia util em SQL: espelha calculateAgencyReportDeadlineDate (TypeScript,
--    Task 1). Segunda a sexta contam, sabado e domingo nao, feriados contam
--    como dia util (sem calendario de feriados — ADR 0039), e o dia do ATD
--    nunca conta (o loop sempre avanca antes de contar).
CREATE OR REPLACE FUNCTION public.agency_report_deadline_date(p_atd DATE)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_cursor DATE;
  v_business_days_added INTEGER := 0;
BEGIN
  IF p_atd IS NULL THEN
    RETURN NULL;
  END IF;

  v_cursor := p_atd;
  WHILE v_business_days_added < 3 LOOP
    v_cursor := v_cursor + 1;
    -- ISODOW: 1=segunda .. 5=sexta, 6=sabado, 7=domingo.
    IF EXTRACT(ISODOW FROM v_cursor) < 6 THEN
      v_business_days_added := v_business_days_added + 1;
    END IF;
  END LOOP;

  RETURN v_cursor;
END;
$function$;

REVOKE ALL ON FUNCTION public.agency_report_deadline_date(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_report_deadline_date(DATE) TO authenticated;

-- 3) Deteccao do alerta de vencimento. Mesma fonte de escala unificada da
--    251/253 (POD canonico, POL preenche so o que falta), mesmas 3 secoes
--    por departamento so que aqui olhando o sign-off departamental (nao a
--    secao), e exclusao de escalas omitidas (field_name = 'omitted' em
--    voyage_pod_schedule; POL nunca carrega omitted) e de ATD anterior a
--    vigencia capturada acima.
CREATE OR REPLACE FUNCTION public.detect_agency_report_deadline_missed()
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
  latest_omitted AS (
    SELECT DISTINCT ON (entity_id) entity_id, new_value
    FROM public.audit_logs
    WHERE entity_type = 'voyage_pod_schedule'
      AND field_name = 'omitted'
    ORDER BY entity_id, changed_at DESC
  ),
  pod_atd AS (
    SELECT
      entity_id,
      split_part(entity_id, '::', 1)::BIGINT AS voyage_id,
      upper(trim(split_part(entity_id, '::', 2))) AS port,
      NULLIF(trim(new_value), '')::DATE AS atd
    FROM latest_atd
    WHERE entity_type = 'voyage_pod_schedule'
      AND COALESCE(trim(new_value), '') <> ''
  ),
  pol_atd AS (
    SELECT
      split_part(entity_id, '::', 1)::BIGINT AS voyage_id,
      upper(trim(split_part(entity_id, '::', 2))) AS port,
      NULLIF(trim(new_value), '')::DATE AS atd
    FROM latest_atd
    WHERE entity_type = 'voyage_pol_schedule'
      AND COALESCE(trim(new_value), '') <> ''
  ),
  escalas AS (
    -- Toda escala brasileira com ATD conhecido em ao menos um dos dois
    -- portadores (mesmo universo de detect_agency_report_pending).
    SELECT voyage_id, port FROM pod_atd
    UNION
    SELECT voyage_id, port FROM pol_atd
  ),
  unified AS (
    SELECT
      e.voyage_id,
      e.port,
      -- POD e canonico; POL so preenche o que o POD deixou vazio (mergeEscalaField).
      COALESCE(p.atd, l.atd) AS atd,
      -- Casa pelo entity_id reconstruido (voyage_id::port), nao por
      -- p.entity_id: quando o ATD unificado vem so do POL (POD nunca
      -- registrou atd), p e NULL e p.entity_id nunca bateria com o
      -- omitted gravado no lado POD, deixando a escala omitida escapar
      -- da exclusao.
      EXISTS (
        SELECT 1 FROM latest_omitted o
        WHERE o.entity_id = e.voyage_id || '::' || e.port AND o.new_value = 'true'
      ) AS omitted
    FROM escalas e
    LEFT JOIN pod_atd p ON p.voyage_id = e.voyage_id AND p.port = e.port
    LEFT JOIN pol_atd l ON l.voyage_id = e.voyage_id AND l.port = e.port
    WHERE e.port LIKE 'BR%'
  ),
  measured AS (
    -- Sem ATD nao ha prazo; escala omitida fica fora da medicao em
    -- definitivo; ATD anterior a vigencia nao retroage.
    SELECT
      voyage_id,
      port,
      public.agency_report_deadline_date(atd) AS deadline_date
    FROM unified
    WHERE atd IS NOT NULL
      AND NOT omitted
      AND atd >= (
        SELECT captured_at::DATE
        FROM public.agency_report_pending_baselines
        WHERE baseline_key = 'agency_report_deadline_missed'
      )
  ),
  departments AS (
    SELECT unnest(ARRAY['operacoes', 'documentacao', 'equipamentos']) AS department
  ),
  missed AS (
    SELECT m.voyage_id, m.port, dep.department
    FROM measured m
    CROSS JOIN departments dep
    LEFT JOIN public.agency_departure_reports r
      ON r.voyage_id = m.voyage_id AND r.port = m.port
    LEFT JOIN public.agency_departure_report_department_signoffs ds
      ON ds.report_id = r.id AND ds.department = dep.department
    WHERE m.deadline_date < CURRENT_DATE
      AND ds.signed_at IS NULL
  ),
  inserted AS (
    INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
    SELECT
      'agency_report_deadline_missed',
      'agency_departure_report',
      x.voyage_id || '::' || x.port || '::' || x.department,
      'ADR ' || x.port || ': prazo de conclusao vencido para "' || public.agency_report_department_label(x.department) || '".',
      'open'
    FROM missed x
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.alerts a
      WHERE a.type = 'agency_report_deadline_missed'
        AND a.entity_type = 'agency_departure_report'
        AND a.entity_id = x.voyage_id || '::' || x.port || '::' || x.department
        AND a.status <> 'closed'
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.detect_agency_report_deadline_missed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_agency_report_deadline_missed() TO authenticated;

-- 4) Fechamento do ADR fecha os alertas de vencimento junto com o Fechamento,
--    do mesmo jeito que ja fecha (por prefixo de entity_id) os alertas
--    legados de pendencia por secao. Reaplica a definicao vigente da
--    migration 256 (a mais recente de close_agency_departure_report),
--    adicionando so o novo UPDATE.
CREATE OR REPLACE FUNCTION public.close_agency_departure_report(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_snapshot JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report_id UUID;
  v_signed_departments INTEGER;
  v_unknown_sections TEXT[];
  v_unknown_top_level TEXT[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object'
     OR jsonb_typeof(p_snapshot->'header') <> 'object'
     OR jsonb_typeof(p_snapshot->'sections') <> 'object'
     OR jsonb_typeof(p_snapshot->'occurrences') <> 'array'
     OR jsonb_typeof(p_snapshot->'signoffs') <> 'array'
     OR octet_length(p_snapshot::text) > 8388608 THEN
    RAISE EXCEPTION 'Snapshot invalido: esperado objeto com header, sections, occurrences e signoffs (maximo 8 MiB).' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(key ORDER BY key) INTO v_unknown_top_level
  FROM jsonb_object_keys(p_snapshot) AS key
  WHERE key NOT IN ('header', 'sections', 'occurrences', 'signoffs', 'departmentSignoffs');
  IF v_unknown_top_level IS NOT NULL THEN
    RAISE EXCEPTION 'Snapshot possui chaves de topo desconhecidas: %.', array_to_string(v_unknown_top_level, ', ')
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(key ORDER BY key) INTO v_unknown_sections
  FROM jsonb_object_keys(p_snapshot->'sections') AS key
  WHERE key NOT IN (
    'cargaDescarregada', 'cargaSolta', 'vaziosDescarregados', 'veiculos',
    'vaziosEmbarcados', 'vaziosUnidades', 'vehicleLocations', 'vehicleBreakdown',
    'depots', 'directEmbarkCount', 'granito', 'storage', 'operation', 'costs'
  );
  IF v_unknown_sections IS NOT NULL THEN
    RAISE EXCEPTION 'Snapshot possui secoes desconhecidas: %.', array_to_string(v_unknown_sections, ', ')
      USING ERRCODE = '22023';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);
  SELECT id INTO v_report_id
  FROM public.agency_departure_reports
  WHERE id = v_report_id
  FOR UPDATE;

  SELECT COUNT(*) INTO v_signed_departments
  FROM public.agency_departure_report_department_signoffs
  WHERE report_id = v_report_id AND signed_at IS NOT NULL;
  IF v_signed_departments <> 3 THEN
    RAISE EXCEPTION 'Fechamento exige os 3 departamentos assinados (% pendentes).', 3 - v_signed_departments
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.agency_departure_reports
  SET status = 'closed', closed_at = now(), closed_by = auth.uid(), closed_snapshot = p_snapshot
  WHERE id = v_report_id AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADR ja fechado.' USING ERRCODE = '23505';
  END IF;

  -- 'agency_report_section_pending' e obsoleto (migration 225 introduz
  -- 'agency_report_department_pending', ja fechado por departamento no
  -- signoff); mantido aqui so para alertas legados pre-0029.
  UPDATE public.alerts
  SET status = 'closed', closed_at = now()
  WHERE type = 'agency_report_section_pending'
    AND entity_type = 'agency_departure_report'
    AND entity_id LIKE p_voyage_id || '::' || upper(btrim(p_port)) || '::%'
    AND status <> 'closed';

  -- ADR 0039: fecha os alertas de vencimento do prazo junto com o Fechamento.
  -- Chegar aqui exige os 3 departamentos assinados, entao todo alerta de
  -- vencimento desta escala ja deveria estar sem motivo; este UPDATE e uma
  -- rede de seguranca (ex.: alerta detectado entre o ultimo sign-off e o
  -- clique de Fechar).
  UPDATE public.alerts
  SET status = 'closed', closed_at = now()
  WHERE type = 'agency_report_deadline_missed'
    AND entity_type = 'agency_departure_report'
    AND entity_id LIKE p_voyage_id || '::' || upper(btrim(p_port)) || '::%'
    AND status <> 'closed';

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;
