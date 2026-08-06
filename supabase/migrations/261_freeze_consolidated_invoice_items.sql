-- Etapa 1 do plano de faturamento (docs/plans/2026-08-06-faturamento-ajuste-completo.md,
-- ADR 0038 achado 3): faturas individuais/Granito ja congelam o detalhamento em
-- invoice_items na emissao (create_invoice_from_bls_core, migration 025). Faturas
-- consolidadas (ledger de recebiveis) nao congelavam: o detalhamento era sempre
-- reconstruido ao vivo de charge_calculations em tempo de leitura
-- (get_consolidated_invoice_item_breakdown / portal_invoice_details), o que
-- deixava recalculos posteriores do B/L mudarem o que o cliente ja viu faturado.
--
-- Esta migration passa a gravar invoice_items tambem para consolidadas, no
-- momento em que create_local_consolidated_invoice_core roda, replicando a
-- mesma logica de reconciliacao (linha detalhada por item quando a soma bate
-- com o saldo do B/L na consolidacao; senao, uma linha agregada por B/L) que
-- ja existia duplicada em get_consolidated_invoice_item_breakdown e em
-- portal_invoice_details. Depois do backfill abaixo, list_invoice_details e
-- portal_invoice_details passam a encontrar invoice_items ja preenchido e
-- usam ele sem mudanca de codigo (list_invoice_details sempre leu de
-- invoice_items; hydrateConsolidatedInvoiceDetails em services/billing.ts ja
-- tem o guard `result.items.length !== 0` para preferir o snapshot). As duas
-- reconstrucoes ao vivo (RPC e CTE do portal) ficam como rede de seguranca
-- para o caso raro de uma consolidada nao ter passado pelo backfill.

-- ---------------------------------------------------------------------------
-- 1. create_local_consolidated_invoice_core passa a congelar invoice_items
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_local_consolidated_invoice_core(
  p_customer_id bigint,
  p_receivable_ids bigint[],
  p_actor uuid DEFAULT NULL::uuid,
  p_origin text DEFAULT 'internal'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids BIGINT[];
  v_count INTEGER;
  v_invoice_id BIGINT;
  v_invoice_number TEXT;
  v_total NUMERIC(14,2);
BEGIN
  SELECT ARRAY_AGG(DISTINCT id ORDER BY id)
  INTO v_ids
  FROM UNNEST(COALESCE(p_receivable_ids, ARRAY[]::BIGINT[])) AS u(id)
  WHERE id IS NOT NULL;

  IF COALESCE(ARRAY_LENGTH(v_ids, 1), 0) < 1 THEN
    RAISE EXCEPTION 'Nenhum receivable informado para consolidar.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.bl_receivables WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;

  SELECT COUNT(*) INTO v_count FROM public.bl_receivables WHERE id = ANY(v_ids);
  IF v_count <> ARRAY_LENGTH(v_ids, 1) THEN
    RAISE EXCEPTION 'Receivable(s) inexistente(s) na selecao.' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_receivables WHERE id = ANY(v_ids) AND customer_id <> p_customer_id
  ) THEN
    RAISE EXCEPTION 'Selecao contem receivables de clientes diferentes.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_receivables
    WHERE id = ANY(v_ids) AND (status NOT IN ('open', 'partially_settled') OR balance_brl <= 0)
  ) THEN
    RAISE EXCEPTION 'Todos os receivables precisam estar abertos com saldo positivo.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_receivable_links l
    JOIN public.invoices inv ON inv.id = l.invoice_id
    WHERE l.receivable_id = ANY(v_ids)
      AND inv.invoice_type = 'consolidated'
      AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
  ) THEN
    RAISE EXCEPTION 'Um ou mais B/Ls ja estao em consolidada aberta.' USING ERRCODE = '23505';
  END IF;

  SELECT COALESCE(SUM(balance_brl), 0) INTO v_total
  FROM public.bl_receivables WHERE id = ANY(v_ids);

  INSERT INTO public.invoices (
    customer_id, bl_id, issued_at, due_date, total_brl, status, invoice_type,
    notes, total_paid_brl, balance_brl, issued_by
  )
  VALUES (
    p_customer_id, NULL, now(), NULL, v_total, 'issued', 'consolidated',
    NULL, 0, v_total, p_actor
  )
  RETURNING id, invoice_number INTO v_invoice_id, v_invoice_number;

  INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id, subtotal_brl, status, bl_snapshot)
  SELECT
    v_invoice_id, br.id, br.bl_id, br.balance_brl, 'active',
    jsonb_build_object('bl_id', br.bl_id, 'voyage_id', br.voyage_id, 'cargo_mode', br.cargo_mode, 'pol', br.pol, 'pod', br.pod)
  FROM public.bl_receivables br
  WHERE br.id = ANY(v_ids);

  -- Congela o detalhamento por item nesta consolidacao (achado 3 do ADR 0038).
  -- Mesma logica de reconciliacao que get_consolidated_invoice_item_breakdown e
  -- portal_invoice_details ja faziam ao vivo: linha por item quando a soma das
  -- linhas do B/L bate com o saldo consolidado; senao, uma linha agregada.
  WITH links AS (
    SELECT l.bl_id, l.subtotal_brl
    FROM public.invoice_receivable_links l
    WHERE l.invoice_id = v_invoice_id
  ),
  calcs AS (
    SELECT
      cc.bl_id, cc.id AS charge_calculation_id, cc.charge_table_id, cc.charge_item_id,
      cc.quantity, cc.unit_value_brl, cc.total_value_brl, cti.currency,
      cc.unit_value_usd, cc.total_value_usd, cc.calculation_key, cti.name AS charge_name
    FROM public.charge_calculations cc
    LEFT JOIN public.charge_table_items cti ON cti.id = cc.charge_item_id
    WHERE cc.bl_id IN (SELECT bl_id FROM links)
      AND COALESCE(cc.total_value_brl, 0) > 0
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt')
  ),
  bl_recon AS (
    SELECT links.bl_id, links.subtotal_brl,
      COUNT(calcs.charge_calculation_id) AS calc_count,
      COALESCE(SUM(calcs.total_value_brl), 0) AS detailed_sum
    FROM links
    LEFT JOIN calcs ON calcs.bl_id = links.bl_id
    GROUP BY links.bl_id, links.subtotal_brl
  )
  INSERT INTO public.invoice_items (
    invoice_id, charge_calculation_id, description, quantity, unit_value_brl,
    total_value_brl, bl_id, charge_table_id, charge_item_id, source, currency,
    unit_value_usd, total_value_usd, calculation_key, snapshot_payload
  )
  SELECT
    v_invoice_id, calcs.charge_calculation_id,
    CONCAT('BL ', calcs.bl_id, ' - ', COALESCE(calcs.charge_name, calcs.calculation_key, 'Linha de taxa')),
    COALESCE(calcs.quantity, 1), calcs.unit_value_brl, COALESCE(calcs.total_value_brl, 0),
    calcs.bl_id, calcs.charge_table_id, calcs.charge_item_id, 'ledger',
    COALESCE(calcs.currency, 'BRL'), calcs.unit_value_usd, calcs.total_value_usd,
    calcs.calculation_key, jsonb_build_object('reconciled', true)
  FROM calcs
  JOIN bl_recon ON bl_recon.bl_id = calcs.bl_id
  WHERE bl_recon.calc_count > 0 AND ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01
  UNION ALL
  SELECT
    v_invoice_id, NULL, CONCAT('BL ', bl_recon.bl_id, ' - Taxas locais'),
    1, bl_recon.subtotal_brl, bl_recon.subtotal_brl,
    bl_recon.bl_id, NULL, NULL, 'ledger', 'BRL', NULL, NULL, NULL,
    jsonb_build_object('reconciled', false)
  FROM bl_recon
  WHERE NOT (bl_recon.calc_count > 0 AND ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01);

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
  VALUES (v_invoice_id, 'issued', p_actor,
    jsonb_build_object('invoice_type', 'consolidated', 'receivable_count', ARRAY_LENGTH(v_ids, 1), 'total_brl', v_total, 'origin', COALESCE(p_origin, 'internal')));

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('invoice', v_invoice_id::TEXT, 'create_consolidated', NULL,
    CONCAT('invoice=', v_invoice_number, ' | receivables=', ARRAY_LENGTH(v_ids, 1), ' | total=', v_total),
    p_actor, now(),
    CASE WHEN COALESCE(p_origin, 'internal') = 'portal' THEN 'Emissao de consolidada via portal do cliente' ELSE 'Emissao de consolidada via ledger' END);

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'status', 'issued',
    'invoice_type', 'consolidated',
    'receivable_count', ARRAY_LENGTH(v_ids, 1),
    'total_brl', v_total
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Backfill: consolidadas ja emitidas ganham invoice_items reconstruido a
--    partir de charge_calculations, marcado como nao-original (snapshot_payload
--    'backfilled'). A partir daqui, novas leituras usam esse snapshot; o valor
--    fica congelado dali em diante mesmo que o motor recalcule o B/L depois.
-- ---------------------------------------------------------------------------
WITH targets AS (
  SELECT DISTINCT l.invoice_id
  FROM public.invoice_receivable_links l
  WHERE NOT EXISTS (SELECT 1 FROM public.invoice_items ii WHERE ii.invoice_id = l.invoice_id)
),
links AS (
  SELECT l.invoice_id, l.bl_id, l.subtotal_brl
  FROM public.invoice_receivable_links l
  JOIN targets t ON t.invoice_id = l.invoice_id
),
calcs AS (
  SELECT
    links.invoice_id, cc.bl_id, cc.id AS charge_calculation_id, cc.charge_table_id, cc.charge_item_id,
    cc.quantity, cc.unit_value_brl, cc.total_value_brl, cti.currency,
    cc.unit_value_usd, cc.total_value_usd, cc.calculation_key, cti.name AS charge_name
  FROM links
  JOIN public.charge_calculations cc ON cc.bl_id = links.bl_id
  LEFT JOIN public.charge_table_items cti ON cti.id = cc.charge_item_id
  WHERE COALESCE(cc.total_value_brl, 0) > 0
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt')
),
bl_recon AS (
  SELECT links.invoice_id, links.bl_id, links.subtotal_brl,
    COUNT(calcs.charge_calculation_id) AS calc_count,
    COALESCE(SUM(calcs.total_value_brl), 0) AS detailed_sum
  FROM links
  LEFT JOIN calcs ON calcs.invoice_id = links.invoice_id AND calcs.bl_id = links.bl_id
  GROUP BY links.invoice_id, links.bl_id, links.subtotal_brl
)
INSERT INTO public.invoice_items (
  invoice_id, charge_calculation_id, description, quantity, unit_value_brl,
  total_value_brl, bl_id, charge_table_id, charge_item_id, source, currency,
  unit_value_usd, total_value_usd, calculation_key, snapshot_payload
)
SELECT
  calcs.invoice_id, calcs.charge_calculation_id,
  CONCAT('BL ', calcs.bl_id, ' - ', COALESCE(calcs.charge_name, calcs.calculation_key, 'Linha de taxa')),
  COALESCE(calcs.quantity, 1), calcs.unit_value_brl, COALESCE(calcs.total_value_brl, 0),
  calcs.bl_id, calcs.charge_table_id, calcs.charge_item_id, 'ledger',
  COALESCE(calcs.currency, 'BRL'), calcs.unit_value_usd, calcs.total_value_usd,
  calcs.calculation_key, jsonb_build_object('reconciled', true, 'backfilled', true)
FROM calcs
JOIN bl_recon ON bl_recon.invoice_id = calcs.invoice_id AND bl_recon.bl_id = calcs.bl_id
WHERE bl_recon.calc_count > 0 AND ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01
UNION ALL
SELECT
  bl_recon.invoice_id, NULL, CONCAT('BL ', bl_recon.bl_id, ' - Taxas locais'),
  1, bl_recon.subtotal_brl, bl_recon.subtotal_brl,
  bl_recon.bl_id, NULL, NULL, 'ledger', 'BRL', NULL, NULL, NULL,
  jsonb_build_object('reconciled', false, 'backfilled', true)
FROM bl_recon
WHERE NOT (bl_recon.calc_count > 0 AND ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01);

-- ---------------------------------------------------------------------------
-- 3. portal_invoice_details: desacopla a montagem de v_bls (sempre reconstruida
--    de invoice_receivable_links quando invoice_bls esta vazio) da montagem de
--    v_items (so reconstroi ao vivo quando invoice_items ainda estiver vazio,
--    ou seja, nunca para consolidadas criadas depois desta migration). Antes as
--    duas dependiam do mesmo `IF v_items = '[]'`, entao uma vez invoice_items
--    passasse a vir preenchido a lista de B/Ls da consolidada sumiria do Portal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_invoice_details(p_invoice_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint := public.current_portal_customer_id();
  v_invoice JSONB;
  v_bls JSONB;
  v_items JSONB;
  v_containers JSONB;
  v_payments JSONB;
BEGIN
  SELECT TO_JSONB(i.*) || jsonb_build_object(
    'customer_name', c.name,
    'customer_cnpj_cpf', c.cnpj_cpf
  )
  INTO v_invoice
  FROM public.invoices AS i
  LEFT JOIN public.customers AS c ON c.id = i.customer_id
  WHERE i.id = p_invoice_id
    AND i.customer_id = v_customer_id;

  IF v_invoice IS NULL THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(JSONB_AGG(
    TO_JSONB(ib.*) || jsonb_build_object(
      'charge_status', b.charge_status,
      'financial_status', b.financial_status,
      'pol', b.pol,
      'pod', b.pod,
      'voyage_number', v.voyage_number,
      'vessel_name', vs.name
    )
    ORDER BY ib.id
  ), '[]'::JSONB)
  INTO v_bls
  FROM public.invoice_bls AS ib
  JOIN public.bls AS b ON b.id = ib.bl_id
  LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
  LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
  WHERE ib.invoice_id = p_invoice_id;

  IF v_bls = '[]'::JSONB THEN
    -- Consolidated ledger invoices have no invoice_bls; build the BL summary
    -- rows from the receivable links (independente de invoice_items ja estar
    -- congelado ou nao).
    SELECT COALESCE(JSONB_AGG(
      jsonb_build_object(
        'id', l.id, 'invoice_id', p_invoice_id, 'bl_id', l.bl_id,
        'charge_status_snapshot', NULL, 'financial_status_snapshot', NULL,
        'subtotal_brl', l.subtotal_brl, 'subtotal_usd', 0, 'created_at', NULL,
        'pol', l.bl_snapshot->>'pol', 'pod', l.bl_snapshot->>'pod',
        'voyage_number', v.voyage_number, 'vessel_name', vs.name
      ) ORDER BY l.id
    ), '[]'::JSONB)
    INTO v_bls
    FROM public.invoice_receivable_links AS l
    LEFT JOIN public.voyages AS v ON v.id = (l.bl_snapshot->>'voyage_id')::bigint
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    WHERE l.invoice_id = p_invoice_id;
  END IF;

  SELECT COALESCE(JSONB_AGG(TO_JSONB(ii.*) ORDER BY ii.id), '[]'::JSONB)
  INTO v_items
  FROM public.invoice_items AS ii
  WHERE ii.invoice_id = p_invoice_id;

  IF v_items = '[]'::JSONB THEN
    -- Rede de seguranca: reconstroi ao vivo se, por algum motivo, esta
    -- consolidada nao tiver passado pelo backfill (migration 261). Mesma
    -- logica de reconciliacao usada na gravacao acima.
    WITH links AS (
      SELECT l.id AS link_id, l.bl_id, COALESCE(l.subtotal_brl, 0) AS subtotal_brl
      FROM public.invoice_receivable_links AS l
      WHERE l.invoice_id = p_invoice_id
    ),
    calcs AS (
      SELECT
        cc.bl_id,
        cc.id AS charge_calculation_id,
        cc.charge_table_id,
        cc.charge_item_id,
        cc.quantity,
        cc.unit_value_brl,
        cc.total_value_brl,
        cti.currency,
        cc.unit_value_usd,
        cc.total_value_usd,
        cc.calculation_key,
        cti.name AS charge_name
      FROM public.charge_calculations AS cc
      LEFT JOIN public.charge_table_items AS cti ON cti.id = cc.charge_item_id
      WHERE cc.bl_id IN (SELECT bl_id FROM links)
        AND COALESCE(cc.total_value_brl, 0) > 0
        AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt')
    ),
    bl_recon AS (
      SELECT
        links.bl_id,
        links.subtotal_brl,
        COUNT(calcs.charge_calculation_id) AS calc_count,
        COALESCE(SUM(calcs.total_value_brl), 0) AS detailed_sum
      FROM links
      LEFT JOIN calcs ON calcs.bl_id = links.bl_id
      GROUP BY links.bl_id, links.subtotal_brl
    ),
    detailed_items AS (
      SELECT
        calcs.bl_id,
        calcs.charge_calculation_id AS sort_key,
        jsonb_build_object(
          'id', calcs.charge_calculation_id,
          'invoice_id', p_invoice_id,
          'charge_calculation_id', calcs.charge_calculation_id,
          'description', 'BL ' || calcs.bl_id || ' - ' || COALESCE(calcs.charge_name, calcs.calculation_key, 'Linha de taxa'),
          'quantity', COALESCE(calcs.quantity, 1),
          'unit_value_brl', calcs.unit_value_brl,
          'total_value_brl', COALESCE(calcs.total_value_brl, 0),
          'bl_id', calcs.bl_id,
          'manifest_id', NULL,
          'charge_table_id', calcs.charge_table_id,
          'charge_item_id', calcs.charge_item_id,
          'source', 'ledger',
          'currency', COALESCE(calcs.currency, 'BRL'),
          'unit_value_usd', calcs.unit_value_usd,
          'total_value_usd', calcs.total_value_usd
        ) AS item
      FROM calcs
      JOIN bl_recon ON bl_recon.bl_id = calcs.bl_id
      WHERE bl_recon.calc_count > 0
        AND ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01
    ),
    fallback_items AS (
      SELECT
        links.bl_id,
        links.link_id AS sort_key,
        jsonb_build_object(
          'id', links.link_id,
          'invoice_id', p_invoice_id,
          'charge_calculation_id', NULL,
          'description', 'BL ' || links.bl_id || ' - Taxas locais',
          'quantity', 1,
          'unit_value_brl', links.subtotal_brl,
          'total_value_brl', links.subtotal_brl,
          'bl_id', links.bl_id,
          'manifest_id', NULL,
          'charge_table_id', NULL,
          'charge_item_id', NULL,
          'source', 'ledger',
          'currency', 'BRL',
          'unit_value_usd', NULL,
          'total_value_usd', NULL
        ) AS item
      FROM links
      JOIN bl_recon ON bl_recon.bl_id = links.bl_id
      WHERE NOT (bl_recon.calc_count > 0 AND ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01)
    ),
    all_items AS (
      SELECT bl_id, sort_key, item FROM detailed_items
      UNION ALL
      SELECT bl_id, sort_key, item FROM fallback_items
    )
    SELECT COALESCE(JSONB_AGG(item ORDER BY bl_id, sort_key), '[]'::JSONB)
    INTO v_items
    FROM all_items;
  END IF;

  WITH inv_bls AS (
    SELECT ib.bl_id FROM public.invoice_bls AS ib WHERE ib.invoice_id = p_invoice_id
    UNION
    SELECT irl.bl_id FROM public.invoice_receivable_links AS irl
    WHERE irl.invoice_id = p_invoice_id
  )
  SELECT COALESCE(JSONB_AGG(
    jsonb_build_object(
      'id', cont.id,
      'bl_id', cont.bl_id,
      'container_number', cont.container_number,
      'type', cont.type,
      'seal_number', cont.seal_number,
      'gross_weight_kg', cont.gross_weight_kg
    ) ORDER BY cont.bl_id, cont.container_number
  ), '[]'::JSONB)
  INTO v_containers
  FROM public.bl_containers AS cont
  WHERE cont.bl_id IN (SELECT bl_id FROM inv_bls);

  SELECT COALESCE(JSONB_AGG(TO_JSONB(p.*) ORDER BY p.paid_at DESC, p.id DESC), '[]'::JSONB)
  INTO v_payments
  FROM public.payments AS p
  WHERE p.invoice_id = p_invoice_id;

  RETURN jsonb_build_object(
    'invoice', v_invoice,
    'bls', v_bls,
    'items', v_items,
    'containers', v_containers,
    'payments', v_payments
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.portal_invoice_details(bigint) TO authenticated, anon;
