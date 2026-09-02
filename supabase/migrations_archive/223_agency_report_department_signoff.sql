-- Agency Departure Report: sign-off departamental (ADR 0029).
-- Intent: a resolucao por secao (migration 213/221) continua existindo como
-- pre-requisito; o ato de assinar passa a ser um por departamento (Operacoes,
-- Documentacao, Equipamentos), habilitado só quando todas as secoes do
-- departamento estao resolvidas (Confirmado/Nada a declarar). Reabrir um
-- sign-off ja dado exige justificativa, auditada em audit_logs (mesma trilha
-- da 0028/221, sem tabela nova de historico).
-- Afetadas: nova tabela agency_departure_report_department_signoffs; nova RPC
-- set_agency_report_department_signoff; get_agency_report_actor_names
-- estendida (assinantes departamentais + autores da reabertura no historico).
-- Consumidores: src/services/agencyDepartureReport.ts, useAgencyReport.ts.
-- Rollback: DROP da tabela/funcao criadas aqui; reaplicar
--           get_agency_report_actor_names da migration 221.

CREATE TABLE IF NOT EXISTS public.agency_departure_report_department_signoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.agency_departure_reports(id) ON DELETE CASCADE,
  department TEXT NOT NULL CHECK (department IN ('operacoes', 'documentacao', 'equipamentos')),
  signed_by UUID,
  signed_at TIMESTAMPTZ,
  UNIQUE (report_id, department)
);

ALTER TABLE public.agency_departure_report_department_signoffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agency_departure_report_department_signoffs_select ON public.agency_departure_report_department_signoffs;
CREATE POLICY agency_departure_report_department_signoffs_select ON public.agency_departure_report_department_signoffs
  FOR SELECT TO authenticated USING (public.is_active_read_user());

-- Reusa o mesmo guard de "ADR fechado" das secoes/ocorrencias (migration 214):
-- a funcao ja resolve o status a partir de NEW.report_id, generica para
-- qualquer tabela do agregado.
DROP TRIGGER IF EXISTS agency_report_department_signoffs_reject_closed_write ON public.agency_departure_report_department_signoffs;
CREATE TRIGGER agency_report_department_signoffs_reject_closed_write
  BEFORE INSERT OR UPDATE ON public.agency_departure_report_department_signoffs
  FOR EACH ROW EXECUTE FUNCTION public.agency_report_reject_closed_write();

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

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_agency_report_department_signoff(BIGINT, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_agency_report_department_signoff(BIGINT, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;

-- Estende a resolucao de nomes (migration 220/221) para cobrir assinantes
-- departamentais e os autores do historico de reabertura departamental.
CREATE OR REPLACE FUNCTION public.get_agency_report_actor_names(
  p_voyage_id BIGINT,
  p_port TEXT
)
RETURNS TABLE (user_id UUID, full_name TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report_id UUID;
  v_prefix TEXT := p_voyage_id || '::' || upper(btrim(p_port)) || '::';
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_report_id
  FROM public.agency_departure_reports
  WHERE voyage_id = p_voyage_id
    AND port = upper(btrim(p_port));

  IF v_report_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT up.id, up.full_name
  FROM public.user_profiles up
  WHERE up.id IN (
    SELECT r.closed_by FROM public.agency_departure_reports r
    WHERE r.id = v_report_id AND r.closed_by IS NOT NULL
    UNION
    SELECT so.signed_by FROM public.agency_departure_report_signoffs so
    WHERE so.report_id = v_report_id AND so.signed_by IS NOT NULL
    UNION
    SELECT dso.signed_by FROM public.agency_departure_report_department_signoffs dso
    WHERE dso.report_id = v_report_id AND dso.signed_by IS NOT NULL
    UNION
    SELECT oc.author_id FROM public.agency_departure_report_occurrences oc
    WHERE oc.report_id = v_report_id
    UNION
    SELECT al.changed_by FROM public.audit_logs al
    WHERE al.entity_type IN ('agency_departure_report_signoff', 'agency_departure_report_department_signoff')
      AND al.entity_id LIKE v_prefix || '%'
      AND al.changed_by IS NOT NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_agency_report_actor_names(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agency_report_actor_names(BIGINT, TEXT) TO authenticated;
