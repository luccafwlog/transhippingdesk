------------------------------------------------------------------------
-- apply_ce_mercante_manifest — importacao de CE Mercante via arquivo EDI.
--
-- Recebe o conjunto completo de pares (bl_id, ce) extraido dos registros C
-- do arquivo do manifesto e aplica de forma ATOMICA (tudo ou nada):
--
--   Qualitativo:
--     * nenhum BL repetido no arquivo (1 CE por BL)
--     * nenhum CE repetido no arquivo
--     * CE com exatamente 15 digitos
--   Quantitativo (escopo = batch / manifesto importado):
--     * todos os BLs do arquivo existem no sistema
--     * todos os BLs do arquivo pertencem a um unico batch (manifesto)
--     * todo BL daquele batch esta presente no arquivo (cobertura total)
--
-- Em caso de qualquer falha retorna { ok: false, errors: [...] } SEM gravar
-- nada (a funcao retorna antes de qualquer UPDATE). Em sucesso aplica os
-- updates + audit_logs e retorna o resumo.
--
-- Rollback: DROP FUNCTION public.apply_ce_mercante_manifest(JSONB, UUID);
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_ce_mercante_manifest(
  p_rows JSONB,
  p_changed_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_errors JSONB := '[]'::JSONB;
  v_part JSONB;
  v_batches BIGINT[];
  v_batch_id BIGINT;
  v_inserted INT := 0;
  v_overwritten INT := 0;
  v_unchanged INT := 0;
  v_old_ce TEXT;
  r RECORD;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Nenhum registro de CE Mercante informado' USING ERRCODE = '22023';
  END IF;

  -- 1) BL repetido no arquivo (mais de um CE para o mesmo BL).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'bl_id', d.bl_id,
           'message', 'BL ' || d.bl_id || ' repetido no arquivo (mais de um CE).')), '[]'::JSONB)
    INTO v_part
  FROM (
    SELECT bl_id
    FROM jsonb_to_recordset(p_rows) AS t(bl_id TEXT, ce TEXT)
    GROUP BY bl_id HAVING count(*) > 1
  ) d;
  v_errors := v_errors || v_part;

  -- 2) CE repetido no arquivo.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'ce', d.ce,
           'message', 'CE Mercante ' || d.ce || ' duplicado no arquivo.')), '[]'::JSONB)
    INTO v_part
  FROM (
    SELECT ce
    FROM jsonb_to_recordset(p_rows) AS t(bl_id TEXT, ce TEXT)
    GROUP BY ce HAVING count(*) > 1
  ) d;
  v_errors := v_errors || v_part;

  -- 3) CE Mercante deve ter exatamente 15 digitos.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'bl_id', t.bl_id,
           'message', 'CE Mercante invalido para o BL ' || t.bl_id || ': esperado 15 digitos.')), '[]'::JSONB)
    INTO v_part
  FROM jsonb_to_recordset(p_rows) AS t(bl_id TEXT, ce TEXT)
  WHERE t.ce !~ '^[0-9]{15}$';
  v_errors := v_errors || v_part;

  -- 4) BL inexistente no sistema.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'bl_id', f.bl_id,
           'message', 'BL ' || f.bl_id || ' nao encontrado no sistema.')), '[]'::JSONB)
    INTO v_part
  FROM (SELECT DISTINCT bl_id FROM jsonb_to_recordset(p_rows) AS t(bl_id TEXT, ce TEXT)) f
  LEFT JOIN public.bls b ON b.id = f.bl_id
  WHERE b.id IS NULL;
  v_errors := v_errors || v_part;

  -- Erros estruturais/existencia abortam antes da analise de manifesto.
  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_errors);
  END IF;

  -- 5) Deriva o manifesto: todos os BLs devem pertencer a um unico batch nao-nulo.
  SELECT array_agg(DISTINCT b.batch_id)
    INTO v_batches
  FROM (SELECT DISTINCT bl_id FROM jsonb_to_recordset(p_rows) AS t(bl_id TEXT, ce TEXT)) f
  JOIN public.bls b ON b.id = f.bl_id;

  IF array_length(v_batches, 1) > 1 OR v_batches[1] IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(
      jsonb_build_object('message',
        'Os BLs do arquivo nao pertencem a um unico manifesto (batch). Verifique se o arquivo corresponde a um unico manifesto importado.')));
  END IF;

  v_batch_id := v_batches[1];

  -- 6) Cobertura quantitativa: todo BL do manifesto deve estar no arquivo.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'bl_id', b.id,
           'message', 'BL ' || b.id || ' pertence ao manifesto mas nao possui CE no arquivo.')), '[]'::JSONB)
    INTO v_part
  FROM public.bls b
  WHERE b.batch_id = v_batch_id
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_rows) AS t(bl_id TEXT, ce TEXT)
      WHERE t.bl_id = b.id
    );
  v_errors := v_errors || v_part;

  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_errors);
  END IF;

  -- 7) Aplica (atomico). Qualquer excecao reverte tudo.
  FOR r IN
    SELECT bl_id, ce FROM jsonb_to_recordset(p_rows) AS t(bl_id TEXT, ce TEXT)
  LOOP
    SELECT ce_mercante INTO v_old_ce FROM public.bls WHERE id = r.bl_id FOR UPDATE;

    IF COALESCE(v_old_ce, '') = COALESCE(r.ce, '') THEN
      v_unchanged := v_unchanged + 1;
      CONTINUE;
    END IF;

    UPDATE public.bls SET ce_mercante = r.ce WHERE id = r.bl_id;

    INSERT INTO public.audit_logs(
      entity_type, entity_id, field_name, old_value, new_value, changed_by, justification
    ) VALUES (
      'bl', r.bl_id, 'ce_mercante',
      COALESCE(v_old_ce, ''), COALESCE(r.ce, ''),
      p_changed_by,
      'Importacao CE Mercante (EDI)'
    );

    IF v_old_ce IS NOT NULL AND v_old_ce <> '' THEN
      v_overwritten := v_overwritten + 1;
    ELSE
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'batch_id', v_batch_id,
    'processed', jsonb_array_length(p_rows),
    'inserted', v_inserted,
    'overwritten', v_overwritten,
    'unchanged', v_unchanged
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_ce_mercante_manifest(JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_ce_mercante_manifest(JSONB, UUID) TO authenticated;
