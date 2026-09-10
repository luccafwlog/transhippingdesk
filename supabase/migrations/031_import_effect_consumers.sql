-- S05 — consumidores duráveis para os efeitos que ainda ficavam no browser.
--
-- A migration 025 mantém o dispatcher fail-closed para Granite e veículos.
-- Esta migration cria os consumidores SQL, move os produtores de Breakbulk,
-- Granite e veículos para a mesma transação de origem e substitui o dispatcher
-- depois que todos os símbolos já existem. O worker/cron continua inativo até
-- o rollout operacional autorizado.

-- ---------------------------------------------------------------------------
-- 1. Cálculo de Granito: snapshot atômico e fail-closed sem tarifa vigente.
-- ---------------------------------------------------------------------------
-- A migration 002 deixou a função histórica com argumento bigint, enquanto
-- granite_bls.id é uuid. Mantemos a assinatura legada para não remover um
-- símbolo potencialmente usado fora do repositório e adicionamos a sobrecarga
-- que o trigger precisa para que novos manifestos sejam realmente inseríveis.
CREATE OR REPLACE FUNCTION public.reconcile_granite_bl_review_alerts(
  p_granite_bl_id uuid,
  p_source text DEFAULT 'granite_review_gate'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_gbl public.granite_bls%ROWTYPE;
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'granite_review_gate');
BEGIN
  SELECT * INTO v_gbl
  FROM public.granite_bls
  WHERE id = p_granite_bl_id;

  IF NOT FOUND THEN
    PERFORM public.resolve_alert_item(
      'review_granite_customer_unlinked', 'granite_bl', p_granite_bl_id::text,
      'granite_bl_deleted', '{}'::jsonb
    );
    RETURN;
  END IF;

  IF v_gbl.client_id IS NULL THEN
    PERFORM public.upsert_alert_item(
      'review_granite_customer_unlinked', 'granite_bl', v_gbl.id::text,
      'Cliente não vinculado ao Granito B/L ' || COALESCE(v_gbl.bl_number, v_gbl.id::text),
      v_source,
      jsonb_build_object('granite_bl_id', v_gbl.id, 'bl_number', v_gbl.bl_number),
      '/revisao'
    );
  ELSE
    PERFORM public.resolve_alert_item(
      'review_granite_customer_unlinked', 'granite_bl', v_gbl.id::text,
      'granite_review_resolved', '{}'::jsonb
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_granite_bl_charges(
  p_bl_id uuid,
  p_actor uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl public.granite_bls%ROWTYPE;
  v_actor uuid;
  v_rate record;
  v_quantity numeric(14,6);
  v_subtotal numeric(14,2);
  v_line_count integer := 0;
  v_total numeric(14,2) := 0;
  v_charges jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR (p_actor IS NOT NULL AND p_actor IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para calcular taxas de Granito.'
      USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT * INTO v_bl
  FROM public.granite_bls
  WHERE id = p_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L Granito % nao encontrado.', p_bl_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.real_weight_kg IS NULL OR v_bl.real_weight_kg <= 0 THEN
    RAISE EXCEPTION 'B/L Granito % sem peso real positivo.', p_bl_id
      USING ERRCODE = '22023';
  END IF;

  -- A ausência de tarifa é uma pendência operacional, não uma tabela vazia.
  -- O teste ocorre antes do DELETE para preservar um snapshot anterior
  -- quando o cálculo novo não pode ser concluído.
  IF NOT EXISTS (
    SELECT 1
    FROM public.granite_rates
    WHERE active = true
      AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
      AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
  ) THEN
    RAISE EXCEPTION 'Nenhuma tarifa ativa de Granito para a data %.', CURRENT_DATE
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.granite_rates
    WHERE active = true
      AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
      AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
      AND unit_value < 0
  ) THEN
    RAISE EXCEPTION 'Existe tarifa ativa de Granito com valor negativo.'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.granite_bl_charges
  WHERE bl_id = p_bl_id;

  FOR v_rate IN
    SELECT id, description, charge_type, unit_value, currency
    FROM public.granite_rates
    WHERE active = true
      AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
      AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
    ORDER BY id
  LOOP
    v_quantity := CASE v_rate.charge_type
      WHEN 'per_kg' THEN v_bl.real_weight_kg
      WHEN 'per_ton' THEN v_bl.real_weight_kg / 1000
      WHEN 'per_bl' THEN 1
      WHEN 'fixed' THEN 1
      ELSE NULL
    END;

    IF v_quantity IS NULL THEN
      RAISE EXCEPTION 'Tipo de tarifa de Granito nao suportado: %.', v_rate.charge_type
        USING ERRCODE = '22023';
    END IF;

    v_subtotal := round(v_quantity * v_rate.unit_value, 2);

    INSERT INTO public.granite_bl_charges(
      bl_id, rate_id, description, charge_type, unit_value, quantity,
      subtotal, currency, calculated_at
    ) VALUES (
      p_bl_id, v_rate.id, v_rate.description, v_rate.charge_type,
      v_rate.unit_value, v_quantity, v_subtotal, v_rate.currency, now()
    );

    v_line_count := v_line_count + 1;
    v_total := v_total + v_subtotal;
    v_charges := v_charges || jsonb_build_array(jsonb_build_object(
      'bl_id', p_bl_id,
      'rate_id', v_rate.id,
      'description', v_rate.description,
      'charge_type', v_rate.charge_type,
      'unit_value', v_rate.unit_value,
      'quantity', v_quantity,
      'subtotal', v_subtotal,
      'currency', v_rate.currency
    ));
  END LOOP;

  UPDATE public.granite_bls
  SET charge_status = 'calculated'
  WHERE id = p_bl_id;

  RETURN jsonb_build_object(
    'granite_bl_id', p_bl_id,
    'status', 'calculated',
    'line_count', v_line_count,
    'total', v_total,
    'charges', v_charges,
    'actor_id', v_actor
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Consumidores privados da fila.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._run_import_effect_granite_billing(
  p_entity_id text,
  p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl_id uuid;
BEGIN
  IF p_entity_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'B/L Granito inválido no efeito: %.', p_entity_id
      USING ERRCODE = '22023';
  END IF;
  v_bl_id := p_entity_id::uuid;
  RETURN public.calculate_granite_bl_charges(v_bl_id, p_actor)
    || jsonb_build_object('entity_id', p_entity_id);
END;
$$;

CREATE OR REPLACE FUNCTION public._run_import_effect_vehicle_followup(
  p_entity_id text,
  p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl_id text := NULLIF(btrim(COALESCE(p_entity_id, '')), '');
  v_invoice_id bigint;
  v_cancelled_ids bigint[] := ARRAY[]::bigint[];
  v_cancel_results jsonb := '[]'::jsonb;
  v_charge_result jsonb;
BEGIN
  IF v_bl_id IS NULL THEN
    RAISE EXCEPTION 'B/L inválido no efeito de veículos.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.bls
  WHERE id = v_bl_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado para efeito de veículos.', v_bl_id
      USING ERRCODE = 'P0002';
  END IF;

  -- A permissão especial só existe dentro deste consumidor server-only. A
  -- função pública cancel_invoice continua exigindo admin para chamadas do
  -- browser; o actor da operação permanece congelado no efeito.
  PERFORM set_config('import_effects.consumer', 'vehicle_followup', true);

  FOR v_invoice_id IN
    SELECT DISTINCT inv.id
    FROM public.invoice_bls AS link
    JOIN public.invoices AS inv ON inv.id = link.invoice_id
    WHERE link.bl_id = v_bl_id
      AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue', 'paid')
    ORDER BY inv.id
  LOOP
    v_cancel_results := v_cancel_results || jsonb_build_array(
      public.cancel_invoice(
        v_invoice_id,
        'Carga de veiculos: BL isento de taxas locais.',
        p_actor
      )
    );
    v_cancelled_ids := array_append(v_cancelled_ids, v_invoice_id);
  END LOOP;

  v_charge_result := public.calculate_bl_local_charges(v_bl_id, p_actor, true);

  RETURN jsonb_build_object(
    'entity_id', v_bl_id,
    'cancelled_invoice_ids', v_cancelled_ids,
    'cancel_results', v_cancel_results,
    'charge_result', v_charge_result
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Produtores: cada import persiste o efeito na mesma transação dos dados.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_breakbulk_manifest_transactional(
  p_filename text,
  p_voyage_id bigint,
  p_uploaded_by uuid,
  p_total_bls integer,
  p_bls jsonb,
  p_items jsonb,
  p_errors jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_batch_id bigint;
  v_bl_ids text[];
  v_bl_id text;
  v_action_id uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para importar carga solta.'
      USING ERRCODE = '42501';
  END IF;

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
    bb_machine_qty = NULLIF(source.row->>'bb_machine_qty', '')::numeric,
    bb_packages_qty = NULLIF(source.row->>'bb_packages_qty', '')::numeric,
    bb_packages_total = NULLIF(source.row->>'bb_packages_total', '')::numeric,
    bb_weight_ton = NULLIF(source.row->>'bb_weight_ton', '')::numeric,
    ncm_codes = CASE
      WHEN cardinality(public.normalize_ncm_codes(source.row->'ncm_codes')) > 0
        THEN public.normalize_ncm_codes(source.row->'ncm_codes')
      ELSE target.ncm_codes
    END
  FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS source(row)
  WHERE target.id = source.row->>'id';

  SELECT COALESCE(array_agg(source.row->>'id'), ARRAY[]::text[])
  INTO v_bl_ids
  FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS source(row);

  IF cardinality(v_bl_ids) > 0 THEN
    DELETE FROM public.bl_breakbulk_items
    WHERE bl_id = ANY(v_bl_ids);
  END IF;

  INSERT INTO public.bl_breakbulk_items (
    bl_id, item_description, package_qty, package_unit,
    gross_weight_kg, cbm, marks
  )
  SELECT
    source.row->>'bl_id',
    source.row->>'item_description',
    COALESCE(NULLIF(source.row->>'package_qty', '')::numeric, 0),
    NULLIF(source.row->>'package_unit', ''),
    COALESCE(NULLIF(source.row->>'gross_weight_kg', '')::numeric, 0),
    COALESCE(NULLIF(source.row->>'cbm', '')::numeric, 0),
    NULLIF(source.row->>'marks', '')
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS source(row);

  IF cardinality(v_bl_ids) > 0 THEN
    PERFORM public.apply_bl_review_gate_after_import(v_bl_ids, p_uploaded_by);

    FOREACH v_bl_id IN ARRAY v_bl_ids LOOP
      INSERT INTO public.import_pending_effects(
        source_action_id, effect_kind, entity_id, created_by,
        source_snapshot
      ) VALUES (
        v_action_id, 'local_billing', v_bl_id, p_uploaded_by,
        jsonb_build_object(
          'filename', p_filename,
          'voyage_id', p_voyage_id,
          'cargo_mode', 'carga_solta'
        )
      )
      ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('batch_id', v_batch_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.import_granite_manifest_transactional(
  p_voyage_id bigint,
  p_vessel_voyage text,
  p_loading_port text,
  p_discharge_port text,
  p_total_bls integer,
  p_total_weight_kg numeric,
  p_uploaded_by uuid,
  p_bls jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_result jsonb;
  v_manifest_id uuid;
  v_action_id uuid := gen_random_uuid();
  v_granite_bl record;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para importar manifesto Granito.'
      USING ERRCODE = '42501';
  END IF;

  v_result := public.import_granite_manifest_transactional_legacy_136(
    p_voyage_id, p_vessel_voyage, p_loading_port, p_discharge_port,
    p_total_bls, p_total_weight_kg, p_uploaded_by, p_bls
  );
  v_manifest_id := (v_result->>'manifest_id')::uuid;

  UPDATE public.granite_bls AS g
  SET suggested_client_id = NULLIF(item->>'suggested_client_id', '')::bigint
  FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item
  WHERE g.manifest_id = v_manifest_id
    AND g.bl_number = item->>'bl_number';

  FOR v_granite_bl IN
    SELECT id, bl_number
    FROM public.granite_bls
    WHERE manifest_id = v_manifest_id
    ORDER BY id
  LOOP
    INSERT INTO public.import_pending_effects(
      source_action_id, effect_kind, entity_id, created_by,
      source_snapshot
    ) VALUES (
      v_action_id, 'granite_billing', v_granite_bl.id::text, p_uploaded_by,
      jsonb_build_object(
        'manifest_id', v_manifest_id,
        'bl_number', v_granite_bl.bl_number,
        'voyage_id', p_voyage_id
      )
    )
    ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
  END LOOP;

  RETURN v_result;
END;
$$;

-- B/Ls importados com batch precisam primeiro aplicar as flags físicas do
-- Baplie e só depois calcular as taxas provisórias. Os dois efeitos nascem
-- nesta transação; o segundo carrega a dependência explícita do primeiro.
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
  v_physical_effect jsonb;
  v_physical_effect_id bigint;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_bls IS NULL OR jsonb_typeof(p_bls) <> 'array' OR jsonb_array_length(p_bls) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado.' USING ERRCODE = '22023';
  END IF;

  v_result := public.import_bl_freight_transactional(p_bls, p_changed_by);

  -- Sem batch, B/L avulso continua valido; não há uma viagem confiável para
  -- construir o efeito físico ou o cálculo provisório.
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

  UPDATE public.bls AS b
    SET batch_id = v_batch_id
    FROM jsonb_array_elements(p_bls) AS item
    WHERE b.id = item->>'id' AND b.voyage_id = v_voyage_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> v_total_bls THEN
    RAISE EXCEPTION 'Vinculo de batch falhou: % de % B/Ls vinculados.', v_updated, v_total_bls USING ERRCODE = 'P0002';
  END IF;

  v_physical_effect := public.enqueue_import_effect(
    v_action_id,
    'physical_flags',
    v_voyage_id::text,
    v_actor,
    1,
    NULL,
    jsonb_build_object(
      'filename', v_filename,
      'voyage_id', v_voyage_id,
      'cargo_mode', v_cargo_mode,
      'bl_count', v_total_bls
    )
  );
  v_physical_effect_id := NULLIF(v_physical_effect->'effect'->>'id', '')::bigint;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_bls)
  LOOP
    v_bl_id := v_item->>'id';
    CONTINUE WHEN v_bl_id IS NULL;
    PERFORM public.enqueue_import_effect(
      v_action_id,
      'provisional_charges',
      v_bl_id,
      v_actor,
      1,
      v_physical_effect_id,
      jsonb_build_object(
        'filename', v_filename,
        'voyage_id', v_voyage_id,
        'cargo_mode', v_cargo_mode
      )
    );
  END LOOP;

  RETURN jsonb_build_object('result', v_result, 'batch_id', v_batch_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.import_vehicle_rows_transactional(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count integer := COALESCE(jsonb_array_length(p_rows), 0);
  v_action_id uuid := gen_random_uuid();
  v_bl_id text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para importar veiculos.'
      USING ERRCODE = '42501';
  END IF;
  IF v_count = 0 THEN RETURN 0; END IF;

  INSERT INTO public.vehicles(
    voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm
  )
  SELECT row.voyage_id, row.container_id, row.bl_id, row.chassis,
         row.brand, row.model, row.weight_kg, row.cbm
  FROM jsonb_to_recordset(p_rows) AS row(
    voyage_id bigint,
    container_id bigint,
    bl_id text,
    chassis text,
    brand text,
    model text,
    weight_kg numeric,
    cbm numeric
  );

  UPDATE public.bl_containers AS c
  SET unpacking_location = NULLIF(trim(row.unpacking_location), '')
  FROM jsonb_to_recordset(p_rows) AS row(
    container_id bigint,
    unpacking_location text
  )
  WHERE c.id = row.container_id AND row.unpacking_location IS NOT NULL;

  FOR v_bl_id IN
    SELECT DISTINCT NULLIF(trim(row.bl_id), '')
    FROM jsonb_to_recordset(p_rows) AS row(bl_id text)
    WHERE NULLIF(trim(row.bl_id), '') IS NOT NULL
    ORDER BY 1
  LOOP
    INSERT INTO public.import_pending_effects(
      source_action_id, effect_kind, entity_id, created_by,
      source_snapshot
    ) VALUES (
      v_action_id, 'vehicle_followup', v_bl_id, auth.uid(),
      jsonb_build_object('row_count', v_count, 'voyage_ids', (
        SELECT jsonb_agg(DISTINCT row.voyage_id ORDER BY row.voyage_id)
        FROM jsonb_to_recordset(p_rows) AS row(voyage_id bigint)
      ))
    )
    ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Cancelamento interno: mesma política pública, exceção estreita para o
--    consumidor vehicle_followup depois da origem já ter sido autorizada.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_invoice(
  p_invoice_id bigint,
  p_reason text,
  p_actor uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_invoice record;
  v_actor uuid;
  v_payment_count integer;
  v_effect_consumer boolean := auth.role() = 'service_role'
    AND current_setting('import_effects.consumer', true) = 'vehicle_followup';
BEGIN
  IF (
       auth.role() IS DISTINCT FROM 'service_role'
       OR current_setting('import_effects.consumer', true) IS DISTINCT FROM 'vehicle_followup'
     )
     AND (auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.'
      USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') = 'cancelled' THEN
    RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'cancelled', 'changed', false);
  END IF;

  SELECT COUNT(*) INTO v_payment_count
  FROM public.payments
  WHERE invoice_id = p_invoice_id;

  IF v_payment_count > 0 THEN
    RAISE EXCEPTION 'Nao e permitido cancelar invoice com pagamentos registrados.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices
  SET
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = v_actor,
    cancel_reason = NULLIF(TRIM(COALESCE(p_reason, '')), ''),
    balance_brl = GREATEST(COALESCE(total_brl, 0) - COALESCE(total_paid_brl, 0), 0)
  WHERE id = p_invoice_id;

  UPDATE public.billing_batches
  SET status = 'cancelled'
  WHERE invoice_id = p_invoice_id;

  UPDATE public.bls AS b
  SET financial_status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.invoice_bls AS ib2
      JOIN public.invoices AS inv2 ON inv2.id = ib2.invoice_id
      WHERE ib2.bl_id = b.id
        AND inv2.id <> p_invoice_id
        AND COALESCE(inv2.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
    ) THEN 'invoiced'
    WHEN EXISTS (
      SELECT 1
      FROM public.invoice_bls AS ib3
      JOIN public.invoices AS inv3 ON inv3.id = ib3.invoice_id
      WHERE ib3.bl_id = b.id
        AND inv3.id <> p_invoice_id
        AND COALESCE(inv3.status, 'issued') = 'paid'
    ) THEN 'paid'
    ELSE 'pending'
  END
  WHERE b.id IN (
    SELECT ib.bl_id
    FROM public.invoice_bls AS ib
    WHERE ib.invoice_id = p_invoice_id
  );

  UPDATE public.granite_bls AS gb
  SET charge_status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.invoice_granite_bls AS igb2
      JOIN public.invoices AS inv2 ON inv2.id = igb2.invoice_id
      WHERE igb2.granite_bl_id = gb.id
        AND inv2.id <> p_invoice_id
        AND COALESCE(inv2.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue', 'paid')
    ) THEN 'invoiced'
    ELSE 'ready_for_billing'
  END
  WHERE gb.id IN (
    SELECT igb.granite_bl_id
    FROM public.invoice_granite_bls AS igb
    WHERE igb.invoice_id = p_invoice_id
  );

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, changed_at, justification
  ) VALUES (
    'invoice', p_invoice_id::text, 'cancel_invoice',
    COALESCE(v_invoice.status, 'issued'), 'cancelled', v_actor, now(),
    COALESCE(NULLIF(TRIM(COALESCE(p_reason, '')), ''), 'Cancelamento de invoice')
  );

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'cancelled', 'changed', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Dispatcher S05 com os consumidores agora disponíveis.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_import_effect(
  p_effect_id bigint,
  p_worker_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_effect public.import_pending_effects%ROWTYPE;
  v_actor uuid;
  v_result jsonb;
  v_status text;
  v_error_code text;
  v_error_message text;
  v_retry_at timestamptz;
  v_sqlstate text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_effect_id IS NULL
     OR NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL
     OR char_length(p_worker_id) > 128 THEN
    RAISE EXCEPTION 'Identidade de processamento incompleta.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_effect
  FROM public.import_pending_effects
  WHERE id = p_effect_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Efeito % nao encontrado.', p_effect_id USING ERRCODE = 'P0002';
  END IF;

  IF v_effect.status IN ('succeeded', 'blocked', 'superseded') THEN
    RETURN jsonb_build_object('effect', to_jsonb(v_effect), 'idempotent', true);
  END IF;
  IF v_effect.status IS DISTINCT FROM 'running'
     OR v_effect.leased_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Lease do efeito nao pertence ao worker.' USING ERRCODE = '42501';
  END IF;
  IF v_effect.lease_until IS NULL OR v_effect.lease_until <= now() THEN
    RAISE EXCEPTION 'Lease do efeito expirou.' USING ERRCODE = '40001';
  END IF;
  IF v_effect.created_by IS NULL THEN
    RAISE EXCEPTION 'Efeito sem iniciador validado.' USING ERRCODE = '42501';
  END IF;

  v_actor := v_effect.created_by;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);

  CASE v_effect.effect_kind
    WHEN 'physical_flags' THEN
      IF v_effect.entity_id !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'Viagem invalida no efeito de flags: %.', v_effect.entity_id
          USING ERRCODE = '22023';
      END IF;
      v_result := public.apply_baplie_physical_flags_atomic(v_effect.entity_id::bigint, NULL, v_actor);
    WHEN 'provisional_charges', 'local_billing' THEN
      v_result := public._run_import_effect_local_charges(v_effect.entity_id, v_actor);
    WHEN 'granite_billing' THEN
      v_result := public._run_import_effect_granite_billing(v_effect.entity_id, v_actor);
    WHEN 'demurrage_billing' THEN
      v_result := public._run_import_effect_demurrage(v_effect.id, v_effect.entity_id, v_actor);
    WHEN 'vehicle_followup' THEN
      v_result := public._run_import_effect_vehicle_followup(v_effect.entity_id, v_actor);
    ELSE
      RAISE EXCEPTION 'effect_kind nao suportado: %.', v_effect.effect_kind
        USING ERRCODE = 'P0001';
  END CASE;

  v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'executor', 'import-effects-runner',
    'worker_id', p_worker_id,
    'initiator_id', v_actor
  );
  RETURN public.complete_import_effect(
    v_effect.id, p_worker_id, 'succeeded', v_result, NULL, NULL, NULL
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_sqlstate = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;

    v_status := CASE
      WHEN v_sqlstate IN ('40001', '40P01', '55P03') THEN 'retry_wait'
      ELSE 'blocked'
    END;
    v_error_code := CASE
      WHEN v_status = 'retry_wait' THEN 'transient_sql_error'
      WHEN v_sqlstate = '42501' THEN 'authorization_invalid'
      WHEN v_sqlstate = '22023' THEN 'invalid_effect_payload'
      WHEN v_sqlstate = 'P0002' THEN 'effect_domain_missing'
      WHEN v_sqlstate = 'P0001' THEN 'unsupported_effect_kind'
      ELSE 'effect_failed'
    END;
    IF v_status = 'retry_wait' AND v_effect.attempts >= 5 THEN
      v_status := 'blocked';
      v_error_code := 'retry_exhausted';
      v_error_message := 'Numero maximo de tentativas atingido.';
    ELSIF v_status = 'retry_wait' THEN
      v_retry_at := now() + CASE v_effect.attempts
        WHEN 1 THEN interval '1 minute'
        WHEN 2 THEN interval '5 minutes'
        WHEN 3 THEN interval '15 minutes'
        ELSE interval '60 minutes'
      END;
    END IF;

    IF v_effect.id IS NULL THEN RAISE; END IF;

    IF v_status = 'blocked' THEN
      PERFORM public._record_import_effect_blocked_alert(
        v_effect.id,
        v_effect.effect_kind,
        v_effect.entity_id,
        v_error_code,
        v_error_message
      );
    END IF;

    RETURN public.complete_import_effect(
      v_effect.id,
      p_worker_id,
      v_status,
      jsonb_build_object(
        'executor', 'import-effects-runner',
        'worker_id', p_worker_id,
        'initiator_id', v_effect.created_by,
        'sqlstate', v_sqlstate
      ),
      v_error_code,
      v_error_message,
      v_retry_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_granite_bl_charges(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_granite_bl_charges(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reconcile_granite_bl_review_alerts(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_granite_bl_review_alerts(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public._run_import_effect_granite_billing(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._run_import_effect_vehicle_followup(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_import_effect(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_import_effect(bigint, text) TO service_role;
