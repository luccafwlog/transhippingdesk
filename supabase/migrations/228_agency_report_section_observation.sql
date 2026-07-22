-- Agency Departure Report: Observacao por secao substitui "Ocorrencias";
-- gate de sign-off e alertas param de considerar essa secao (ADR 0030).
-- Intent: a secao "Ocorrencias" misturava autoria (qualquer departamento
-- lanca) com responsabilidade (so Operacoes assina), travando o sign-off de
-- Operacoes por um estado que nao reflete responsabilidade real da secao.
-- Cada uma das 7 secoes remanescentes ganha uma Observacao opcional — nota
-- unica editavel, sem historico de multiplas entradas, sem justificativa
-- para sobrescrever, escrita so pelo dono da secao. A lista de secoes que
-- compoe cada departamento deixa de incluir 'ocorrencias'; Operacoes passa a
-- ter 1 secao propria (datas) em vez de 2.
-- Migracao de dados: linhas de resolucao da secao 'ocorrencias' em
-- agency_departure_report_signoffs (criadas enquanto ela ainda existia,
-- migrations 213/222) nao tem para onde migrar — a secao deixa de existir
-- estruturalmente, e o estado de resolucao (nao o conteudo) e o que essas
-- linhas guardam. Removidas antes de estreitar o CHECK; o historico das
-- transicoes permanece em audit_logs (entity_type=
-- 'agency_departure_report_signoff'), preservado. A tabela
-- agency_departure_report_occurrences e a RPC add_agency_report_occurrence
-- ficam sem uso pela aba a partir daqui (ver ADR 0030) mas nao sao alteradas
-- nem tem dados apagados nesta migration — o conteudo ja lancado permanece
-- disponivel fora da aba para inspecao historica.
-- Afetadas: agency_departure_report_signoffs (+ coluna observation, CHECK de
-- secao estreitado para 7); agency_report_section_owner (remove
-- 'ocorrencias'); nova RPC set_agency_report_section_observation;
-- set_agency_report_department_signoff e detect_agency_report_pending
-- (removem 'ocorrencias' da lista de secoes do gate/alerta).
-- Consumidores: src/services/agencyDepartureReport.ts, useAgencyReport.ts,
-- VoyageAgencyReportTab.tsx (issue #420, ticket seguinte).
-- Rollback: reaplicar o CHECK de 8 secoes da migration 222, DROP FUNCTION
--           set_agency_report_section_observation, DROP COLUMN observation,
--           e reaplicar agency_report_section_owner/
--           set_agency_report_department_signoff/detect_agency_report_pending
--           da migration 226/225 (linhas de 'ocorrencias' removidas aqui
--           nao sao recuperaveis a partir do audit_logs de estado).

DELETE FROM public.agency_departure_report_signoffs WHERE section = 'ocorrencias';

ALTER TABLE public.agency_departure_report_signoffs
  DROP CONSTRAINT IF EXISTS agency_departure_report_signoffs_section_check;
ALTER TABLE public.agency_departure_report_signoffs
  ADD CONSTRAINT agency_departure_report_signoffs_section_check CHECK (section IN (
    'datas', 'carga_descarregada', 'carga_carregada', 'veiculos',
    'vazios_embarcados', 'vazios_descarregados', 'operacao_patio'
  ));
ALTER TABLE public.agency_departure_report_signoffs
  ADD COLUMN IF NOT EXISTS observation TEXT;

CREATE OR REPLACE FUNCTION public.agency_report_section_owner(p_section TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_section
    WHEN 'datas' THEN 'operacoes'
    WHEN 'veiculos' THEN 'equipamentos'
    WHEN 'vazios_embarcados' THEN 'equipamentos'
    WHEN 'operacao_patio' THEN 'equipamentos'
    WHEN 'carga_descarregada' THEN 'documentacao'
    WHEN 'carga_carregada' THEN 'documentacao'
    WHEN 'vazios_descarregados' THEN 'documentacao'
    ELSE NULL
  END;
$$;

-- Escrita restrita ao dono da secao, sem justificativa nem audit_logs — e
-- edicao livre, nao um dado formal do ADR. Nao altera state/department/
-- signed_by/signed_at da resolucao de secao ja registrada.
CREATE OR REPLACE FUNCTION public.set_agency_report_section_observation(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_section TEXT,
  p_observation TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role TEXT;
  v_owner TEXT;
  v_report_id UUID;
  v_observation TEXT := NULLIF(btrim(COALESCE(p_observation, '')), '');
BEGIN
  SELECT role INTO v_role FROM public.user_profiles
  WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo'
                        WHEN 'operator' THEN 'documentacao'
                        ELSE v_role END;

  v_owner := public.agency_report_section_owner(p_section);
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Secao invalida.' USING ERRCODE = '22023';
  END IF;
  IF v_role NOT IN ('administrativo', v_owner) THEN
    RAISE EXCEPTION 'Secao pertence ao departamento %.', v_owner USING ERRCODE = '42501';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);
  IF EXISTS (
    SELECT 1 FROM public.agency_departure_reports
    WHERE id = v_report_id AND status = 'closed'
  ) THEN
    RAISE EXCEPTION 'ADR fechado: reabra antes de alterar a observacao.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.agency_departure_report_signoffs (report_id, section, department, observation)
  VALUES (v_report_id, p_section, v_owner, v_observation)
  ON CONFLICT (report_id, section) DO UPDATE SET
    observation = EXCLUDED.observation;

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_agency_report_section_observation(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_agency_report_section_observation(BIGINT, TEXT, TEXT, TEXT) TO authenticated;

-- Gate departamental (migration 226) sem 'ocorrencias': Operacoes passa a
-- ter 1 secao propria (datas) em vez de 2.
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
  v_role TEXT;
  v_report_id UUID;
  v_currently_signed BOOLEAN;
  v_justification TEXT := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  SELECT role INTO v_role FROM public.user_profiles
  WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo'
                        WHEN 'operator' THEN 'documentacao'
                        ELSE v_role END;

  IF p_department NOT IN ('operacoes', 'documentacao', 'equipamentos') THEN
    RAISE EXCEPTION 'Departamento invalido.' USING ERRCODE = '22023';
  END IF;
  IF v_role NOT IN ('administrativo', p_department) THEN
    RAISE EXCEPTION 'Sign-off pertence ao departamento %.', p_department USING ERRCODE = '42501';
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
        ('vazios_embarcados'), ('vazios_descarregados'), ('operacao_patio')
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

-- Alerta de pendencia por departamento (migration 225) sem 'ocorrencias'.
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
      -- Evita criar pendencias retroativas na primeira deteccao apos o deploy.
      AND changed_at >= TIMESTAMPTZ '2026-07-19 00:00:00+00'
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
