-- 365_port_alias_qindgao.sql
-- Cadastra a variacao tipografica/comercial QINDGAO como alias para o porto
-- canonico CNTAO (Qingdao) na funcao de normalizacao de portos.
--
-- Consumidores:
--   - Reconciliacao documental Baplie/BL (reconcile_voyage_baplie_coverage_alerts)
--   - Selecao de tabela de taxas locais e demurrage por POD
--   - Normalizacao de escalas e rotas de viagens
--
-- Rollback: reaplicar a definicao de public.normalize_port_code da migration 361.

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
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('QINGDAO', 'QINDGAO', 'TSINGTAO', 'CNTAO', 'CNQDG', 'QDG') THEN 'CNTAO'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('SHANGHAI', 'CNSHA', 'CNSHG', 'SHG') THEN 'CNSHA'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('TAICANG', 'TAIKANG', 'CNTAC', 'CNTAI', 'CNTAG') THEN 'CNTAC'
    -- Ningbo-Zhoushan e um unico complexo portuario: o Baplie costuma trazer CNZOS
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
