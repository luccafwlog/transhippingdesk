-- 361: divergência Baplie/B/L por rota, cobertura exigindo B/L com containers e frescor na origem
-- Intent:
--   1. public.normalize_port_code: reconhecer Zhoushan (CNZOS) como Ningbo (CNNGB) — mesmo
--      complexo Ningbo-Zhoushan. O Baplie codifica CNZOS onde o B/L declara CNNGB, e a rota
--      nunca fechava.
--   2. public.reconcile_voyage_baplie_coverage_alerts:
--      - só considera coberta a rota que tem pelo menos um B/L COM CONTAINERS (a regra sempre
--        foi "B/L com containers"; contar B/L sem container cobria rota à toa);
--      - gate passa a ser POR ROTA: uma rota do EDI ainda sem B/L não silencia mais a viagem
--        inteira. Rotas cobertas conciliam; rotas pendentes ficam fora da conciliação;
--      - containers de rota pendente continuam contando como presentes no Baplie, para não
--        gerar falso "container de B/L ausente do Baplie" do outro lado.
--   3. Triggers de frescor em baplie_containers, bls e bl_containers: importar Baplie ou B/L
--      recalcula o alerta na hora. Antes nenhuma das três origens disparava reconciliação.
--   4. Restaura o hardening da migration 338: reconcile_voyage_baplie_coverage_alerts volta a
--      não ser executável por `authenticated` (a 353 reconcedeu). Nenhum cliente a chama; a UI
--      usa src/services/baplieReconciliation.ts.
-- Consumidores: detect_voyage_operation_alerts(), reconcile_voyage_operation_alerts(), Alertas, /baplie.
-- Rollback: reaplicar as definições da migration 353 e
--   DROP TRIGGER reconcile_baplie_coverage_* ON public.baplie_containers | public.bls | public.bl_containers.

-- 1. Normalização de portos: complexo Ningbo-Zhoushan
CREATE OR REPLACE FUNCTION public.normalize_port_code(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('BRVIT', 'VITORIA', 'VITÓRIA', 'BRVIX', 'VIX') THEN 'BRVIX'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('SALVADOR', 'BRSSA', 'SSA') THEN 'BRSSA'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('PECEM', 'PECÉM', 'BRPEC', 'PEC') THEN 'BRPEC'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('SANTOS', 'BRSSZ', 'SSZ') THEN 'BRSSZ'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('PARANAGUA', 'PARANAGUÁ', 'BRPNG', 'PNG') THEN 'BRPNG'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('ITAJAI', 'ITAJAÍ', 'BRITJ', 'ITJ', 'NAVEGANTES', 'BRNVT', 'NVT') THEN 'BRITJ'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('RIO GRANDE', 'BRRIG', 'RIG') THEN 'BRRIG'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('SUAPE', 'RECIFE', 'BRSUA', 'SUA', 'BRREC') THEN 'BRSUA'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('RIO DE JANEIRO', 'BRRIO', 'BRRDJ') THEN 'BRRIO'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('MANAUS', 'BRMAO') THEN 'BRMAO'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('QINGDAO', 'TSINGTAO', 'CNTAO', 'CNQDG', 'QDG') THEN 'CNTAO'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('SHANGHAI', 'CNSHA', 'CNSHG', 'SHG') THEN 'CNSHA'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('TAICANG', 'TAIKANG', 'CNTAC', 'CNTAI', 'CNTAG') THEN 'CNTAC'
    -- Ningbo-Zhoushan é um único complexo portuário: o Baplie costuma trazer CNZOS
    -- (Zhoushan) para carga que o B/L declara como Ningbo (CNNGB).
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('NINGBO', 'CNNGB', 'CNNBO', 'NBO', 'ZHOUSHAN', 'CNZOS', 'ZOS') THEN 'CNNGB'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('NANSHA', 'CNNSA', 'CNNAN', 'GUANGZHOU', 'CNGZU') THEN 'CNNSA'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('ZHANGJIAGANG', 'CNZJG') THEN 'CNZJG'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('XIAMEN', 'AMOY', 'CNXMN', 'XMN') THEN 'CNXMN'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('SHEKOU', 'SHENZHEN', 'CNSHK', 'CNSZK', 'CNSHE') THEN 'CNSHK'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('YANTIAN', 'CNYTN', 'YTN') THEN 'CNYTN'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('HONG KONG', 'HONGKONG', 'HKHKG', 'HKG') THEN 'HKHKG'
    ELSE NULLIF(upper(btrim(COALESCE(p_value, ''))), '')
  END;
$$;

REVOKE ALL ON FUNCTION public.normalize_port_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_port_code(TEXT) TO authenticated, service_role;

-- 2. Reconciliador com gate POR ROTA
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
  v_covered_route_count INTEGER := 0;
  v_pending_route_count INTEGER := 0;
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

  -- Rotas EDI de containers cheios × rotas de B/L COM CONTAINERS.
  -- Só B/L com containers cobre rota: um B/L sem container não conferiu nada.
  WITH edi_routes AS (
    SELECT DISTINCT public.normalize_port_code(pol) AS pol, public.normalize_port_code(pod) AS pod
    FROM public.baplie_containers
    WHERE voyage_id = p_voyage_id
      AND pol IS NOT NULL AND pod IS NOT NULL
      AND COALESCE(status, '') <> 'empty'
  ),
  bl_routes AS (
    SELECT DISTINCT public.normalize_port_code(b.pol) AS pol, public.normalize_port_code(b.pod) AS pod
    FROM public.bls b
    WHERE b.voyage_id = p_voyage_id
      AND b.pol IS NOT NULL AND b.pod IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.bl_containers bc
        WHERE bc.bl_id = b.id
          AND NULLIF(btrim(bc.container_number), '') IS NOT NULL
      )
  ),
  valid_edi AS (
    SELECT pol, pod FROM edi_routes WHERE pol IS NOT NULL AND pod IS NOT NULL
  ),
  valid_bl AS (
    SELECT pol, pod FROM bl_routes WHERE pol IS NOT NULL AND pod IS NOT NULL
  )
  SELECT
    (SELECT count(*) FROM (SELECT pol, pod FROM valid_edi INTERSECT SELECT pol, pod FROM valid_bl) covered),
    (SELECT count(*) FROM (SELECT pol, pod FROM valid_edi EXCEPT SELECT pol, pod FROM valid_bl) pending)
  INTO v_covered_route_count, v_pending_route_count;

  -- Nenhuma rota conciliável ainda (todas aguardando B/L) e fora da janela D-7: não há o que
  -- apontar. Se ao menos uma rota está coberta, a conciliação roda para ela — uma rota sem
  -- B/L não silencia mais a viagem inteira.
  IF v_covered_route_count = 0 AND v_pending_route_count > 0 AND NOT v_is_d7 THEN
    PERFORM public.resolve_alert_item('voyage_baplie_documentary_coverage', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  -- Divergências de existência. `baplie_reconcilable` exclui as rotas ainda sem B/L (fora de
  -- D-7); `baplie_all` mantém todos os cheios, para que um container de rota pendente não vire
  -- falso "ausente do Baplie" pelo outro lado.
  WITH pending_routes AS (
    SELECT pol, pod FROM (
      SELECT DISTINCT public.normalize_port_code(pol) AS pol, public.normalize_port_code(pod) AS pod
      FROM public.baplie_containers
      WHERE voyage_id = p_voyage_id
        AND pol IS NOT NULL AND pod IS NOT NULL
        AND COALESCE(status, '') <> 'empty'
      EXCEPT
      SELECT DISTINCT public.normalize_port_code(b.pol) AS pol, public.normalize_port_code(b.pod) AS pod
      FROM public.bls b
      WHERE b.voyage_id = p_voyage_id
        AND b.pol IS NOT NULL AND b.pod IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.bl_containers bc
          WHERE bc.bl_id = b.id
            AND NULLIF(btrim(bc.container_number), '') IS NOT NULL
        )
    ) missing
    WHERE NOT v_is_d7
  ),
  baplie_full AS (
    SELECT
      regexp_replace(upper(btrim(container_number)), '\s+', '', 'g') AS container_number,
      public.normalize_port_code(pol) AS pol,
      public.normalize_port_code(pod) AS pod
    FROM public.baplie_containers
    WHERE voyage_id = p_voyage_id
      AND COALESCE(status, '') <> 'empty'
      AND NULLIF(btrim(container_number), '') IS NOT NULL
  ),
  baplie_all AS (
    SELECT DISTINCT container_number FROM baplie_full
  ),
  baplie_reconcilable AS (
    SELECT DISTINCT f.container_number
    FROM baplie_full f
    WHERE NOT EXISTS (
      SELECT 1 FROM pending_routes p
      WHERE p.pol IS NOT DISTINCT FROM f.pol AND p.pod IS NOT DISTINCT FROM f.pod
    )
  ),
  bl_cntrs AS (
    SELECT DISTINCT regexp_replace(upper(btrim(bc.container_number)), '\s+', '', 'g') AS container_number
    FROM public.bl_containers bc
    JOIN public.bls b ON b.id = bc.bl_id
    WHERE b.voyage_id = p_voyage_id
      AND NULLIF(btrim(bc.container_number), '') IS NOT NULL
  )
  SELECT
    (SELECT count(*) FROM (SELECT container_number FROM baplie_reconcilable EXCEPT SELECT container_number FROM bl_cntrs) d1) +
    (SELECT count(*) FROM (SELECT container_number FROM bl_cntrs EXCEPT SELECT container_number FROM baplie_all) d2)
  INTO v_divergence_count;

  IF v_divergence_count > 0 THEN
    PERFORM public.upsert_alert_item(
      'voyage_baplie_documentary_coverage',
      'voyage',
      p_voyage_id::text,
      'Divergência Baplie/BL: ' || v_divergence_count || ' container(s) divergente(s) na viagem ' || p_voyage_id,
      p_source,
      jsonb_build_object(
        'voyage_id', p_voyage_id,
        'divergence_count', v_divergence_count,
        'covered_route_count', v_covered_route_count,
        'pending_route_count', v_pending_route_count
      ),
      '/baplie?voyage=' || p_voyage_id
    );
  ELSE
    PERFORM public.resolve_alert_item('voyage_baplie_documentary_coverage', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_voyage_baplie_coverage_alerts(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_baplie_coverage_alerts(BIGINT, TEXT) TO service_role;

-- 3. Frescor na origem. Statement-level com transition tables: uma importação de milhares de
-- linhas reconcilia uma vez por viagem, não uma vez por linha.
CREATE OR REPLACE FUNCTION public.reconcile_baplie_coverage_from_new_rows()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_voyage_id BIGINT;
BEGIN
  -- Contrato da fundação de alertas (318): escrita a partir de trigger exige o flag.
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR v_voyage_id IN SELECT DISTINCT voyage_id FROM changed_rows WHERE voyage_id IS NOT NULL LOOP
    PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'baplie_coverage_trigger');
  END LOOP;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RAISE WARNING 'Reconciliação Baplie/BL ignorada (linhas novas): %', SQLERRM;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_baplie_coverage_from_old_rows()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_voyage_id BIGINT;
BEGIN
  -- Contrato da fundação de alertas (318): escrita a partir de trigger exige o flag.
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR v_voyage_id IN SELECT DISTINCT voyage_id FROM changed_rows WHERE voyage_id IS NOT NULL LOOP
    PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'baplie_coverage_trigger');
  END LOOP;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RAISE WARNING 'Reconciliação Baplie/BL ignorada (linhas removidas): %', SQLERRM;
  RETURN NULL;
END;
$function$;

-- bl_containers não carrega voyage_id: resolve via bls.
CREATE OR REPLACE FUNCTION public.reconcile_baplie_coverage_from_new_bl_containers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_voyage_id BIGINT;
BEGIN
  -- Contrato da fundação de alertas (318): escrita a partir de trigger exige o flag.
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR v_voyage_id IN
    SELECT DISTINCT b.voyage_id
    FROM changed_rows c
    JOIN public.bls b ON b.id = c.bl_id
    WHERE b.voyage_id IS NOT NULL
  LOOP
    PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'baplie_coverage_trigger');
  END LOOP;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RAISE WARNING 'Reconciliação Baplie/BL ignorada (containers de B/L novos): %', SQLERRM;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_baplie_coverage_from_old_bl_containers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_voyage_id BIGINT;
BEGIN
  -- Contrato da fundação de alertas (318): escrita a partir de trigger exige o flag.
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR v_voyage_id IN
    SELECT DISTINCT b.voyage_id
    FROM changed_rows c
    JOIN public.bls b ON b.id = c.bl_id
    WHERE b.voyage_id IS NOT NULL
  LOOP
    PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'baplie_coverage_trigger');
  END LOOP;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RAISE WARNING 'Reconciliação Baplie/BL ignorada (containers de B/L removidos): %', SQLERRM;
  RETURN NULL;
END;
$function$;

-- Transition tables exigem UM evento por trigger: INSERT, UPDATE e DELETE separados.
DROP TRIGGER IF EXISTS reconcile_baplie_coverage_on_baplie_insert ON public.baplie_containers;
CREATE TRIGGER reconcile_baplie_coverage_on_baplie_insert
  AFTER INSERT ON public.baplie_containers
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_baplie_coverage_from_new_rows();

DROP TRIGGER IF EXISTS reconcile_baplie_coverage_on_baplie_update ON public.baplie_containers;
CREATE TRIGGER reconcile_baplie_coverage_on_baplie_update
  AFTER UPDATE ON public.baplie_containers
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_baplie_coverage_from_new_rows();

DROP TRIGGER IF EXISTS reconcile_baplie_coverage_on_baplie_delete ON public.baplie_containers;
CREATE TRIGGER reconcile_baplie_coverage_on_baplie_delete
  AFTER DELETE ON public.baplie_containers
  REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_baplie_coverage_from_old_rows();

DROP TRIGGER IF EXISTS reconcile_baplie_coverage_on_bls_insert ON public.bls;
CREATE TRIGGER reconcile_baplie_coverage_on_bls_insert
  AFTER INSERT ON public.bls
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_baplie_coverage_from_new_rows();

DROP TRIGGER IF EXISTS reconcile_baplie_coverage_on_bls_update ON public.bls;
CREATE TRIGGER reconcile_baplie_coverage_on_bls_update
  AFTER UPDATE ON public.bls
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_baplie_coverage_from_new_rows();

DROP TRIGGER IF EXISTS reconcile_baplie_coverage_on_bls_delete ON public.bls;
CREATE TRIGGER reconcile_baplie_coverage_on_bls_delete
  AFTER DELETE ON public.bls
  REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_baplie_coverage_from_old_rows();

DROP TRIGGER IF EXISTS reconcile_baplie_coverage_on_bl_containers_insert ON public.bl_containers;
CREATE TRIGGER reconcile_baplie_coverage_on_bl_containers_insert
  AFTER INSERT ON public.bl_containers
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_baplie_coverage_from_new_bl_containers();

DROP TRIGGER IF EXISTS reconcile_baplie_coverage_on_bl_containers_update ON public.bl_containers;
CREATE TRIGGER reconcile_baplie_coverage_on_bl_containers_update
  AFTER UPDATE ON public.bl_containers
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_baplie_coverage_from_new_bl_containers();

DROP TRIGGER IF EXISTS reconcile_baplie_coverage_on_bl_containers_delete ON public.bl_containers;
CREATE TRIGGER reconcile_baplie_coverage_on_bl_containers_delete
  AFTER DELETE ON public.bl_containers
  REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_baplie_coverage_from_old_bl_containers();

REVOKE ALL ON FUNCTION public.reconcile_baplie_coverage_from_new_rows() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_baplie_coverage_from_old_rows() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_baplie_coverage_from_new_bl_containers() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_baplie_coverage_from_old_bl_containers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_baplie_coverage_from_new_rows() TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_baplie_coverage_from_old_rows() TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_baplie_coverage_from_new_bl_containers() TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_baplie_coverage_from_old_bl_containers() TO service_role;

-- 4. Reconciliação imediata do estado atual: o alerta não espera o próximo evento de origem.
DO $$
DECLARE
  v_voyage_id BIGINT;
BEGIN
  -- Contrato da fundação de alertas (318): escrita a partir de trigger exige o flag.
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR v_voyage_id IN
    SELECT DISTINCT b.voyage_id
    FROM public.baplie_containers b
    ORDER BY b.voyage_id
  LOOP
    BEGIN
      PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'baplie_coverage_backfill');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Backfill de divergência Baplie/BL ignorado para voyage_id=%: %', v_voyage_id, SQLERRM;
    END;
  END LOOP;
END;
$$;
