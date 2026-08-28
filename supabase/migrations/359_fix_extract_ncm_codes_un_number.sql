-- 359: corrige public.extract_ncm_codes, que a 358 introduziu com dois defeitos.
--
-- Verificado contra o Postgres do branch de preview: a versão da 358 devolvia
-- ["87038000", "3556"] para "NCM : 8703.80.00 ... UN NCM: 3556". O 3556 é
-- número ONU de carga perigosa, não NCM — a versão TypeScript
-- (`extractNcmCodes`, src/lib/ncm.ts) sempre o excluiu e o SQL não.
--
-- 1. **Guarda do "UN" nunca disparava.** O grupo `(^|[^A-Za-z])` captura UM
--    caractere antes de "NCM"; em "UN NCM" esse caractere é o espaço, então
--    testar 'N$' sobre ele jamais casava. O prefixo passa a ser capturado como
--    grupo próprio `(UN[[:space:]]+)?`, e a presença do grupo descarta a
--    ocorrência.
-- 2. **Códigos vizinhos vinham colados.** A corrida de dígitos era truncada em
--    8 caracteres, então "NCM: 5509 1234" virava "55091234" em vez de dois
--    códigos. Agora a corrida é fatiada em blocos de 4/6/8 dígitos, como o
--    CODE_PATTERN do helper do front.
--
-- Corrige também o backfill da 358 nas linhas que ninguém editou de propósito:
-- as duas migrations sobem juntas, mas onde a 358 já rodou sozinha as linhas
-- ficaram com o código ONU sobrando.
--
-- Rollback: restaurar public.extract_ncm_codes da migration 358; não desfazer o
-- backfill corretivo (ele só remove código que nunca foi NCM).

CREATE OR REPLACE FUNCTION public.extract_ncm_codes(p_text TEXT)
RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_match TEXT[];
  v_chunk TEXT[];
  v_digits TEXT;
  v_result TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NULLIF(btrim(COALESCE(p_text, '')), '') IS NULL THEN
    RETURN v_result;
  END IF;

  FOR v_match IN
    SELECT match
    FROM regexp_matches(
      p_text,
      '(^|[^A-Za-z])(UN[[:space:]]+)?NCM(?:[[:space:]]*(?:NO\.?|NUMBER|CODE))?[[:space:]]*[:.]?[[:space:]]*([0-9][0-9.,[:space:]/-]{2,30})',
      'gi'
    ) AS match
  LOOP
    -- "UN NCM.:3556" é número ONU de carga perigosa, não NCM.
    CONTINUE WHEN v_match[2] IS NOT NULL;

    -- A corrida capturada pode trazer mais de um código ("5509 1234"); fatiar
    -- em blocos de 4, 6 ou 8 dígitos mantém a paridade com src/lib/ncm.ts.
    FOR v_chunk IN
      SELECT chunk
      FROM regexp_matches(v_match[3], '[0-9]{4}(?:[.,]?[0-9]{2})?(?:[.,]?[0-9]{2})?', 'g') AS chunk
    LOOP
      v_digits := regexp_replace(v_chunk[1], '[^0-9]', '', 'g');
      IF length(v_digits) >= 4 AND NOT (v_digits = ANY(v_result)) THEN
        v_result := array_append(v_result, v_digits);
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.extract_ncm_codes(TEXT) FROM PUBLIC, anon, authenticated;

-- Backfill corretivo. Só toca em B/L cujo NCM veio do backfill automático: uma
-- linha de auditoria com entity_type 'bl' e field_name 'ncm_codes' marca decisão
-- deliberada (edição na ficha ou gravação pela importação) e fica intocada. O
-- trigger genérico da 294 grava sob entity_type 'bls', então não confunde os
-- dois casos.
UPDATE public.bls AS b
SET ncm_codes = public.extract_ncm_codes(b.cargo_description)
WHERE cardinality(b.ncm_codes) > 0
  AND b.ncm_codes IS DISTINCT FROM public.extract_ncm_codes(b.cargo_description)
  AND cardinality(public.extract_ncm_codes(b.cargo_description)) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.audit_logs AS a
    WHERE a.entity_type = 'bl'
      AND a.entity_id = b.id
      AND a.field_name = 'ncm_codes'
  );

WITH item_codes AS (
  SELECT
    i.bl_id,
    public.extract_ncm_codes(string_agg(i.item_description, E'\n' ORDER BY i.id)) AS codes
  FROM public.bl_breakbulk_items AS i
  WHERE i.item_description IS NOT NULL
  GROUP BY i.bl_id
)
UPDATE public.bls AS b
SET ncm_codes = item_codes.codes
FROM item_codes
WHERE b.id = item_codes.bl_id
  AND cardinality(b.ncm_codes) > 0
  AND b.ncm_codes IS DISTINCT FROM item_codes.codes
  AND cardinality(item_codes.codes) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.audit_logs AS a
    WHERE a.entity_type = 'bl'
      AND a.entity_id = b.id
      AND a.field_name = 'ncm_codes'
  );
