-- 358: NCM vira campo próprio do B/L, cadastrável e persistido.
--
-- Até aqui o NCM não existia como dado: `src/lib/ncm.ts` extraía os códigos de
-- `cargo_description` no momento de desenhar a ficha. Isso quebra em dois
-- caminhos reais de ingestão, e o operador não tem onde corrigir:
--
-- 1. B/L de container (`blParser.parseCargoDescription`) lê a descrição de UMA
--    célula abaixo de "Description of Goods"; quando o armador quebra o quadro
--    de mercadoria em mais linhas, a linha do NCM fica fora da descrição.
-- 2. Carga solta (`normalizeCarrierBreakbulkDescription`) REMOVE de propósito as
--    linhas iniciadas por "NCM NUMBER" ao montar a descrição de uma linha, e
--    `breakbulkImport` guarda só as 3 primeiras descrições de item.
--
-- Em ambos, reimportar atualiza a descrição e o NCM continua vazio ou velho —
-- não há o que atualizar, porque o dado nunca foi gravado. A manifestação no
-- Mercante exige o NCM, então ele passa a ser campo de verdade: editável na
-- ficha, preenchido pela importação quando o documento declara, e preservado
-- quando o documento não declara (ausência em texto livre não é declaração de
-- que a carga não tem NCM).
--
-- Rollback: ALTER TABLE public.bls DROP COLUMN ncm_codes; restaurar
-- save_bl_review da migration 205 e o wrapper de importação da 357; remover
-- public.normalize_ncm_codes e public.extract_ncm_codes.

ALTER TABLE public.bls
  ADD COLUMN IF NOT EXISTS ncm_codes TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.bls.ncm_codes IS
  'NCM da carga do B/L, somente dígitos (4 a 8), sem pontuação e sem duplicata. Vazio enquanto ninguém cadastrou nem o documento declarou. Necessário para a manifestação no Mercante.';

ALTER TABLE public.bls
  DROP CONSTRAINT IF EXISTS bls_ncm_codes_digits;

-- CHECK não aceita subconsulta; serializar o array e validar a string inteira
-- cobre todos os elementos numa expressão só.
ALTER TABLE public.bls
  ADD CONSTRAINT bls_ncm_codes_digits
  CHECK (array_to_string(ncm_codes, ',') ~ '^([0-9]{4,8}(,[0-9]{4,8})*)?$');

-- ---------------------------------------------------------------------------
-- Normalização e extração, espelhando src/lib/ncm.ts
-- ---------------------------------------------------------------------------

-- Aceita o array JSON que a ficha manda e devolve códigos limpos: só dígitos,
-- 4 a 8, sem duplicata, na ordem em que o operador escreveu.
CREATE OR REPLACE FUNCTION public.normalize_ncm_codes(p_codes JSONB)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT COALESCE(
    (
      SELECT array_agg(code ORDER BY ordinality)
      FROM (
        SELECT DISTINCT ON (digits) digits AS code, ordinality
        FROM (
          SELECT regexp_replace(value, '[^0-9]', '', 'g') AS digits, ordinality
          FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(p_codes) = 'array' THEN p_codes ELSE '[]'::JSONB END
          ) WITH ORDINALITY AS entry(value, ordinality)
        ) AS cleaned
        WHERE length(digits) BETWEEN 4 AND 8
        ORDER BY digits, ordinality
      ) AS deduped
    ),
    ARRAY[]::TEXT[]
  );
$function$;

REVOKE ALL ON FUNCTION public.normalize_ncm_codes(JSONB) FROM PUBLIC, anon, authenticated;

-- Mesma leitura do helper do front (`extractNcmCodes`): procura o rótulo NCM
-- seguido dos dígitos e ignora o número ONU escrito como "UN NCM.:3556".
CREATE OR REPLACE FUNCTION public.extract_ncm_codes(p_text TEXT)
RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_match TEXT[];
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
      '(^|[^A-Za-z])NCM(?:[[:space:]]*(?:NO\.?|NUMBER|CODE))?[[:space:]]*[:.]?[[:space:]]*([0-9][0-9.,[:space:]/-]{2,30})',
      'gi'
    ) AS match
  LOOP
    -- "UN NCM." é número de carga perigosa, não NCM.
    CONTINUE WHEN btrim(COALESCE(v_match[1], '')) ~* 'N$';
    v_digits := substring(regexp_replace(v_match[2], '[^0-9]', '', 'g') FROM 1 FOR 8);
    IF length(v_digits) >= 4 AND NOT (v_digits = ANY(v_result)) THEN
      v_result := array_append(v_result, v_digits);
    END IF;
  END LOOP;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.extract_ncm_codes(TEXT) FROM PUBLIC, anon, authenticated;

-- Backfill: quem já tem o NCM legível na descrição não começa do zero. B/L cuja
-- descrição não declara NCM fica vazio e aguarda cadastro manual.
UPDATE public.bls AS b
SET ncm_codes = public.extract_ncm_codes(b.cargo_description)
WHERE cardinality(b.ncm_codes) = 0
  AND cardinality(public.extract_ncm_codes(b.cargo_description)) > 0;

-- Carga solta guarda o NCM nos itens, não na descrição (a descrição descarta as
-- linhas "NCM NUMBER" e fica só com os 3 primeiros itens).
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
  AND cardinality(b.ncm_codes) = 0
  AND cardinality(item_codes.codes) > 0;

-- ---------------------------------------------------------------------------
-- Edição manual na ficha
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_bl_review(
  p_bl_id TEXT,
  p_expected_updated_at TIMESTAMPTZ,
  p_update_payload JSONB,
  p_audit_rows JSONB,
  p_changed_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_new_updated_at TIMESTAMPTZ;
  v_current_updated_at TIMESTAMPTZ;
  v_next_customer_id BIGINT;
  v_previous_status TEXT;
  v_input_notes TEXT;
  v_human_notes TEXT;
  v_rowcount INT;
  v_reasons TEXT[];
  v_status TEXT;
  v_notes TEXT;
  v_justification TEXT := 'Revisao manual';
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para revisar B/L.'
      USING ERRCODE = '42501';
  END IF;

  IF p_bl_id IS NULL OR p_bl_id = '' THEN
    RAISE EXCEPTION 'bl_id obrigatorio' USING ERRCODE = '22004';
  END IF;

  SELECT updated_at
  INTO v_current_updated_at
  FROM public.bls
  WHERE id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BL % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND v_current_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuario; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;

  v_next_customer_id := CASE
    WHEN p_update_payload ? 'customer_id'
      THEN NULLIF(p_update_payload->>'customer_id', '')::BIGINT
    ELSE NULL
  END;

  UPDATE public.bls AS b
  SET
    shipper            = CASE WHEN p_update_payload ? 'shipper' THEN p_update_payload->>'shipper' ELSE b.shipper END,
    consignee          = CASE WHEN p_update_payload ? 'consignee' THEN p_update_payload->>'consignee' ELSE b.consignee END,
    notify_party       = CASE WHEN p_update_payload ? 'notify_party' THEN p_update_payload->>'notify_party' ELSE b.notify_party END,
    ce_mercante        = CASE WHEN p_update_payload ? 'ce_mercante' THEN p_update_payload->>'ce_mercante' ELSE b.ce_mercante END,
    pol                = CASE WHEN p_update_payload ? 'pol' THEN p_update_payload->>'pol' ELSE b.pol END,
    pod                = CASE WHEN p_update_payload ? 'pod' THEN p_update_payload->>'pod' ELSE b.pod END,
    place_of_delivery  = CASE WHEN p_update_payload ? 'place_of_delivery' THEN p_update_payload->>'place_of_delivery' ELSE b.place_of_delivery END,
    place_of_receipt   = CASE WHEN p_update_payload ? 'place_of_receipt' THEN p_update_payload->>'place_of_receipt' ELSE b.place_of_receipt END,
    movement_from      = CASE WHEN p_update_payload ? 'movement_from' THEN p_update_payload->>'movement_from' ELSE b.movement_from END,
    movement_to        = CASE WHEN p_update_payload ? 'movement_to' THEN p_update_payload->>'movement_to' ELSE b.movement_to END,
    issue_place        = CASE WHEN p_update_payload ? 'issue_place' THEN p_update_payload->>'issue_place' ELSE b.issue_place END,
    bl_emission_date   = CASE WHEN p_update_payload ? 'bl_emission_date' THEN NULLIF(p_update_payload->>'bl_emission_date', '')::DATE ELSE b.bl_emission_date END,
    cargo_description  = CASE WHEN p_update_payload ? 'cargo_description' THEN p_update_payload->>'cargo_description' ELSE b.cargo_description END,
    total_weight_kg    = CASE WHEN p_update_payload ? 'total_weight_kg' THEN NULLIF(p_update_payload->>'total_weight_kg', '')::NUMERIC ELSE b.total_weight_kg END,
    total_cbm          = CASE WHEN p_update_payload ? 'total_cbm' THEN NULLIF(p_update_payload->>'total_cbm', '')::NUMERIC ELSE b.total_cbm END,
    bb_machine_qty     = CASE WHEN p_update_payload ? 'bb_machine_qty' THEN NULLIF(p_update_payload->>'bb_machine_qty', '')::NUMERIC ELSE b.bb_machine_qty END,
    bb_packages_qty    = CASE WHEN p_update_payload ? 'bb_packages_qty' THEN NULLIF(p_update_payload->>'bb_packages_qty', '')::NUMERIC ELSE b.bb_packages_qty END,
    bb_packages_total  = CASE WHEN p_update_payload ? 'bb_packages_total' THEN NULLIF(p_update_payload->>'bb_packages_total', '')::NUMERIC ELSE b.bb_packages_total END,
    bb_weight_ton      = CASE WHEN p_update_payload ? 'bb_weight_ton' THEN NULLIF(p_update_payload->>'bb_weight_ton', '')::NUMERIC ELSE b.bb_weight_ton END,
    incoterm           = CASE WHEN p_update_payload ? 'incoterm' THEN p_update_payload->>'incoterm' ELSE b.incoterm END,
    payment_type       = CASE WHEN p_update_payload ? 'payment_type' THEN NULLIF(p_update_payload->>'payment_type', '') ELSE b.payment_type END,
    free_time_override = CASE WHEN p_update_payload ? 'free_time_override' THEN NULLIF(p_update_payload->>'free_time_override', '')::INT ELSE b.free_time_override END,
    notes              = CASE WHEN p_update_payload ? 'notes' THEN p_update_payload->>'notes' ELSE b.notes END,
    -- NCM cadastrado a mão na ficha (migration 358). Chega como array JSON de
    -- códigos; `[]` é uma decisão do operador de limpar, não um valor ausente.
    ncm_codes          = CASE
      WHEN p_update_payload ? 'ncm_codes'
        THEN public.normalize_ncm_codes(p_update_payload->'ncm_codes')
      ELSE b.ncm_codes
    END,
    customer_id        = CASE WHEN p_update_payload ? 'customer_id' THEN v_next_customer_id ELSE b.customer_id END,
    customer_reconciliation_status = CASE
      WHEN p_update_payload ? 'customer_reconciliation_status'
        THEN p_update_payload->>'customer_reconciliation_status'
      WHEN p_update_payload ? 'customer_id'
        THEN CASE WHEN v_next_customer_id IS NULL THEN 'missing_customer' ELSE 'reconciled' END
      ELSE b.customer_reconciliation_status
    END,
    customer_reconciliation_notes = CASE
      WHEN p_update_payload ? 'customer_reconciliation_notes'
        THEN NULLIF(p_update_payload->>'customer_reconciliation_notes', '')
      WHEN p_update_payload ? 'customer_id'
        THEN CASE
          WHEN v_next_customer_id IS NULL THEN 'Cliente removido manualmente do B/L.'
          ELSE 'Cliente reconciliado manualmente na revisao do B/L.'
        END
      ELSE b.customer_reconciliation_notes
    END,
    billing_hold_reason = CASE
      WHEN p_update_payload ? 'billing_hold_reason'
        THEN NULLIF(p_update_payload->>'billing_hold_reason', '')
      WHEN p_update_payload ? 'customer_id'
        THEN CASE
          WHEN v_next_customer_id IS NULL
            THEN COALESCE(b.billing_hold_reason, 'Cliente sem reconciliacao aprovada.')
          ELSE NULL
        END
      ELSE b.billing_hold_reason
    END
  WHERE b.id = p_bl_id
    AND (p_expected_updated_at IS NULL OR b.updated_at = p_expected_updated_at)
  RETURNING b.review_status, b.notes
  INTO v_previous_status, v_input_notes;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount = 0 THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuario; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;

  v_reasons := public.compute_bl_review_pendencies(p_bl_id);
  v_status := CASE
    WHEN COALESCE(cardinality(v_reasons), 0) = 0 THEN 'reviewed'
    ELSE 'pending_review'
  END;

  -- The machine-owned line always stays at the end. Human notes remain intact.
  v_human_notes := btrim(
    regexp_replace(
      COALESCE(v_input_notes, ''),
      E'(^|\\n)Pendencias de importacao:[^\\n]*$',
      '',
      'i'
    )
  );

  v_notes := CASE
    WHEN COALESCE(cardinality(v_reasons), 0) > 0 THEN concat_ws(
      E'\n',
      NULLIF(v_human_notes, ''),
      'Pendencias de importacao: ' || array_to_string(v_reasons, ', ')
    )
    ELSE NULLIF(v_human_notes, '')
  END;

  UPDATE public.bls AS b
  SET
    review_status = v_status,
    notes = v_notes
  WHERE b.id = p_bl_id
  RETURNING b.updated_at INTO v_new_updated_at;

  IF p_audit_rows IS NOT NULL
     AND jsonb_typeof(p_audit_rows) = 'array'
     AND jsonb_array_length(p_audit_rows) > 0 THEN
    SELECT COALESCE(NULLIF(a->>'justification', ''), v_justification)
    INTO v_justification
    FROM jsonb_array_elements(p_audit_rows) AS a
    LIMIT 1;

    INSERT INTO public.audit_logs (
      entity_type,
      entity_id,
      field_name,
      old_value,
      new_value,
      changed_by,
      justification
    )
    SELECT
      COALESCE(a->>'entity_type', 'bl'),
      COALESCE(a->>'entity_id', p_bl_id),
      a->>'field_name',
      a->>'old_value',
      a->>'new_value',
      p_changed_by,
      COALESCE(NULLIF(a->>'justification', ''), v_justification)
    FROM jsonb_array_elements(p_audit_rows) AS a
    WHERE a->>'field_name' IS DISTINCT FROM 'review_status';
  END IF;

  IF v_previous_status IS DISTINCT FROM v_status THEN
    INSERT INTO public.audit_logs (
      entity_type,
      entity_id,
      field_name,
      old_value,
      new_value,
      changed_by,
      justification
    )
    VALUES (
      'bl',
      p_bl_id,
      'review_status',
      v_previous_status,
      v_status,
      p_changed_by,
      v_justification
    );
  END IF;

  PERFORM public.sync_customer_reconciliation_queue_for_bl(p_bl_id);

  RETURN jsonb_build_object(
    'updated_at', v_new_updated_at,
    'review_status', v_status,
    'pendencias', to_jsonb(v_reasons)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_bl_review(TEXT, TIMESTAMPTZ, JSONB, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_bl_review(TEXT, TIMESTAMPTZ, JSONB, JSONB, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Importação preenche o NCM sem apagar o que foi cadastrado
-- ---------------------------------------------------------------------------
-- ponytail: quarta camada de wrapper sobre a RPC de importação
-- (205 → 284 → 322 → 357 → 358). Cada camada é aditiva e testada, mas a cadeia
-- já cobra leitura. Upgrade: ao mexer no import de novo, colapsar as camadas
-- numa definição única de `import_bl_freight_transactional` e aposentar os
-- `_legacy_*`, que não têm chamador fora desta cadeia.

ALTER FUNCTION public.import_bl_freight_transactional(JSONB, UUID)
  RENAME TO import_bl_freight_transactional_legacy_357;

REVOKE ALL ON FUNCTION public.import_bl_freight_transactional_legacy_357(JSONB, UUID)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional(p_bls JSONB, p_changed_by UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result JSONB;
  v_item JSONB;
  v_bl_id TEXT;
  v_next TEXT[];
  v_current TEXT[];
BEGIN
  v_result := public.import_bl_freight_transactional_legacy_357(p_bls, p_changed_by);

  FOR v_item IN SELECT item FROM jsonb_array_elements(COALESCE(p_bls, '[]'::JSONB)) AS item
  LOOP
    v_bl_id := v_item->>'id';
    CONTINUE WHEN v_bl_id IS NULL;

    v_next := public.normalize_ncm_codes(v_item->'ncm_codes');

    -- O documento não declarar NCM não é o mesmo que declarar que não há NCM:
    -- só grava quando veio código, para nunca apagar o cadastro manual feito
    -- para a manifestação no Mercante.
    CONTINUE WHEN cardinality(v_next) = 0;

    SELECT ncm_codes INTO v_current FROM public.bls WHERE id = v_bl_id;
    CONTINUE WHEN NOT FOUND;
    CONTINUE WHEN v_current = v_next;

    UPDATE public.bls SET ncm_codes = v_next WHERE id = v_bl_id;

    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES (
      'bl',
      v_bl_id,
      'ncm_codes',
      array_to_string(COALESCE(v_current, ARRAY[]::TEXT[]), ', '),
      array_to_string(v_next, ', '),
      p_changed_by,
      'NCM declarado no documento reimportado'
    );
  END LOOP;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_bl_freight_transactional(JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bl_freight_transactional(JSONB, UUID) TO authenticated;


-- ---------------------------------------------------------------------------
-- Carga solta: NCM vem dos itens, não da descrição (que descarta as linhas NCM)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.import_breakbulk_manifest_transactional(
  p_filename TEXT,
  p_voyage_id BIGINT,
  p_uploaded_by UUID,
  p_total_bls INTEGER,
  p_bls JSONB,
  p_items JSONB,
  p_errors JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_batch_id BIGINT;
  v_bl_ids TEXT[];
BEGIN
  v_batch_id := public.import_manifest_transactional(
    p_filename,
    p_voyage_id,
    p_uploaded_by,
    'carga_solta',
    NULL,
    p_total_bls,
    0,
    COALESCE(p_bls, '[]'::jsonb),
    '[]'::jsonb,
    COALESCE(p_errors, '[]'::jsonb)
  );

  UPDATE public.bls AS target
  SET
    ce_mercante = CASE
      WHEN source.row ? 'ce_mercante' THEN NULLIF(source.row->>'ce_mercante', '')
      ELSE target.ce_mercante
    END,
    notify_party = NULLIF(source.row->>'notify_party', ''),
    bb_machine_qty = NULLIF(source.row->>'bb_machine_qty', '')::NUMERIC,
    bb_packages_qty = NULLIF(source.row->>'bb_packages_qty', '')::NUMERIC,
    bb_packages_total = NULLIF(source.row->>'bb_packages_total', '')::NUMERIC,
    bb_weight_ton = NULLIF(source.row->>'bb_weight_ton', '')::NUMERIC,
    -- NCM lido dos itens do manifesto (migration 358). A descrição de carga
    -- solta descarta as linhas "NCM NUMBER" e guarda só os 3 primeiros itens,
    -- então o código precisa vir do texto completo dos itens, não dela.
    -- Vazio preserva o cadastro manual.
    ncm_codes = CASE
      WHEN cardinality(public.normalize_ncm_codes(source.row->'ncm_codes')) > 0
        THEN public.normalize_ncm_codes(source.row->'ncm_codes')
      ELSE target.ncm_codes
    END
  FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS source(row)
  WHERE target.id = source.row->>'id';

  SELECT COALESCE(array_agg(source.row->>'id'), ARRAY[]::TEXT[])
  INTO v_bl_ids
  FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS source(row);

  IF cardinality(v_bl_ids) > 0 THEN
    DELETE FROM public.bl_breakbulk_items
    WHERE bl_id = ANY(v_bl_ids);
  END IF;

  INSERT INTO public.bl_breakbulk_items (
    bl_id,
    item_description,
    package_qty,
    package_unit,
    gross_weight_kg,
    cbm,
    marks
  )
  SELECT
    source.row->>'bl_id',
    source.row->>'item_description',
    COALESCE(NULLIF(source.row->>'package_qty', '')::NUMERIC, 0),
    NULLIF(source.row->>'package_unit', ''),
    COALESCE(NULLIF(source.row->>'gross_weight_kg', '')::NUMERIC, 0),
    COALESCE(NULLIF(source.row->>'cbm', '')::NUMERIC, 0),
    NULLIF(source.row->>'marks', '')
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS source(row);

  IF cardinality(v_bl_ids) > 0 THEN
    PERFORM public.apply_bl_review_gate_after_import(v_bl_ids, p_uploaded_by);
  END IF;

  RETURN jsonb_build_object('batch_id', v_batch_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.import_breakbulk_manifest_transactional(
  TEXT, BIGINT, UUID, INTEGER, JSONB, JSONB, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_breakbulk_manifest_transactional(
  TEXT, BIGINT, UUID, INTEGER, JSONB, JSONB, JSONB
) TO authenticated;
