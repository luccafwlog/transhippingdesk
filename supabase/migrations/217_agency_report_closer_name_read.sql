-- Agency Departure Report: leitura do nome do autor do fechamento.
-- Intent: o ADR e legivel por usuarios internos ativos, mas user_profiles
-- permanece restrita ao proprio usuario/admin. Esta RPC devolve somente o
-- nome do closed_by associado ao ADR solicitado, depois do mesmo gate de
-- leitura do agregado; nao abre consulta arbitraria de perfis.
-- Esta e a parte inicial, aditiva e independente da migration planejada nas
-- Tasks 4/5. As validacoes de fechamento/reabertura devem permanecer em uma
-- migration sequencial posterior, sem alterar este contrato de leitura.
-- Rollback: DROP FUNCTION public.get_agency_report_closer_name(BIGINT, TEXT).

CREATE OR REPLACE FUNCTION public.get_agency_report_closer_name(
  p_voyage_id BIGINT,
  p_port TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_closed_by UUID;
  v_closer_name TEXT;
BEGIN
  -- Espelha a policy SELECT de agency_departure_reports: quem nao pode ler o
  -- ADR tambem nao pode resolver o perfil do seu autor.
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;

  SELECT closed_by INTO v_closed_by
  FROM public.agency_departure_reports
  WHERE voyage_id = p_voyage_id
    AND port = upper(btrim(p_port));

  IF v_closed_by IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT full_name INTO v_closer_name
  FROM public.user_profiles
  WHERE id = v_closed_by;

  RETURN v_closer_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_agency_report_closer_name(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agency_report_closer_name(BIGINT, TEXT) TO authenticated;
