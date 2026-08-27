-- 352: normalização de códigos de porto em SQL e reconciliação precisa de alertas de divergência Baplie/BL
-- Intent:
--   1. Criar helper public.normalize_port_code(TEXT) para mapear nomes e aliases de portos (ex.: CNTAG, TAIKANG -> CNTAC)
--   2. Atualizar public.reconcile_voyage_baplie_coverage_alerts para:
--      - Ignorar containers vazios (status = 'empty') do Baplie na checagem de cobertura de rotas de B/L
--      - Normalizar POL/POD de EDI e B/L via public.normalize_port_code
--      - Abrir o alerta de divergência documental voyage_baplie_documentary_coverage sempre que houver divergência e as rotas estiverem cobertas (ou D-7)
-- Consumidores: detect_voyage_operation_alerts(), triggers de viagem, Alertas UI.

-- 1. Helper SQL para normalização de códigos de porto
CREATE OR REPLACE FUNCTION public.normalize_port_code(p_port TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN upper(btrim(COALESCE(p_port, ''))) IN ('BRVIT', 'VITORIA', 'VITÓRIA', 'BRVIX', 'VIX') THEN 'BRVIX'
    WHEN upper(btrim(COALESCE(p_port, ''))) IN ('SALVADOR', 'BRSSA', 'SSA') THEN 'BRSSA'
    WHEN upper(btrim(COALESCE(p_port, ''))) IN ('PECEM', 'PECÉM', 'BRPEC', 'PEC') THEN 'BRPEC'
    WHEN upper(btrim(COALESCE(p_port, ''))) IN ('SANTOS', 'BRSSZ', 'SSZ') THEN 'BRSSZ'
    WHEN upper(btrim(COALESCE(p_port, ''))) IN ('PARANAGUA', 'PARANAGUÁ', 'BRPNG', 'PNG') THEN 'BRPNG'
    WHEN upper(btrim(COALESCE(p_port, ''))) IN ('ITAJAI', 'ITAJAÍ', 'BRITJ', 'ITJ', 'NAVEGANTES', 'BRNVT', 'NVT') THEN 'BRITJ'
    WHEN upper(btrim(COALESCE(p_port, ''))) IN ('RIO GRANDE', 'BRRIG', 'RIG') THEN 'BRRIG'
    WHEN upper(btrim(COALESCE(p_port, ''))) IN ('SUAPE', 'RECIFE', 'BRSUA', 'SUA', 'BRREC') THEN 'BRSUA'
    WHEN upper(btrim(COALESCE(p_port, ''))) IN ('RIO DE JANEIRO', 'BRRIO', 'BRRDJ') THEN 'BRRIO'
    WHEN upper(btrim(COALESCE(p_port, ''))) IN ('MANAUS', 'BRMAO') THEN 'BRMAO'
    WHEN upper(btrim(COALESCE(p_port, ''))) IN ('QINGDAO', 'TSINGTAO', 'CNTAO', 'CNQDG', 'QDG') THEN 'CNTAO'
    WHEN upper(btrim(COALESCE(p_port, ''))) IN ('SHANGHAI', 'CNSHA', 'CNSHG', 'SHG') THEN 'CNSHA'
    WHEN upper(btrim(COALESCE(p_port, ''))) IN ('TAICANG', 'TAIKANG', 'CNTAC', 'CNTAI', 'CNTAG') THEN 'CNTAC'
    WHEN upper(btrim(COALESCE(p_port, ''))) IN ('NINGBO', 'CNNGB', 'CNNBO', 'NBO') THEN 'CNNGB'
    WHEN upper(btrim(COALESCE(p_port, ''))) IN ('NANSHA', 'CNNSA', 'CNNAN', 'GUANGZHOU', 'CNGZU') THEN 'CNNSA'
    WHEN upper(btrim(COALESCE(p_port, ''))) IN ('ZHANGJIAGANG', 'CNZJG') THEN 'CNZJG'
    WHEN upper(btrim(COALESCE(p_port, ''))) IN ('XIAMEN', 'AMOY', 'CNXMN', 'XMN') THEN 'CNXMN'
    WHEN upper(btrim(COALESCE(p_port, ''))) IN ('SHEKOU', 'SHENZHEN', 'CNSHK', 'CNSZK', 'CNSHE') THEN 'CNSHK'
    WHEN upper(btrim(COALESCE(p_port, ''))) IN ('YANTIAN', 'CNYTN', 'YTN') THEN 'CNYTN'
    WHEN upper(btrim(COALESCE(p_port, ''))) IN ('HONG KONG', 'HONGKONG', 'HKHKG', 'HKG') THEN 'HKHKG'
    ELSE NULLIF(upper(btrim(COALESCE(p_port, ''))), '')
  END;
$$;

REVOKE ALL ON FUNCTION public.normalize_port_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_port_code(TEXT) TO authenticated, service_role;

-- 2. Reconciliador atualizado: voyage_baplie_documentary_coverage
CREATE OR REPLACE FUNCTION public.reconcile_voyage_baplie_coverage_alerts(
  p_voyage_id BIGINT,
  p_source TEXT DEFAULT 'voyage_operation_detector'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_first_eta DATE;
  v_is_d7 BOOLEAN;
  v_has_baplie BOOLEAN;
  v_edi_route_count INTEGER;
  v_missing_route_count INTEGER;
  v_divergence_count INTEGER := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.baplie_containers WHERE voyage_id = p_voyage_id
  ) INTO v_has_baplie;

  IF NOT v_has_baplie THEN
    PERFORM public.resolve_alert_item('voyage_baplie_documentary_coverage', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  v_first_eta := public.get_voyage_first_brazilian_eta(p_voyage_id);
  v_is_d7 := (v_first_eta IS NOT NULL AND v_today >= (v_first_eta - 7));

  -- Rotas EDI vs Rotas BL (ignorando containers vazios do Baplie e normalizando códigos de porto)
  WITH edi_routes AS (
    SELECT DISTINCT public.normalize_port_code(pol) AS pol, public.normalize_port_code(pod) AS pod
    FROM public.baplie_containers
    WHERE voyage_id = p_voyage_id
      AND pol IS NOT NULL AND pod IS NOT NULL
      AND COALESCE(status, '') <> 'empty'
  ),
  bl_routes AS (
    SELECT DISTINCT public.normalize_port_code(pol) AS pol, public.normalize_port_code(pod) AS pod
    FROM public.bls
    WHERE voyage_id = p_voyage_id
      AND pol IS NOT NULL AND pod IS NOT NULL
  )
  SELECT
    (SELECT count(*) FROM edi_routes WHERE pol IS NOT NULL AND pod IS NOT NULL),
    (SELECT count(*) FROM (
      SELECT pol, pod FROM edi_routes WHERE pol IS NOT NULL AND pod IS NOT NULL
      EXCEPT
      SELECT pol, pod FROM bl_routes WHERE pol IS NOT NULL AND pod IS NOT NULL
    ) missing)
  INTO v_edi_route_count, v_missing_route_count;

  -- Se não for D-7 e as rotas EDI de containers cheios ainda não foram todas cobertas por B/Ls, não emite divergência (aguardando cobertura)
  IF v_edi_route_count > 0 AND v_missing_route_count > 0 AND NOT v_is_d7 THEN
    PERFORM public.resolve_alert_item('voyage_baplie_documentary_coverage', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  -- Cálculo de divergências de existência de container (cheios do Baplie vs containers de BLs da viagem)
  WITH baplie_cntrs AS (
    SELECT DISTINCT regexp_replace(upper(btrim(container_number)), '\s+', '', 'g') AS container_number
    FROM public.baplie_containers
    WHERE voyage_id = p_voyage_id
      AND COALESCE(status, '') <> 'empty'
      AND NULLIF(btrim(container_number), '') IS NOT NULL
  ),
  bl_cntrs AS (
    SELECT DISTINCT regexp_replace(upper(btrim(bc.container_number)), '\s+', '', 'g') AS container_number
    FROM public.bl_containers bc
    JOIN public.bls b ON b.id = bc.bl_id
    WHERE b.voyage_id = p_voyage_id
      AND NULLIF(btrim(bc.container_number), '') IS NOT NULL
  )
  SELECT
    (SELECT count(*) FROM (SELECT container_number FROM baplie_cntrs EXCEPT SELECT container_number FROM bl_cntrs) d1) +
    (SELECT count(*) FROM (SELECT container_number FROM bl_cntrs EXCEPT SELECT container_number FROM baplie_cntrs) d2)
  INTO v_divergence_count;

  IF v_divergence_count > 0 THEN
    PERFORM public.upsert_alert_item(
      'voyage_baplie_documentary_coverage',
      'voyage',
      p_voyage_id::text,
      'Divergência Baplie/BL: ' || v_divergence_count || ' container(s) divergente(s) na viagem ' || p_voyage_id,
      p_source,
      jsonb_build_object('voyage_id', p_voyage_id, 'divergence_count', v_divergence_count),
      '/baplie?voyage=' || p_voyage_id
    );
  ELSE
    PERFORM public.resolve_alert_item('voyage_baplie_documentary_coverage', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_voyage_baplie_coverage_alerts(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_baplie_coverage_alerts(BIGINT, TEXT) TO authenticated, service_role;
