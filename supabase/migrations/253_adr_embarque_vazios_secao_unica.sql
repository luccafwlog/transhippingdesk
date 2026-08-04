-- Agency Departure Report: "operacao_patio" volta a ser parte do Embarque de
-- Vazios, e "datas" passa a se chamar "Escala".
-- Intent: o CONTEXT.md define Embarque de Vazios (EXP) como UM agregado por
-- escala com duas partes (Lista de Unidades Embarcadas e Linhas de Servico do
-- Embarque). A migration 222 quebrou esse agregado em duas secoes assinaveis
-- independentes, exigindo de Equipamentos duas resolucoes para um fato so.
-- Aqui as duas voltam a ser uma secao ('vazios_embarcados', rotulada "Embarque
-- de vazios"), com as duas partes exibidas como subsecoes de conteudo. No mesmo
-- passo, 'datas' ganha o rotulo "Escala": a secao carrega a identidade do ADR
-- (armador, navio/viagem, porto, terminal) alem das datas confirmadas.
-- ADR 0036; supersede o recorte da 222 e ajusta as ADRs 0029/0030/0033.
-- Afetadas: agency_departure_report_signoffs (CHECK + backfill de secao),
-- agency_report_section_owner, agency_report_section_label,
-- set_agency_report_department_signoff, detect_agency_report_pending.
-- Consumidores: src/services/agencyDepartureReport.ts (AgencyReportSection),
-- VoyageAgencyReportTab.tsx, AgencyReportDocument.tsx.
-- BREAKING para quem persistiu 'operacao_patio': as linhas sao migradas para
-- 'vazios_embarcados' (regra de fusao abaixo), nao descartadas. audit_logs e
-- snapshots ja fechados NAO sao reescritos — sao registro historico, e o
-- rotulo de 'operacao_patio' segue resolvendo para leitura desses registros.
-- Rollback: reaplicar a 222 (CHECK de 8 secoes + owner com 'operacao_patio'),
--           os rotulos da 219 e as listas de 7 secoes da 228/251. A fusao de
--           sign-offs nao e reversivel por SQL — a parte de patio volta a
--           'pending' ate ser reassinada.

-- 1) Fusao das resolucoes: 'operacao_patio' -> 'vazios_embarcados'.
--    Quando so existe a linha de patio, ela e reetiquetada. Quando as duas
--    existem, vence o estado mais conservador (qualquer 'pending' mantem a
--    secao pendente; entre duas resolvidas, 'confirmed' vence
--    'nothing_to_declare' porque algo foi de fato declarado), a atribuicao e a
--    mais recente, e as observacoes sao concatenadas para nao perder texto
--    escrito por Equipamentos.
WITH patio AS (
  SELECT * FROM public.agency_departure_report_signoffs WHERE section = 'operacao_patio'
),
merged AS (
  SELECT
    p.report_id,
    CASE
      WHEN v.state IS NULL THEN p.state
      WHEN p.state = 'pending' OR v.state = 'pending' THEN 'pending'
      WHEN p.state = 'confirmed' OR v.state = 'confirmed' THEN 'confirmed'
      ELSE 'nothing_to_declare'
    END AS state,
    CASE
      WHEN COALESCE(p.signed_at, '-infinity'::TIMESTAMPTZ) >= COALESCE(v.signed_at, '-infinity'::TIMESTAMPTZ)
      THEN p.signed_by ELSE v.signed_by
    END AS signed_by,
    GREATEST(p.signed_at, v.signed_at) AS signed_at,
    NULLIF(btrim(concat_ws(
      E'\n',
      NULLIF(btrim(v.observation), ''),
      NULLIF(btrim(p.observation), '')
    )), '') AS observation
  FROM patio p
  LEFT JOIN public.agency_departure_report_signoffs v
    ON v.report_id = p.report_id AND v.section = 'vazios_embarcados'
)
INSERT INTO public.agency_departure_report_signoffs
  (report_id, section, state, department, signed_by, signed_at, observation)
SELECT report_id, 'vazios_embarcados', state, 'equipamentos', signed_by, signed_at, observation
FROM merged
ON CONFLICT (report_id, section) DO UPDATE SET
  state = EXCLUDED.state,
  signed_by = EXCLUDED.signed_by,
  signed_at = EXCLUDED.signed_at,
  observation = EXCLUDED.observation;

DELETE FROM public.agency_departure_report_signoffs WHERE section = 'operacao_patio';

-- 2) CHECK volta as 6 secoes vivas (sem 'ocorrencias', removida pela 228).
ALTER TABLE public.agency_departure_report_signoffs
  DROP CONSTRAINT IF EXISTS agency_departure_report_signoffs_section_check;
ALTER TABLE public.agency_departure_report_signoffs
  ADD CONSTRAINT agency_departure_report_signoffs_section_check CHECK (section IN (
    'datas', 'carga_descarregada', 'carga_carregada', 'veiculos',
    'vazios_embarcados', 'vazios_descarregados'
  ));

-- 3) Dono da secao sem 'operacao_patio': set_agency_report_signoff e
--    set_agency_report_section_observation passam a recusar a chave morta
--    (owner NULL), fechando a porta para um cliente desatualizado.
CREATE OR REPLACE FUNCTION public.agency_report_section_owner(p_section TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_section
    WHEN 'datas' THEN 'operacoes'
    WHEN 'veiculos' THEN 'equipamentos'
    WHEN 'vazios_embarcados' THEN 'equipamentos'
    WHEN 'carga_descarregada' THEN 'documentacao'
    WHEN 'carga_carregada' THEN 'documentacao'
    WHEN 'vazios_descarregados' THEN 'documentacao'
    ELSE NULL
  END;
$$;

-- 4) Rotulos pt-BR. 'operacao_patio' e 'ocorrencias' continuam resolvendo:
--    audit_logs e alertas fechados guardam essas chaves e precisam seguir
--    legiveis (registro historico preservado).
CREATE OR REPLACE FUNCTION public.agency_report_section_label(p_section TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_section
    WHEN 'datas' THEN 'Escala'
    WHEN 'carga_descarregada' THEN 'Carga descarregada'
    WHEN 'carga_carregada' THEN 'Carga carregada'
    WHEN 'veiculos' THEN 'Veículos'
    WHEN 'vazios_embarcados' THEN 'Embarque de vazios'
    WHEN 'vazios_descarregados' THEN 'Vazios descarregados'
    WHEN 'operacao_patio' THEN 'Operação de pátio'
    WHEN 'ocorrencias' THEN 'Ocorrências'
    ELSE p_section
  END;
$$;

-- 5) Lista de secoes exigidas para assinar um departamento (migration 228),
--    agora com 6 entradas.
CREATE OR REPLACE FUNCTION public.set_agency_report_department_signoff(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_department TEXT,
  p_signed BOOLEAN,
  p_justification TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report_id UUID;
  v_currently_signed BOOLEAN;
  v_justification TEXT := NULLIF(btrim(p_justification), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;

  IF p_department NOT IN ('operacoes', 'documentacao', 'equipamentos') THEN
    RAISE EXCEPTION 'Departamento invalido: %.', p_department USING ERRCODE = '22023';
  END IF;

  IF NOT (public.is_admin() OR public.current_user_role() = p_department) THEN
    RAISE EXCEPTION 'Somente % ou admin assina este bloco.', p_department USING ERRCODE = '42501';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);

  IF EXISTS (
    SELECT 1 FROM public.agency_departure_reports
    WHERE id = v_report_id AND status = 'closed'
  ) THEN
    RAISE EXCEPTION 'ADR fechado: reabra antes de alterar o sign-off departamental.' USING ERRCODE = '42501';
  END IF;

  SELECT signed_at IS NOT NULL INTO v_currently_signed
  FROM public.agency_departure_report_department_signoffs
  WHERE report_id = v_report_id AND department = p_department
  FOR UPDATE;
  v_currently_signed := COALESCE(v_currently_signed, FALSE);

  -- Sem mudanca: idempotente, sem evento nem exigencia de justificativa.
  IF v_currently_signed = p_signed THEN
    RETURN jsonb_build_object('report_id', v_report_id, 'unchanged', TRUE);
  END IF;

  IF p_signed THEN
    -- Assinar exige todas as secoes do departamento resolvidas.
    IF EXISTS (
      SELECT 1 FROM (VALUES
        ('datas'), ('carga_descarregada'), ('carga_carregada'), ('veiculos'),
        ('vazios_embarcados'), ('vazios_descarregados')
      ) AS all_sections(section)
      WHERE public.agency_report_section_owner(all_sections.section) = p_department
        AND COALESCE((
          SELECT so.state FROM public.agency_departure_report_signoffs so
          WHERE so.report_id = v_report_id AND so.section = all_sections.section
        ), 'pending') = 'pending'
    ) THEN
      RAISE EXCEPTION 'Departamento % tem secoes pendentes: resolva-as antes de assinar.', p_department
        USING ERRCODE = '23514';
    END IF;
  ELSE
    -- Reabrir um sign-off ja dado exige justificativa.
    IF v_justification IS NULL THEN
      RAISE EXCEPTION 'Reabrir o sign-off departamental exige justificativa.' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.agency_departure_report_department_signoffs
    (report_id, department, signed_by, signed_at)
  VALUES (v_report_id, p_department, auth.uid(), CASE WHEN p_signed THEN now() ELSE NULL END)
  ON CONFLICT (report_id, department) DO UPDATE SET
    signed_by = EXCLUDED.signed_by,
    signed_at = EXCLUDED.signed_at;

  INSERT INTO public.audit_logs
    (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report_department_signoff',
          p_voyage_id || '::' || upper(btrim(p_port)) || '::' || p_department,
          'signed', v_currently_signed::TEXT, p_signed::TEXT, auth.uid(), v_justification);

  IF p_signed THEN
    UPDATE public.alerts
    SET status = 'closed', closed_at = now()
    WHERE type = 'agency_report_department_pending'
      AND entity_type = 'agency_departure_report'
      AND entity_id = p_voyage_id || '::' || upper(btrim(p_port)) || '::' || p_department
      AND status <> 'closed';
  END IF;

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_agency_report_department_signoff(BIGINT, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_agency_report_department_signoff(BIGINT, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;

-- 6) Deteccao de pendencia pos-ATD com a mesma lista de 6. Preserva a fonte de
--    escalas unificada da migration 251 (POD sem baseline + POL com baseline).
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
    SELECT
      split_part(entity_id, '::', 1)::BIGINT AS voyage_id,
      upper(trim(split_part(entity_id, '::', 2))) AS port
    FROM latest_atd
    WHERE COALESCE(trim(new_value), '') <> ''
      AND (
        -- Evita criar pendencias retroativas na primeira deteccao apos o deploy.
        (entity_type = 'voyage_pod_schedule' AND changed_at >= TIMESTAMPTZ '2026-07-19 00:00:00+00')
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
          ('vazios_embarcados'), ('vazios_descarregados')
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
      'ADR ' || p.port || ': departamento "' || public.agency_report_department_label(p.department) || '" pendente.',
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
