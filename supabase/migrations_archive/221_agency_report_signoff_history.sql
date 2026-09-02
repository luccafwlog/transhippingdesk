-- Agency Departure Report: sign-off com justificativa e historico auditavel.
-- Intent: cada transicao de sign-off de secao vira um evento auditavel. A
-- primeira saida de "pending" (primeira decisao) so exige confirmacao na UI;
-- alterar uma decisao ja registrada (voltar a pending OU trocar entre confirmed
-- e nothing_to_declare) exige justificativa. Toda transicao real e gravada em
-- public.audit_logs (reuso da trilha existente; nenhuma tabela nova), como o
-- reopen_agency_departure_report (migration 218) ja faz.
-- Afetadas: set_agency_report_signoff (assinatura passa de 4 para 5 args).
-- Consumidores: src/services/agencyDepartureReport.ts (setSignoff). Portal nao usa.
-- Aditiva no schema; breaking no contrato do RPC (novo parametro).
-- Rollback: DROP da versao de 5 args e reaplicar a definicao de 4 args da
--           migration 213 (o historico ja gravado em audit_logs permanece).

DROP FUNCTION IF EXISTS public.set_agency_report_signoff(BIGINT, TEXT, TEXT, TEXT);

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

REVOKE ALL ON FUNCTION public.set_agency_report_signoff(BIGINT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_agency_report_signoff(BIGINT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Estende o resolver de nomes (migration 220) para tambem cobrir os autores
-- dos eventos historicos de sign-off deste ADR: um ator que registrou uma
-- transicao e depois foi sobrescrito nao aparece mais nas tabelas correntes,
-- mas seu nome precisa ser exibido no historico.
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
    SELECT oc.author_id FROM public.agency_departure_report_occurrences oc
    WHERE oc.report_id = v_report_id
    UNION
    SELECT al.changed_by FROM public.audit_logs al
    WHERE al.entity_type = 'agency_departure_report_signoff'
      AND al.entity_id LIKE v_prefix || '%'
      AND al.changed_by IS NOT NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_agency_report_actor_names(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agency_report_actor_names(BIGINT, TEXT) TO authenticated;
