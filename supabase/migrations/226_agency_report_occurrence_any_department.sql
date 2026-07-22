-- Agency Departure Report: ocorrência de qualquer departamento + tag opcional
-- de seção (ADR 0029). Intent: o diário deixa de ser exclusivo de Operações
-- no registro (que continua dona do sign-off do diário, secao 'ocorrencias');
-- Documentação e Equipamentos passam a poder lançar. Cada ocorrência pode,
-- opcionalmente, referenciar uma das 8 seções do ADR.
-- Afetadas: agency_departure_report_occurrences (nova coluna 'section',
-- nullable); add_agency_report_occurrence (assinatura ganha p_section, RBAC
-- amplia para os 3 departamentos).
-- Consumidores: src/services/agencyDepartureReport.ts (addOccurrence),
-- VoyageAgencyReportTab.tsx (Task 6/7).
-- Aditiva no schema; breaking no contrato do RPC (novo parametro opcional no
-- fim, DEFAULT NULL preserva chamadas antigas).
-- Rollback: DROP COLUMN section; DROP FUNCTION da versao de 4 args e reaplicar
--           a de 3 args da migration 213 (dados de section ja gravados se perdem).

ALTER TABLE public.agency_departure_report_occurrences
  ADD COLUMN IF NOT EXISTS section TEXT;
ALTER TABLE public.agency_departure_report_occurrences
  DROP CONSTRAINT IF EXISTS agency_departure_report_occurrences_section_check;
ALTER TABLE public.agency_departure_report_occurrences
  ADD CONSTRAINT agency_departure_report_occurrences_section_check CHECK (
    section IS NULL OR section IN (
      'datas', 'carga_descarregada', 'carga_carregada', 'veiculos',
      'vazios_embarcados', 'vazios_descarregados', 'ocorrencias', 'operacao_patio'
    )
  );

DROP FUNCTION IF EXISTS public.add_agency_report_occurrence(BIGINT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.add_agency_report_occurrence(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_body TEXT,
  p_section TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role TEXT;
  v_report_id UUID;
  v_section TEXT := NULLIF(btrim(COALESCE(p_section, '')), '');
BEGIN
  SELECT role INTO v_role FROM public.user_profiles
  WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo'
                        WHEN 'operator' THEN 'documentacao'
                        ELSE v_role END;
  IF v_role NOT IN ('administrativo', 'operacoes', 'documentacao', 'equipamentos') THEN
    RAISE EXCEPTION 'Sem permissao para lancar ocorrencias.' USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(p_body, '')) = '' THEN
    RAISE EXCEPTION 'Ocorrencia vazia.' USING ERRCODE = '22023';
  END IF;
  IF v_section IS NOT NULL AND public.agency_report_section_owner(v_section) IS NULL THEN
    RAISE EXCEPTION 'Secao invalida.' USING ERRCODE = '22023';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);
  IF EXISTS (
    SELECT 1 FROM public.agency_departure_reports
    WHERE id = v_report_id AND status = 'closed'
  ) THEN
    RAISE EXCEPTION 'ADR fechado: reabra antes de adicionar ocorrencias.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.agency_departure_report_occurrences (report_id, body, author_id, department, section)
  VALUES (v_report_id, btrim(p_body), auth.uid(), v_role, v_section);

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.add_agency_report_occurrence(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_agency_report_occurrence(BIGINT, TEXT, TEXT, TEXT) TO authenticated;
