-- 317: onboarding transacional de cliente a partir da revisão manual.
-- Rollback: remover as funções desta migration e restaurar o wrapper de
-- importação da migration 284 em banco descartável; não desfazer sobre dados
-- de clientes, contatos ou vínculos já confirmados.

CREATE OR REPLACE FUNCTION public.ensure_customer_contact_email(
  p_customer_id BIGINT,
  p_email TEXT,
  p_contact_name TEXT DEFAULT 'Contato manifesto',
  p_purpose TEXT DEFAULT 'financeiro'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_email TEXT := lower(NULLIF(btrim(COALESCE(p_email, '')), ''));
  v_inserted BOOLEAN := false;
BEGIN
  IF p_customer_id IS NULL OR v_email IS NULL THEN
    RETURN false;
  END IF;

  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'E-mail inválido.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
  SELECT p_customer_id, COALESCE(NULLIF(btrim(p_contact_name), ''), 'Contato manifesto'), v_email,
         COALESCE(NULLIF(btrim(p_purpose), ''), 'financeiro'), false
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.customer_contacts AS cc
    WHERE cc.customer_id = p_customer_id
      AND lower(btrim(COALESCE(cc.email, ''))) = v_email
  );

  v_inserted := FOUND;
  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_customer_contact_email(BIGINT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.extract_review_cnpjs_from_text(p_text TEXT)
RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_match TEXT;
  v_value TEXT;
  v_result TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NULLIF(p_text, '') IS NULL THEN
    RETURN v_result;
  END IF;

  FOR v_match IN
    SELECT match[1]
    FROM regexp_matches(
      p_text,
      '\mCNPJ\M[[:space:]]*[:-]?[[:space:]]*([0-9A-Z]{2}[./][0-9A-Z]{3}[./][0-9A-Z]{3}/[0-9A-Z]{4}-[0-9]{2}|[0-9A-Z]{14})([^0-9A-Z]|$)',
      'gi'
    ) AS match
  LOOP
    v_value := public.normalize_cnpj(v_match);
    IF v_value IS NOT NULL
       AND public.is_valid_cnpj(v_value)
       AND NOT (v_value = ANY(v_result)) THEN
      v_result := array_append(v_result, v_value);
    END IF;
  END LOOP;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.extract_review_cnpjs_from_text(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.review_bl_document_candidates(
  p_manifest_cnpj TEXT,
  p_consignee_block TEXT,
  p_cargo_description TEXT
)
RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result TEXT[] := ARRAY[]::TEXT[];
  v_value TEXT;
BEGIN
  v_value := public.normalize_cnpj(p_manifest_cnpj);
  IF v_value IS NOT NULL AND public.is_valid_cnpj(v_value) THEN
    v_result := array_append(v_result, v_value);
  END IF;

  FOREACH v_value IN ARRAY public.extract_review_cnpjs_from_text(p_consignee_block)
  LOOP
    IF NOT (v_value = ANY(v_result)) THEN v_result := array_append(v_result, v_value); END IF;
  END LOOP;

  FOREACH v_value IN ARRAY public.extract_review_cnpjs_from_text(p_cargo_description)
  LOOP
    IF NOT (v_value = ANY(v_result)) THEN v_result := array_append(v_result, v_value); END IF;
  END LOOP;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.review_bl_document_candidates(TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.complete_review_customer_group(
  p_bl_ids TEXT[],
  p_customer_id BIGINT DEFAULT NULL,
  p_cnpj_cpf TEXT DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_group_name TEXT DEFAULT NULL,
  p_changed_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_cnpj TEXT := public.normalize_cnpj(p_cnpj_cpf);
  v_name TEXT := NULLIF(btrim(p_name), '');
  v_email TEXT := lower(NULLIF(btrim(p_email), ''));
  v_customer public.customers%ROWTYPE;
  v_bl public.bls%ROWTYPE;
  v_candidates TEXT[];
  v_reasons TEXT[];
  v_human_notes TEXT;
  v_notes TEXT;
  v_bls JSONB := '[]'::JSONB;
  v_missing INTEGER := 0;
  v_requested_count INTEGER := 0;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para concluir o grupo.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(cardinality(p_bl_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado para o grupo.' USING ERRCODE = '22023';
  END IF;
  IF v_cnpj IS NULL OR NOT public.is_valid_cnpj(v_cnpj) THEN
    RAISE EXCEPTION 'Informe um CNPJ válido antes de vincular o grupo.' USING ERRCODE = '22023';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Informe a razão social do cliente.' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Informe um e-mail válido para o cliente.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_requested_count
  FROM (
    SELECT b.id
    FROM public.bls AS b
    WHERE b.id = ANY(p_bl_ids)
      AND b.review_status = 'pending_review'
    ORDER BY b.id
    FOR UPDATE
  ) AS locked_bls;

  IF EXISTS (SELECT 1 FROM unnest(p_bl_ids) AS requested(id) WHERE requested.id IS NULL OR btrim(requested.id) = '')
     OR v_requested_count <> cardinality(p_bl_ids) THEN
    RAISE EXCEPTION 'Um ou mais B/Ls não estão mais pendentes de revisão.' USING ERRCODE = 'PT409';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM public.customers WHERE id = p_customer_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cliente selecionado não foi encontrado.' USING ERRCODE = 'P0002';
    END IF;
    IF public.normalize_cnpj(v_customer.cnpj_cpf) IS DISTINCT FROM v_cnpj THEN
      RAISE EXCEPTION 'O CNPJ informado não corresponde ao cliente selecionado.' USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT * INTO v_customer FROM public.customers WHERE public.normalize_cnpj(cnpj_cpf) = v_cnpj FOR UPDATE;
    IF NOT FOUND THEN
      BEGIN
        INSERT INTO public.customers (cnpj_cpf, name)
        VALUES (v_cnpj, v_name)
        RETURNING * INTO v_customer;
      EXCEPTION WHEN unique_violation THEN
        SELECT * INTO v_customer FROM public.customers WHERE public.normalize_cnpj(cnpj_cpf) = v_cnpj FOR UPDATE;
        IF NOT FOUND THEN RAISE; END IF;
      END;
    END IF;
  END IF;

  FOR v_bl IN
    SELECT * FROM public.bls WHERE id = ANY(p_bl_ids) ORDER BY id FOR UPDATE
  LOOP
    v_candidates := public.review_bl_document_candidates(
      v_bl.manifest_customer_cnpj_cpf,
      v_bl.consignee_block,
      v_bl.cargo_description
    );

    IF cardinality(v_candidates) > 1
       AND NOT (cardinality(p_bl_ids) = 1 AND v_cnpj = ANY(v_candidates)) THEN
      RAISE EXCEPTION 'O B/L % contém CNPJs conflitantes nas evidências.', v_bl.id USING ERRCODE = 'PT409';
    END IF;
    IF cardinality(v_candidates) = 1 AND v_cnpj <> v_candidates[1] THEN
      RAISE EXCEPTION 'O CNPJ do B/L % não corresponde ao grupo informado.', v_bl.id USING ERRCODE = 'PT409';
    END IF;

    PERFORM public.ensure_customer_contact_email(v_customer.id, v_email);

    UPDATE public.bls
    SET customer_id = v_customer.id,
        customer_reconciliation_status = 'reconciled',
        customer_reconciliation_notes = 'Cliente cadastrado/vinculado pela revisão manual por grupo.',
        suggested_customer_id = NULL
    WHERE id = v_bl.id;

    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', v_bl.id, 'customer_id', v_bl.customer_id::TEXT, v_customer.id::TEXT, v_actor,
            'Onboarding transacional de cliente pela revisão manual.');

    v_reasons := public.compute_bl_review_pendencies(v_bl.id);
    v_human_notes := btrim(
      regexp_replace(
        COALESCE(v_bl.notes, ''),
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

    UPDATE public.bls
    SET review_status = CASE WHEN COALESCE(cardinality(v_reasons), 0) = 0 THEN 'reviewed' ELSE 'pending_review' END,
        notes = v_notes
    WHERE id = v_bl.id;

    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl.id);

    IF COALESCE(cardinality(v_reasons), 0) > 0 THEN v_missing := v_missing + 1; END IF;
    v_bls := v_bls || jsonb_build_array(jsonb_build_object(
      'bl_id', v_bl.id,
      'review_status', CASE WHEN COALESCE(cardinality(v_reasons), 0) = 0 THEN 'reviewed' ELSE 'pending_review' END,
      'pendencias', to_jsonb(v_reasons),
      'resolved', COALESCE(cardinality(v_reasons), 0) = 0
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'customer', jsonb_build_object('id', v_customer.id, 'cnpj_cpf', v_customer.cnpj_cpf, 'name', v_customer.name),
    'bls', v_bls,
    'pending_count', v_missing
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_review_customer_group(TEXT[], BIGINT, TEXT, TEXT, TEXT, TEXT, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_review_customer_group(TEXT[], BIGINT, TEXT, TEXT, TEXT, TEXT, UUID)
  TO authenticated;

ALTER FUNCTION public.import_bl_freight_transactional(JSONB, UUID)
  RENAME TO import_bl_freight_transactional_legacy_284;

REVOKE ALL ON FUNCTION public.import_bl_freight_transactional_legacy_284(JSONB, UUID)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional(p_bls JSONB, p_changed_by UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result JSONB;
  v_bl_id TEXT;
  v_email TEXT;
  v_customer_id BIGINT;
  v_ids TEXT[] := ARRAY[]::TEXT[];
BEGIN
  v_result := public.import_bl_freight_transactional_legacy_284(p_bls, p_changed_by);

  UPDATE public.bls AS b
  SET suggested_customer_id = NULLIF(item->>'suggested_customer_id', '')::BIGINT
  FROM jsonb_array_elements(COALESCE(p_bls, '[]'::JSONB)) AS item
  WHERE b.id = item->>'id';

  FOR v_bl_id, v_email IN
    SELECT item->>'id', NULLIF(btrim(item->>'manifest_customer_email'), '')
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::JSONB)) AS item
    WHERE item->>'id' IS NOT NULL
  LOOP
    v_ids := array_append(v_ids, v_bl_id);
    IF v_email IS NOT NULL THEN
      SELECT customer_id INTO v_customer_id FROM public.bls WHERE id = v_bl_id;
      IF v_customer_id IS NOT NULL THEN
        PERFORM public.ensure_customer_contact_email(v_customer_id, v_email);
      END IF;
    END IF;
  END LOOP;

  PERFORM public.apply_bl_review_gate_after_import(v_ids, p_changed_by);

  FOREACH v_bl_id IN ARRAY v_ids
  LOOP
    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl_id);
  END LOOP;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_bl_freight_transactional(JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bl_freight_transactional(JSONB, UUID) TO authenticated;
