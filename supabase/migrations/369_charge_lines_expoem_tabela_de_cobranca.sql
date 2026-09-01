-- 369: as linhas de cálculo passam a dizer de qual tabela de cobrança vieram
-- e sob qual base foram aplicadas (issue #583, conferência de cálculo).
--
-- A expansão do B/L na Validação precisa mostrar o cálculo E a tabela usada:
-- um B/L descarregado em Vitória é cobrado pela tabela de Vitória, um em
-- Salvador pela de Salvador, e hoje a tela tem os valores mas não tem como
-- dizer de onde vieram — `list_bl_local_charge_lines` devolve
-- `charge_table_id` cru, e `charge_tables`/`charge_table_items` são admin-only
-- sob RLS, então o cliente não pode resolver o nome por conta própria.
--
-- Acrescenta três colunas ao retorno, todas já existentes no cadastro:
--   `charge_table_name` — nome da tabela de cobrança (`charge_tables.name`);
--   `charge_table_pod`  — POD da tabela, que é o que amarra a escolha ao porto
--                         de descarga;
--   `application_basis` — base de aplicação do item (`charge_table_items`),
--                         que explica por que a quantidade é aquela.
--
-- A query e a ordenação (151) permanecem. Como `RETURNS TABLE` muda, é DROP +
-- CREATE: `CREATE OR REPLACE` não altera o tipo de retorno de uma função
-- existente. Os grants são reaplicados idênticos aos da 151, e nenhum
-- consumidor perde coluna — o retorno só cresce.
--
-- O gate usa `is_active_read_user()`, não `is_active_user()`: a 212 já havia
-- trocado essa RPC de leitura (junto com outras oito) para o helper de
-- leitura, porque `is_active_user()` (211) exclui o perfil Equipamentos. Um
-- DROP + CREATE que voltasse ao corpo da 151 reabriria essa lacuna.
--
-- Rollback: reaplicar a definição da migration 212 para esta RPC (mesmo
-- corpo, sem as três colunas novas), que já usa `is_active_read_user()`.

DROP FUNCTION IF EXISTS public.list_bl_local_charge_lines(TEXT);

CREATE FUNCTION public.list_bl_local_charge_lines(p_bl_id TEXT)
RETURNS TABLE (
  id BIGINT,
  bl_id TEXT,
  charge_table_id BIGINT,
  charge_item_id BIGINT,
  charge_name TEXT,
  charge_table_name TEXT,
  charge_table_pod TEXT,
  application_basis TEXT,
  source TEXT,
  status TEXT,
  quantity NUMERIC,
  currency TEXT,
  unit_value_brl NUMERIC,
  unit_value_usd NUMERIC,
  total_value_brl NUMERIC,
  total_value_usd NUMERIC,
  override_applied BOOLEAN,
  calculation_key TEXT,
  notes TEXT,
  review_reason TEXT,
  calculated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    cc.id,
    cc.bl_id,
    cc.charge_table_id,
    cc.charge_item_id,
    COALESCE(cti.name, '[Sistema]') AS charge_name,
    ct.name AS charge_table_name,
    ct.pod AS charge_table_pod,
    cti.application_basis,
    cc.source,
    cc.status,
    cc.quantity,
    COALESCE(cti.currency, CASE WHEN cc.unit_value_usd IS NOT NULL THEN 'USD' ELSE 'BRL' END) AS currency,
    cc.unit_value_brl,
    cc.unit_value_usd,
    cc.total_value_brl,
    cc.total_value_usd,
    cc.override_applied,
    cc.calculation_key,
    cc.notes,
    cc.review_reason,
    cc.calculated_at
  FROM public.charge_calculations AS cc
  LEFT JOIN public.charge_table_items AS cti ON cti.id = cc.charge_item_id
  -- A tabela vem da linha, não do item: a linha guarda a tabela vigente no
  -- momento do cálculo, e é essa que o operador precisa conferir.
  LEFT JOIN public.charge_tables AS ct ON ct.id = cc.charge_table_id
  WHERE cc.bl_id = p_bl_id
  ORDER BY cc.source DESC, cc.id ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_bl_local_charge_lines(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_bl_local_charge_lines(TEXT) TO authenticated;
