-- Agency Departure Report: restaura a validacao de forma, chaves e tamanho do
-- snapshot no fechamento. Intent: a migration 224 trocou o gate de fechamento
-- de "7 secoes confirmadas" para "3 departamentos assinados" (ADR 0029) e, na
-- reescrita, derrubou sem querer a validacao de forma/tamanho/chaves que a
-- 218 havia criado — o snapshot fechado (registro financeiro imutavel)
-- passou a aceitar qualquer JSON. Esta migration reaplica aquela validacao
-- sobre a logica vigente da 224, com as allowlists atualizadas ao que a aba
-- efetivamente envia hoje: `departmentSignoffs` (Task 5) entra nas chaves de
-- topo; `vaziosUnidades` e `costs` entram nas secoes; os dois contadores de
-- hora extra que a 218 permitia saem da allowlist, pois a UI nao os envia
-- mais e esta validacao so vale para novos fechamentos (snapshots ja
-- fechados nao sao revalidados).
-- Afetadas: close_agency_departure_report.
-- Consumidores: src/services/agencyDepartureReport.ts (closeReport),
-- VoyageAgencyReportTab.tsx (botao de fechar o ADR).
-- Rollback: reaplicar a definicao de close_agency_departure_report da
-- migration 224 (gate de 3 departamentos, sem validacao de forma/chaves).

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
  v_unknown_sections TEXT[];
  v_unknown_top_level TEXT[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object'
     OR jsonb_typeof(p_snapshot->'header') <> 'object'
     OR jsonb_typeof(p_snapshot->'sections') <> 'object'
     OR jsonb_typeof(p_snapshot->'occurrences') <> 'array'
     OR jsonb_typeof(p_snapshot->'signoffs') <> 'array'
     OR octet_length(p_snapshot::text) > 1048576 THEN
    RAISE EXCEPTION 'Snapshot invalido: esperado objeto com header, sections, occurrences e signoffs (maximo 1 MiB).' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(key ORDER BY key) INTO v_unknown_top_level
  FROM jsonb_object_keys(p_snapshot) AS key
  WHERE key NOT IN ('header', 'sections', 'occurrences', 'signoffs', 'departmentSignoffs');
  IF v_unknown_top_level IS NOT NULL THEN
    RAISE EXCEPTION 'Snapshot possui chaves de topo desconhecidas: %.', array_to_string(v_unknown_top_level, ', ')
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(key ORDER BY key) INTO v_unknown_sections
  FROM jsonb_object_keys(p_snapshot->'sections') AS key
  WHERE key NOT IN (
    'cargaDescarregada', 'cargaSolta', 'vaziosDescarregados', 'veiculos',
    'vaziosEmbarcados', 'vaziosUnidades', 'vehicleLocations', 'depots',
    'directEmbarkCount', 'granito', 'storage', 'operation', 'costs'
  );
  IF v_unknown_sections IS NOT NULL THEN
    RAISE EXCEPTION 'Snapshot possui secoes desconhecidas: %.', array_to_string(v_unknown_sections, ', ')
      USING ERRCODE = '22023';
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
