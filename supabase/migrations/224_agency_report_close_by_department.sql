-- Agency Departure Report: fechamento passa a exigir 3 departamentos, nao 7
-- secoes (ADR 0029). Intent: o gate de fechamento troca de granularidade —
-- de "todas as secoes confirmadas" para "os 3 departamentos assinaram" — sem
-- alterar o restante do fechamento (snapshot congelado, encerramento de
-- alertas). Reabertura (migration 218) tambem passa a limpar os sign-offs
-- departamentais, alem dos de secao, ao reabrir.
-- Afetadas: close_agency_departure_report, reopen_agency_departure_report.
-- Consumidores: src/hooks/useAgencyReport.ts (useCloseAgencyReport),
-- VoyageAgencyReportTab.tsx (contador X/3, Task 6).
-- Rollback: reaplicar as versoes da migration 214/218 (gate por 7 secoes).

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
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object'
     OR jsonb_typeof(p_snapshot->'sections') <> 'object' THEN
    RAISE EXCEPTION 'Snapshot obrigatorio (objeto com "sections") no fechamento.' USING ERRCODE = '22023';
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

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

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

  UPDATE public.agency_departure_reports
  SET status = 'open', closed_at = NULL, closed_by = NULL, closed_snapshot = NULL
  WHERE id = v_report_id;
  UPDATE public.agency_departure_report_signoffs
  SET state = 'pending', signed_by = NULL, signed_at = NULL
  WHERE report_id = v_report_id;
  UPDATE public.agency_departure_report_department_signoffs
  SET signed_by = NULL, signed_at = NULL
  WHERE report_id = v_report_id;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report', p_voyage_id || '::' || upper(btrim(p_port)),
          'status', 'closed', 'open', auth.uid(), btrim(p_justification));

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;
