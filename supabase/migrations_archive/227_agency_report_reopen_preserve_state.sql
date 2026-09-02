-- Agency Departure Report: reabertura so destrava a edicao (ADR 0030).
-- Intent: reabrir um ADR fechado deixava de resetar todas as secoes para
-- "Pendente" e apagava as 3 assinaturas departamentais, mesmo quando a
-- reabertura serve so para corrigir um dado pontual de uma unica secao.
-- Reabrir passa a so alterar o status do relatorio e limpar o snapshot
-- congelado; corrigir uma secao ja confirmada continua exigindo
-- justificativa auditada (fluxo ja existente da 0028/221), sem mudanca
-- adicional aqui. A justificativa e o registro em audit_logs da propria
-- reabertura tambem nao mudam.
-- Afetadas: reopen_agency_departure_report (para de fazer UPDATE em
-- agency_departure_report_signoffs e agency_departure_report_department_signoffs).
-- Consumidores: src/services/agencyDepartureReport.ts (reopenReport).
-- Rollback: reaplicar a versao de reopen_agency_departure_report da migration 224.

CREATE OR REPLACE FUNCTION public.reopen_agency_departure_report(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_justification TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(p_justification, '')) = '' THEN
    RAISE EXCEPTION 'Reabertura exige justificativa.' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_report_id
  FROM public.agency_departure_reports
  WHERE voyage_id = p_voyage_id AND port = upper(btrim(p_port)) AND status = 'closed'
  FOR UPDATE;
  IF v_report_id IS NULL THEN
    RAISE EXCEPTION 'ADR nao esta fechado.' USING ERRCODE = 'P0002';
  END IF;

  -- So destrava a edicao: nao reseta secoes nem assinaturas departamentais.
  UPDATE public.agency_departure_reports
  SET status = 'open', closed_at = NULL, closed_by = NULL, closed_snapshot = NULL
  WHERE id = v_report_id;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report', p_voyage_id || '::' || upper(btrim(p_port)),
          'status', 'closed', 'open', auth.uid(), btrim(p_justification));

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.reopen_agency_departure_report(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_agency_departure_report(BIGINT, TEXT, TEXT) TO authenticated;
