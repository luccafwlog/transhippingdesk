-- Renumbered from 20260619120000 (original timestamped migration: 20260619120000_review_gate_canonical_pendencies.sql).
-- Review gate canonico: pendencias derivadas de colunas/joins (nao do texto de `notes`).
--
-- Problema: `save_bl_review` aplicava cegamente o `review_status` enviado pelo
-- cliente (sempre 'reviewed'). Um B/L com varias pendencias saia da fila ao
-- corrigir apenas uma, e o `notes` nunca era recalculado -> o gate vazava.
--
-- Solucao:
--   1. `compute_bl_review_pendencies(bl)` retorna o conjunto de bloqueios a
--      partir de estado real (cliente vinculado, e-mail, portal, peso).
--   2. `save_bl_review` recomputa o `review_status` por essa funcao e so marca
--      'reviewed' quando o conjunto fica vazio; senao mantem 'pending_review'.
--      Retorna o estado recomputado para a UI nao precisar adivinhar.
--
-- Regras de bloqueio confirmadas com o produto:
--   - Cliente nao vinculado.
--   - Cliente sem nenhum e-mail cadastrado (qualquer classificacao de contato).
--   - Acesso ao portal nao provisionado/ativo (customer_portal_accounts.active).
--   - Peso BB ausente em carga solta (input necessario ao calculo de taxas).
-- CE Mercante NAO bloqueia: e necessario para exibicao no portal, mas nao e
-- inserido neste momento do fluxo, entao nunca trava a revisao.

-- ============================================================================
-- 1. Funcao canonica de pendencias
-- ============================================================================

CREATE OR REPLACE FUNCTION public.compute_bl_review_pendencies(p_bl_id TEXT)
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_reasons TEXT[] := ARRAY[]::TEXT[];
  v_has_email BOOLEAN;
  v_portal_active BOOLEAN;
BEGIN
  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND THEN
    RETURN v_reasons;
  END IF;

  IF v_bl.customer_id IS NULL THEN
    v_reasons := array_append(v_reasons, 'Cliente nao vinculado');
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.customer_contacts c
      WHERE c.customer_id = v_bl.customer_id
        AND NULLIF(btrim(c.email), '') IS NOT NULL
    ) INTO v_has_email;
    IF NOT v_has_email THEN
      v_reasons := array_append(v_reasons, 'Cliente sem e-mail cadastrado');
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.customer_portal_accounts a
      WHERE a.customer_id = v_bl.customer_id
        AND a.active = true
    ) INTO v_portal_active;
    IF NOT v_portal_active THEN
      v_reasons := array_append(v_reasons, 'Acesso ao portal nao provisionado');
    END IF;
  END IF;

  IF v_bl.cargo_mode = 'carga_solta'
     AND (v_bl.bb_weight_ton IS NULL OR v_bl.bb_weight_ton <= 0) THEN
    v_reasons := array_append(v_reasons, 'Peso BB ausente');
  END IF;

  RETURN v_reasons;
END;
$function$;

REVOKE ALL ON FUNCTION public.compute_bl_review_pendencies(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_bl_review_pendencies(TEXT) TO authenticated;

-- ============================================================================
-- 2. save_bl_review recomputa o gate e retorna o estado
--    (muda o tipo de retorno TIMESTAMPTZ -> JSONB, por isso o DROP)
-- ============================================================================

DROP FUNCTION IF EXISTS public.save_bl_review(TEXT, TIMESTAMPTZ, JSONB, JSONB, UUID);

CREATE FUNCTION public.save_bl_review(
  p_bl_id TEXT,
  p_expected_updated_at TIMESTAMPTZ,
  p_update_payload JSONB,
  p_audit_rows JSONB,
  p_changed_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_new_updated_at TIMESTAMPTZ;
  v_current_updated_at TIMESTAMPTZ;
  v_rowcount INT;
  v_reasons TEXT[];
  v_status TEXT;
  v_notes TEXT;
BEGIN
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

  -- Aplica os campos de dados. `review_status` NAO e mais aceito do payload:
  -- ele e recomputado abaixo a partir do estado real do B/L.
  UPDATE public.bls AS b
  SET
    shipper            = CASE WHEN p_update_payload ? 'shipper' THEN p_update_payload->>'shipper' ELSE b.shipper END,
    consignee          = CASE WHEN p_update_payload ? 'consignee' THEN p_update_payload->>'consignee' ELSE b.consignee END,
    notify_party       = CASE WHEN p_update_payload ? 'notify_party' THEN p_update_payload->>'notify_party' ELSE b.notify_party END,
    ce_mercante        = CASE WHEN p_update_payload ? 'ce_mercante' THEN p_update_payload->>'ce_mercante' ELSE b.ce_mercante END,
    pol                = CASE WHEN p_update_payload ? 'pol' THEN p_update_payload->>'pol' ELSE b.pol END,
    pod                = CASE WHEN p_update_payload ? 'pod' THEN p_update_payload->>'pod' ELSE b.pod END,
    place_of_delivery  = CASE WHEN p_update_payload ? 'place_of_delivery' THEN p_update_payload->>'place_of_delivery' ELSE b.place_of_delivery END,
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
    customer_id        = CASE WHEN p_update_payload ? 'customer_id' THEN NULLIF(p_update_payload->>'customer_id', '')::BIGINT ELSE b.customer_id END
  WHERE b.id = p_bl_id
    AND (p_expected_updated_at IS NULL OR b.updated_at = p_expected_updated_at);

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount = 0 THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuario; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;

  -- Recomputa o gate a partir do estado real ja atualizado.
  v_reasons := public.compute_bl_review_pendencies(p_bl_id);
  v_status := CASE WHEN COALESCE(cardinality(v_reasons), 0) = 0 THEN 'reviewed' ELSE 'pending_review' END;
  v_notes := CASE
    WHEN COALESCE(cardinality(v_reasons), 0) > 0
      THEN 'Pendencias de importacao: ' || array_to_string(v_reasons, ', ')
    ELSE NULL
  END;

  -- So gerencia `notes` quando ele e vazio ou e a string de pendencias gerada
  -- pela maquina; notas humanas digitadas na revisao sao preservadas.
  UPDATE public.bls AS b
  SET
    review_status = v_status,
    notes = CASE
      WHEN COALESCE(b.notes, '') = '' OR b.notes ILIKE 'Pendencias de importacao:%' THEN v_notes
      ELSE b.notes
    END
  WHERE b.id = p_bl_id
  RETURNING b.updated_at INTO v_new_updated_at;

  IF p_audit_rows IS NOT NULL
     AND jsonb_typeof(p_audit_rows) = 'array'
     AND jsonb_array_length(p_audit_rows) > 0 THEN
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
      a->>'justification'
    FROM jsonb_array_elements(p_audit_rows) AS a;
  END IF;

  RETURN jsonb_build_object(
    'updated_at', v_new_updated_at,
    'review_status', v_status,
    'pendencias', to_jsonb(v_reasons)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_bl_review(TEXT, TIMESTAMPTZ, JSONB, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_bl_review(TEXT, TIMESTAMPTZ, JSONB, JSONB, UUID) TO authenticated;
