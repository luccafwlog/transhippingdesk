-- 016: metadados de import atomicos + conflito de omissao (S04).
--
-- P2-01: metadados/batch do BL na mesma transacao do nucleo, preservando a
-- cadeia _legacy_357/322/284/205 via import_bl_freight_transactional.
-- Batch continua opcional (ADR 0017): p_batch NULL = B/L avulso.
-- P3-01: omit_voyage_escala serializa por viagem e traduz so a constraint
-- esperada (voyage_omissions_voyage_id_omitted_pod_key); outra unique_violation
-- propaga.
-- Cliente: cadastro por cliente em transacao unica (upsert + contatos +
-- vinculo de B/Ls); falha de um cliente nao desfaz os ja aplicados.
-- CE: planilha = resultado por B/L (apply_ce_mercante_update ja atomico por
-- B/L); EDI = conjunto atomico existente; ambos passam a persistir gatilho
-- recuperavel S05 na mesma transacao.

-- ---------------------------------------------------------------------------
-- 1. BL com metadados atomicos (wrapper; nao reescreve o nucleo legado).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_bl_freight_with_metadata(
  p_bls jsonb,
  p_changed_by uuid,
  p_batch jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_batch_id bigint := NULL;
  v_filename text;
  v_voyage_id bigint;
  v_cargo_mode text := 'container';
  v_total_bls integer;
  v_bl_id text;
  v_mismatch integer := 0;
  v_updated integer := 0;
  v_action_id uuid := gen_random_uuid();
  v_item jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_bls IS NULL OR jsonb_typeof(p_bls) <> 'array' OR jsonb_array_length(p_bls) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado.' USING ERRCODE = '22023';
  END IF;

  -- Nucleo existente primeiro (preserva _legacy_357/322/284/205 + NCM + alertas).
  v_result := public.import_bl_freight_transactional(p_bls, p_changed_by);

  -- Sem batch: B/L avulso continua valido (ADR 0017).
  IF p_batch IS NULL THEN
    RETURN jsonb_build_object('result', v_result, 'batch_id', NULL);
  END IF;

  v_filename := NULLIF(btrim(COALESCE(p_batch->>'filename', '')), '');
  v_voyage_id := NULLIF(btrim(COALESCE(p_batch->>'voyage_id', '')), '')::bigint;
  v_cargo_mode := COALESCE(NULLIF(btrim(COALESCE(p_batch->>'cargo_mode', '')), ''), 'container');
  IF v_filename IS NULL OR v_voyage_id IS NULL THEN
    RAISE EXCEPTION 'Batch invalido: filename e voyage_id obrigatorios.' USING ERRCODE = '22023';
  END IF;
  IF v_cargo_mode NOT IN ('container', 'carga_solta') THEN
    RAISE EXCEPTION 'cargo_mode de batch invalido.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.voyages WHERE id = v_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem % nao encontrada', v_voyage_id USING ERRCODE = 'P0002';
  END IF;

  -- Todos os B/Ls do lote precisam pertencer a viagem do batch.
  SELECT count(*) INTO v_mismatch
  FROM jsonb_array_elements(p_bls) AS item
  WHERE (item->>'voyage_id')::bigint IS DISTINCT FROM v_voyage_id;
  IF v_mismatch > 0 THEN
    RAISE EXCEPTION 'Batch da viagem % com B/L de outra viagem.', v_voyage_id USING ERRCODE = '22023';
  END IF;

  v_total_bls := jsonb_array_length(p_bls);

  INSERT INTO public.import_batches(
    filename, voyage_id, cargo_mode, uploaded_by, status, total_bls, total_containers
  ) VALUES (
    v_filename, v_voyage_id, v_cargo_mode, v_actor, 'completed', v_total_bls, NULL
  ) RETURNING id INTO v_batch_id;

  -- Vinculo no mesmo commit; divergencia aborta a unidade inteira.
  UPDATE public.bls AS b
    SET batch_id = v_batch_id
    FROM jsonb_array_elements(p_bls) AS item
    WHERE b.id = item->>'id' AND b.voyage_id = v_voyage_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> v_total_bls THEN
    RAISE EXCEPTION 'Vinculo de batch falhou: % de % B/Ls vinculados.', v_updated, v_total_bls USING ERRCODE = 'P0002';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_bls)
  LOOP
    v_bl_id := v_item->>'id';
    CONTINUE WHEN v_bl_id IS NULL;
    INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by)
    VALUES (v_action_id, 'provisional_charges', v_bl_id, v_actor)
    ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object('result', v_result, 'batch_id', v_batch_id);
END;
$$;

REVOKE ALL ON FUNCTION public.import_bl_freight_with_metadata(jsonb, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_bl_freight_with_metadata(jsonb, uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Cliente por cliente: cadastro + contatos + vinculo de B/Ls numa transacao.
-- Preserva unicidade (cnpj_cpf), soft-delete via active/deactivated (indice +
-- checks existentes abortam a unidade) e snapshots da ADR 0064 (sem reescrever
-- historico: contatos existentes nao sao apagados aqui).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_customer_base_row_atomic(
  p_cnpj text,
  p_name text,
  p_trade_name text,
  p_address text,
  p_city text,
  p_state text,
  p_zip text,
  p_emails jsonb,
  p_changed_by uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_cnpj text := NULLIF(btrim(COALESCE(p_cnpj, '')), '');
  v_name text := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_customer_id bigint;
  v_created boolean := false;
  v_email text;
  v_norm text;
  v_seen text[] := ARRAY[]::text[];
  v_contacts_created integer := 0;
  v_bls_linked integer := 0;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_cnpj IS NULL OR v_name IS NULL THEN
    RAISE EXCEPTION 'CNPJ e razao social obrigatorios.' USING ERRCODE = '22023';
  END IF;
  IF p_emails IS NULL OR jsonb_typeof(p_emails) <> 'array' OR jsonb_array_length(p_emails) = 0 THEN
    RAISE EXCEPTION 'Ao menos um e-mail obrigatorio.' USING ERRCODE = '22023';
  END IF;

  -- Lock por cliente: serializa concorrentes do mesmo CNPJ.
  SELECT id INTO v_customer_id FROM public.customers WHERE cnpj_cpf = v_cnpj FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.customers(
      cnpj_cpf, name, trade_name, address, city, state, zip, notes, pending_balance
    ) VALUES (
      v_cnpj, v_name,
      NULLIF(btrim(COALESCE(p_trade_name, '')), ''),
      NULLIF(btrim(COALESCE(p_address, '')), ''),
      NULLIF(btrim(COALESCE(p_city, '')), ''),
      NULLIF(upper(btrim(COALESCE(p_state, ''))), ''),
      NULLIF(btrim(COALESCE(p_zip, '')), ''),
      NULL, 0
    ) RETURNING id INTO v_customer_id;
    v_created := true;
  ELSE
    UPDATE public.customers
      SET name = v_name,
          trade_name = COALESCE(NULLIF(btrim(COALESCE(p_trade_name, '')), ''), trade_name),
          address = COALESCE(NULLIF(btrim(COALESCE(p_address, '')), ''), address),
          city = COALESCE(NULLIF(btrim(COALESCE(p_city, '')), ''), city),
          state = COALESCE(NULLIF(upper(btrim(COALESCE(p_state, ''))), ''), state),
          zip = COALESCE(NULLIF(btrim(COALESCE(p_zip, '')), ''), zip),
          updated_at = now()
      WHERE id = v_customer_id;
  END IF;

  -- Contatos: valida formato e duplicata no envio; existente e no-op.
  -- Falha aqui aborta so este cliente (unicidade/primary via indices).
  FOR v_email IN SELECT value #>> '{}' FROM jsonb_array_elements(p_emails)
  LOOP
    v_norm := lower(NULLIF(btrim(COALESCE(v_email, '')), ''));
    IF v_norm IS NULL OR v_norm !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'E-mail invalido para o cliente %: %', v_cnpj, COALESCE(v_email, '') USING ERRCODE = '22023';
    END IF;
    IF v_norm = ANY (v_seen) THEN
      RAISE EXCEPTION 'E-mail duplicado no envio: %', v_norm USING ERRCODE = '23505';
    END IF;
    v_seen := array_append(v_seen, v_norm);

    INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
    SELECT v_customer_id, v_name, v_norm, 'financeiro', false
    WHERE NOT EXISTS (
      SELECT 1 FROM public.customer_contacts AS cc
      WHERE cc.customer_id = v_customer_id
        AND lower(btrim(COALESCE(cc.email, ''))) = v_norm
    );
    IF FOUND THEN
      v_contacts_created := v_contacts_created + 1;
    END IF;
  END LOOP;

  -- Vinculo retroativo: so B/Ls ainda sem cliente, mesmo CNPJ.
  UPDATE public.bls AS b
    SET customer_id = v_customer_id
    WHERE b.manifest_customer_cnpj_cpf = v_cnpj
      AND b.customer_id IS NULL;
  GET DIAGNOSTICS v_bls_linked = ROW_COUNT;

  RETURN jsonb_build_object(
    'customer_id', v_customer_id,
    'created', v_created,
    'contacts_created', v_contacts_created,
    'bls_linked', v_bls_linked
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_customer_base_row_atomic(text, text, text, text, text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_customer_base_row_atomic(text, text, text, text, text, text, text, jsonb, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. CE planilha (por B/L) e EDI (conjunto): mesma logica, mais gatilho S05.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_ce_mercante_update(
  p_bl_id text, p_new_ce text, p_changed_by uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_old_ce TEXT;
  v_result TEXT;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT ce_mercante INTO v_old_ce FROM public.bls WHERE id = p_bl_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BL % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_old_ce, '') = COALESCE(p_new_ce, '') THEN
    RETURN 'unchanged';
  END IF;

  UPDATE public.bls SET ce_mercante = p_new_ce WHERE id = p_bl_id;

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value, changed_by, justification
  ) VALUES (
    'bl', p_bl_id, 'ce_mercante',
    COALESCE(v_old_ce, ''), COALESCE(p_new_ce, ''),
    v_actor,
    'Importacao CE Mercante'
  );

  IF v_old_ce IS NOT NULL AND v_old_ce <> '' THEN
    v_result := 'overwritten';
  ELSE
    v_result := 'inserted';
  END IF;

  INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by)
  VALUES (gen_random_uuid(), 'local_billing', p_bl_id, v_actor)
  ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_ce_mercante_update(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.apply_ce_mercante_update(text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_ce_mercante_manifest(
  p_rows jsonb, p_changed_by uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_errors JSONB := '[]'::JSONB;
  v_part JSONB;
  v_batches BIGINT[];
  v_batch_id BIGINT;
  v_inserted INT := 0;
  v_overwritten INT := 0;
  v_unchanged INT := 0;
  v_old_ce TEXT;
  v_action_id uuid := gen_random_uuid();
  r RECORD;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Nenhum registro de CE Mercante informado' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'bl_id', d.bl_id,
           'message', 'BL ' || d.bl_id || ' repetido no arquivo (mais de um CE).')), '[]'::JSONB)
    INTO v_part
  FROM (
    SELECT bl_id FROM jsonb_to_recordset(p_rows) AS t(bl_id TEXT, ce TEXT)
    GROUP BY bl_id HAVING count(*) > 1
  ) d;
  v_errors := v_errors || v_part;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'ce', d.ce,
           'message', 'CE Mercante ' || d.ce || ' duplicado no arquivo.')), '[]'::JSONB)
    INTO v_part
  FROM (
    SELECT ce FROM jsonb_to_recordset(p_rows) AS t(bl_id TEXT, ce TEXT)
    GROUP BY ce HAVING count(*) > 1
  ) d;
  v_errors := v_errors || v_part;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'bl_id', t.bl_id,
           'message', 'CE Mercante invalido para o BL ' || t.bl_id || ': esperado 15 digitos.')), '[]'::JSONB)
    INTO v_part
  FROM jsonb_to_recordset(p_rows) AS t(bl_id TEXT, ce TEXT)
  WHERE t.ce !~ '^[0-9]{15}$';
  v_errors := v_errors || v_part;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'bl_id', f.bl_id,
           'message', 'BL ' || f.bl_id || ' nao encontrado no sistema.')), '[]'::JSONB)
    INTO v_part
  FROM (SELECT DISTINCT bl_id FROM jsonb_to_recordset(p_rows) AS t(bl_id TEXT, ce TEXT)) f
  LEFT JOIN public.bls b ON b.id = f.bl_id
  WHERE b.id IS NULL;
  v_errors := v_errors || v_part;

  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_errors);
  END IF;

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
      v_actor,
      'Importacao CE Mercante (EDI)'
    );

    INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by)
    VALUES (v_action_id, 'local_billing', r.bl_id, v_actor)
    ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;

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

REVOKE ALL ON FUNCTION public.apply_ce_mercante_manifest(jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.apply_ce_mercante_manifest(jsonb, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. omit_voyage_escala: serializa por viagem + captura so a constraint esperada.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omit_voyage_escala(
  p_voyage_id bigint, p_omitted_pod text, p_discharge_pod text, p_reason text,
  p_changed_by uuid,
  p_onward_vessel_name text DEFAULT NULL,
  p_onward_carrier text DEFAULT NULL,
  p_onward_voyage_number text DEFAULT NULL,
  p_onward_etd timestamptz DEFAULT NULL,
  p_onward_eta timestamptz DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_omitted TEXT := upper(btrim(COALESCE(p_omitted_pod, '')));
  v_discharge TEXT := upper(btrim(COALESCE(p_discharge_pod, '')));
  v_entity_id TEXT := p_voyage_id::text || '::' || v_omitted;
  v_omission_id BIGINT;
  v_constraint TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  IF v_omitted = '' OR v_discharge = '' THEN
    RAISE EXCEPTION 'POD omitido/descarga invalidos' USING ERRCODE = '22023';
  END IF;

  -- Serializa concorrentes da mesma viagem (por viagem/escala via lock + unique).
  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem % nao encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;

  BEGIN
    INSERT INTO public.voyage_omissions(
      voyage_id, omitted_pod, discharge_pod, reason, omitted_by,
      onward_vessel_name, onward_carrier, onward_voyage_number, onward_etd, onward_eta
    )
    VALUES (
      p_voyage_id, v_omitted, v_discharge,
      NULLIF(btrim(COALESCE(p_reason, '')), ''),
      p_changed_by,
      NULLIF(btrim(COALESCE(p_onward_vessel_name, '')), ''),
      NULLIF(btrim(COALESCE(p_onward_carrier, '')), ''),
      NULLIF(btrim(COALESCE(p_onward_voyage_number, '')), ''),
      p_onward_etd, p_onward_eta
    )
    RETURNING id INTO v_omission_id;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      -- So a constraint de omissao esperada vira duplicidade amigavel;
      -- qualquer outra unique_violation propaga (nao esconde outra constraint).
      IF v_constraint = 'voyage_omissions_voyage_id_omitted_pod_key' THEN
        RAISE EXCEPTION 'A escala da viagem % ja foi omitida para o POD %.', p_voyage_id, v_omitted
          USING ERRCODE = '23505';
      END IF;
      RAISE;
  END;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES (
    'voyage_pod_schedule', v_entity_id, 'omitted', 'false', 'true', p_changed_by,
    'Escala omitida pelo armador; carga descarregada em ' || v_discharge
  );

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES (
    'voyage', p_voyage_id::text, 'escala_omitida', v_omitted, v_discharge, p_changed_by,
    COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Omissao de escala')
  );

  INSERT INTO public.bl_transshipments(bl_id, omission_id, disposition, created_by)
  SELECT b.id, v_omission_id, 'transshipment', p_changed_by
  FROM public.bls b
  WHERE b.voyage_id = p_voyage_id
    AND upper(btrim(COALESCE(b.pod, ''))) = v_omitted
  ON CONFLICT (bl_id, omission_id) DO NOTHING;

  INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
  SELECT
    b.customer_id, b.id, 'transshipment', 'Escala omitida',
    'A escala de ' || v_omitted || ' foi omitida. A carga do B/L ' || b.id ||
      ' foi descarregada em ' || v_discharge || ' e seguira em transbordo para ' || v_omitted || '.',
    NULL
  FROM public.bls b
  WHERE b.voyage_id = p_voyage_id
    AND upper(btrim(COALESCE(b.pod, ''))) = v_omitted
    AND b.customer_id IS NOT NULL;

  RETURN v_omission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.omit_voyage_escala(bigint, text, text, text, uuid, text, text, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.omit_voyage_escala(bigint, text, text, text, uuid, text, text, text, timestamptz, timestamptz) TO authenticated;
