-- Agency Departure Report: alertas de pendencia por departamento, nao por
-- secao (ADR 0029). Intent: mantem o gatilho pos-ATD da 0027 (migration 214),
-- mas agrupa por departamento — "Documentacao pendente" — porque o sign-off
-- agora e um ato por departamento. Um departamento fica pendente enquanto
-- QUALQUER uma das suas secoes nao foi resolvida.
-- Afetadas: detect_agency_report_pending (novo tipo de alerta
-- 'agency_report_department_pending'); set_agency_report_signoff (para de
-- fechar o alerta obsoleto por secao, que deixa de ser criado); e
-- set_agency_report_department_signoff (passa a fechar o alerta do
-- departamento ao assinar).
-- Consumidores: src/services/alerts.ts (formatAgencyReportAlertEntity).
-- Rollback: reaplicar detect_agency_report_pending da migration 214 e
--           set_agency_report_signoff da 221 (tipo 'agency_report_section_pending').

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
          ('vazios_embarcados'), ('vazios_descarregados'), ('ocorrencias'), ('operacao_patio')
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

-- O sign-off por secao para de fechar o alerta (agora por departamento); quem
-- fecha o alerta e o sign-off departamental, abaixo.
CREATE OR REPLACE FUNCTION public.set_agency_report_signoff(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_section TEXT,
  p_state TEXT,
  p_justification TEXT DEFAULT NULL
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
  v_current TEXT;
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

  v_owner := public.agency_report_section_owner(p_section);
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Secao invalida.' USING ERRCODE = '22023';
  END IF;
  IF v_role NOT IN ('administrativo', v_owner) THEN
    RAISE EXCEPTION 'Secao pertence ao departamento %.', v_owner USING ERRCODE = '42501';
  END IF;
  IF p_state NOT IN ('pending', 'confirmed', 'nothing_to_declare') THEN
    RAISE EXCEPTION 'Estado invalido.' USING ERRCODE = '22023';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);

  IF EXISTS (
    SELECT 1 FROM public.agency_departure_reports
    WHERE id = v_report_id AND status = 'closed'
  ) THEN
    RAISE EXCEPTION 'ADR fechado: reabra antes de alterar sign-offs.' USING ERRCODE = '42501';
  END IF;

  -- Estado atual da secao: decide se ha transicao e se exige justificativa.
  SELECT state INTO v_current
  FROM public.agency_departure_report_signoffs
  WHERE report_id = v_report_id AND section = p_section
  FOR UPDATE;
  v_current := COALESCE(v_current, 'pending');

  -- Sem mudanca: nao grava evento nem exige justificativa (idempotente).
  IF v_current = p_state THEN
    RETURN jsonb_build_object('report_id', v_report_id, 'unchanged', TRUE);
  END IF;

  -- Alterar uma decisao ja registrada exige justificativa; a primeira saida de
  -- "pending" nao (a UI faz a confirmacao explicita).
  IF v_current <> 'pending' AND v_justification IS NULL THEN
    RAISE EXCEPTION 'Alterar uma decisao ja registrada exige justificativa.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.agency_departure_report_signoffs
    (report_id, section, state, department, signed_by, signed_at)
  VALUES (v_report_id, p_section, p_state, v_owner, auth.uid(),
          CASE WHEN p_state = 'pending' THEN NULL ELSE now() END)
  ON CONFLICT (report_id, section) DO UPDATE SET
    state = EXCLUDED.state,
    department = EXCLUDED.department,
    signed_by = EXCLUDED.signed_by,
    signed_at = EXCLUDED.signed_at;

  -- Historico da transicao (de->para + justificativa quando aplicavel).
  INSERT INTO public.audit_logs
    (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report_signoff',
          p_voyage_id || '::' || upper(btrim(p_port)) || '::' || p_section,
          'state', v_current, p_state, auth.uid(), v_justification);

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

-- Fecha o alerta de departamento pendente ao assinar (a assinatura so e
-- possivel com todas as secoes do departamento resolvidas).
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
        ('vazios_embarcados'), ('vazios_descarregados'), ('ocorrencias'), ('operacao_patio')
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
