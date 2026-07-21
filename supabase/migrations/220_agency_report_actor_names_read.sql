-- Agency Departure Report: nomes dos atores (sign-offs, ocorrências e
-- fechamento) em uma chamada única.
-- Intent: mesma justificativa da migration 217 — user_profiles permanece
-- restrita; esta RPC resolve somente os nomes dos atores de um ADR que o
-- solicitante pode ler. Generaliza a 217 (que permanece no schema por
-- compatibilidade; o cliente passa a consumir apenas esta).
-- Rollback: DROP FUNCTION public.get_agency_report_actor_names(BIGINT, TEXT).

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
BEGIN
  -- Espelha a policy SELECT de agency_departure_reports: quem nao pode ler o
  -- ADR tambem nao pode resolver os perfis dos seus atores.
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
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_agency_report_actor_names(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agency_report_actor_names(BIGINT, TEXT) TO authenticated;
