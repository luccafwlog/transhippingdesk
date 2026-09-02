-- Agency Departure Report: agregado por escala (ADR 0027, spec 2026-07-19).
-- Intent: ancora (voyage_id, port) sem promover escala a entidade; secoes com
-- sign-off departamental; ocorrencias append-only. Fechamento ocorre em
-- migration posterior. Nunca abreviar para "adr" (colide com Architecture
-- Decision Record).
-- Rollback: DROP das tabelas e funcoes criadas aqui.

CREATE TABLE IF NOT EXISTS public.agency_departure_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voyage_id BIGINT NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  port TEXT NOT NULL,
  terminal TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at TIMESTAMPTZ,
  closed_by UUID,
  closed_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (voyage_id, port)
);

CREATE TABLE IF NOT EXISTS public.agency_departure_report_signoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.agency_departure_reports(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK (section IN (
    'datas', 'carga_descarregada', 'carga_carregada', 'veiculos',
    'vazios_embarcados', 'vazios_descarregados', 'ocorrencias'
  )),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'confirmed', 'nothing_to_declare')),
  department TEXT NOT NULL,
  signed_by UUID,
  signed_at TIMESTAMPTZ,
  UNIQUE (report_id, section)
);

CREATE TABLE IF NOT EXISTS public.agency_departure_report_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.agency_departure_reports(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (btrim(body) <> ''),
  author_id UUID NOT NULL,
  department TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.agency_departure_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_departure_report_signoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_departure_report_occurrences ENABLE ROW LEVEL SECURITY;

-- Leitura interna ampla; escrita somente pelas RPCs (nenhuma policy de
-- INSERT/UPDATE/DELETE — append-only e transicoes controladas).
DROP POLICY IF EXISTS agency_departure_reports_select ON public.agency_departure_reports;
CREATE POLICY agency_departure_reports_select ON public.agency_departure_reports
  FOR SELECT TO authenticated USING (public.is_active_read_user());
DROP POLICY IF EXISTS agency_departure_report_signoffs_select ON public.agency_departure_report_signoffs;
CREATE POLICY agency_departure_report_signoffs_select ON public.agency_departure_report_signoffs
  FOR SELECT TO authenticated USING (public.is_active_read_user());
DROP POLICY IF EXISTS agency_departure_report_occurrences_select ON public.agency_departure_report_occurrences;
CREATE POLICY agency_departure_report_occurrences_select ON public.agency_departure_report_occurrences
  FOR SELECT TO authenticated USING (public.is_active_read_user());

CREATE OR REPLACE FUNCTION public.agency_report_section_owner(p_section TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_section
    WHEN 'datas' THEN 'operacoes'
    WHEN 'ocorrencias' THEN 'operacoes'
    WHEN 'veiculos' THEN 'equipamentos'
    WHEN 'vazios_embarcados' THEN 'equipamentos'
    WHEN 'carga_descarregada' THEN 'documentacao'
    WHEN 'carga_carregada' THEN 'documentacao'
    WHEN 'vazios_descarregados' THEN 'documentacao'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_agency_departure_report(
  p_voyage_id BIGINT,
  p_port TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report_id UUID;
  v_port TEXT := upper(btrim(COALESCE(p_port, '')));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF v_port = '' THEN
    RAISE EXCEPTION 'Porto obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.agency_departure_reports (voyage_id, port)
  VALUES (p_voyage_id, v_port)
  ON CONFLICT (voyage_id, port) DO UPDATE SET port = EXCLUDED.port
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_agency_report_signoff(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_section TEXT,
  p_state TEXT
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

  INSERT INTO public.agency_departure_report_signoffs
    (report_id, section, state, department, signed_by, signed_at)
  VALUES (v_report_id, p_section, p_state, v_owner, auth.uid(),
          CASE WHEN p_state = 'pending' THEN NULL ELSE now() END)
  ON CONFLICT (report_id, section) DO UPDATE SET
    state = EXCLUDED.state,
    department = EXCLUDED.department,
    signed_by = EXCLUDED.signed_by,
    signed_at = EXCLUDED.signed_at;

  IF p_state <> 'pending' THEN
    UPDATE public.alerts
    SET status = 'closed', closed_at = now()
    WHERE type = 'agency_report_section_pending'
      AND entity_type = 'agency_departure_report'
      AND entity_id = p_voyage_id || '::' || upper(btrim(p_port)) || '::' || p_section
      AND status <> 'closed';
  END IF;

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_agency_report_occurrence(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_body TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role TEXT;
  v_report_id UUID;
BEGIN
  SELECT role INTO v_role FROM public.user_profiles
  WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo'
                        WHEN 'operator' THEN 'documentacao'
                        ELSE v_role END;
  IF v_role NOT IN ('administrativo', 'operacoes') THEN
    RAISE EXCEPTION 'Ocorrencias pertencem ao departamento operacoes.' USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(p_body, '')) = '' THEN
    RAISE EXCEPTION 'Ocorrencia vazia.' USING ERRCODE = '22023';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);
  IF EXISTS (
    SELECT 1 FROM public.agency_departure_reports
    WHERE id = v_report_id AND status = 'closed'
  ) THEN
    RAISE EXCEPTION 'ADR fechado: reabra antes de adicionar ocorrencias.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.agency_departure_report_occurrences (report_id, body, author_id, department)
  VALUES (v_report_id, btrim(p_body), auth.uid(), v_role);

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_agency_report_terminal(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_terminal TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role TEXT;
  v_report_id UUID;
BEGIN
  SELECT role INTO v_role FROM public.user_profiles
  WHERE id = auth.uid() AND active = TRUE;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo'
                        WHEN 'operator' THEN 'documentacao'
                        ELSE v_role END;
  IF v_role NOT IN ('administrativo', 'operacoes') THEN
    RAISE EXCEPTION 'Terminal pertence ao departamento operacoes.' USING ERRCODE = '42501';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);
  UPDATE public.agency_departure_reports
  SET terminal = NULLIF(btrim(p_terminal), '')
  WHERE id = v_report_id AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADR fechado: reabra antes de alterar terminal.' USING ERRCODE = '42501';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.agency_report_section_owner(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_agency_departure_report(BIGINT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_agency_report_signoff(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_agency_report_occurrence(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_agency_report_terminal(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_agency_departure_report(BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_agency_report_signoff(BIGINT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_agency_report_occurrence(BIGINT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_agency_report_terminal(BIGINT, TEXT, TEXT) TO authenticated;
