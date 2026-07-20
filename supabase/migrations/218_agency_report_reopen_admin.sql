-- Agency Departure Report: somente administradores podem reabrir o snapshot.
-- Intent: a UI sempre reservou esta acao a administradores; a RPC precisa
-- manter o mesmo limite contra chamadas diretas. O fechamento permanece
-- acessivel a qualquer usuario interno ativo, conforme o contrato do ADR.
-- Rollback: reaplicar a definicao de reopen_agency_departure_report da 214.

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

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report', p_voyage_id || '::' || upper(btrim(p_port)),
          'status', 'closed', 'open', auth.uid(), btrim(p_justification));

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.reopen_agency_departure_report(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_agency_departure_report(BIGINT, TEXT, TEXT) TO authenticated;
