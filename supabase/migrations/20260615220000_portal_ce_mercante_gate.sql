-- Portal do cliente: gate de visibilidade por CE Mercante.
--
-- O sistema interno continua podendo calcular e emitir antes do CE Mercante.
-- Este gate atua somente na fronteira do portal: listas, detalhes e acoes
-- self-service so enxergam BLs cujo ce_mercante esteja preenchido.

CREATE OR REPLACE FUNCTION public.bl_has_portal_release(p_bl_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = p_bl_id
      AND trim(coalesce(b.ce_mercante, '')) <> ''
  );
$function$;

REVOKE ALL ON FUNCTION public.bl_has_portal_release(TEXT) FROM PUBLIC;

-- ============================================================================
-- BLs e containers operacionais do portal
-- ============================================================================
CREATE OR REPLACE FUNCTION public.portal_list_operation_bls()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint := public.current_portal_customer_id();
BEGIN
  RETURN (
    WITH active_rates AS (
      SELECT DISTINCT ON (upper(trim(container_type)))
        upper(trim(container_type)) AS container_type,
        free_days
      FROM public.demurrage_rates
      WHERE active = true
        AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
        AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
      ORDER BY upper(trim(container_type)), valid_from DESC NULLS LAST, id DESC
    ),
    bl_rows AS (
      SELECT
        b.id AS bl_id,
        b.ce_mercante,
        b.pol,
        b.pod,
        b.voyage_id,
        v.voyage_number,
        vs.name AS vessel_name,
        b.free_time_override
      FROM public.bls AS b
      LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
      LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
      WHERE b.customer_id = v_customer_id AND public.bl_has_portal_release(b.id)
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'bl_id', bl.bl_id,
          'ce_mercante', bl.ce_mercante,
          'pol', bl.pol,
          'pod', bl.pod,
          'voyage_id', bl.voyage_id,
          'voyage_number', bl.voyage_number,
          'vessel_name', bl.vessel_name,
          'container_count', container_summary.container_count,
          'containers_in_demurrage', container_summary.containers_in_demurrage,
          'containers_returned', container_summary.containers_returned,
          'containers', container_summary.containers
        )
        ORDER BY bl.voyage_id DESC NULLS LAST, bl.bl_id
      ),
      '[]'::jsonb
    )
    FROM bl_rows AS bl
    LEFT JOIN LATERAL (
      WITH calculated AS (
        SELECT
          c.id,
          c.container_number,
          c.type,
          c.discharge_date,
          c.return_date,
          CASE
            WHEN c.discharge_date IS NULL THEN NULL
            ELSE GREATEST(COALESCE(c.return_date, CURRENT_DATE) - c.discharge_date, 0)
          END AS usage_days,
          CASE
            WHEN c.discharge_date IS NULL THEN NULL
            ELSE COALESCE(
              bl.free_time_override,
              ar.free_days,
              CASE
                WHEN upper(trim(COALESCE(c.type, ''))) IN ('20RF', '20RQ', '20R1', '40RF', '40RQ', '40R1', '45R1')
                  THEN 10
                ELSE 21
              END
            )
          END AS free_time_days
        FROM public.bl_containers AS c
        LEFT JOIN active_rates AS ar
          ON ar.container_type = upper(trim(COALESCE(c.type, '')))
        WHERE c.bl_id = bl.bl_id
      ),
      with_demurrage AS (
        SELECT
          calculated.*,
          CASE
            WHEN usage_days IS NULL OR free_time_days IS NULL THEN NULL
            ELSE GREATEST(usage_days - free_time_days, 0)
          END AS demurrage_days
        FROM calculated
      ),
      with_status AS (
        SELECT
          with_demurrage.*,
          CASE
            WHEN discharge_date IS NULL THEN 'sem_descarga'
            WHEN return_date IS NOT NULL THEN 'devolvido'
            WHEN COALESCE(demurrage_days, 0) > 0 THEN 'em_demurrage'
            ELSE 'dentro_free_time'
          END AS status
        FROM with_demurrage
      )
      SELECT
        COUNT(*)::int AS container_count,
        COUNT(*) FILTER (WHERE status = 'em_demurrage')::int AS containers_in_demurrage,
        COUNT(*) FILTER (WHERE status = 'devolvido')::int AS containers_returned,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', id,
              'container_number', container_number,
              'type', type,
              'discharge_date', discharge_date,
              'return_date', return_date,
              'usage_days', usage_days,
              'free_time_days', free_time_days,
              'demurrage_days', demurrage_days,
              'status', status
            )
            ORDER BY container_number
          ),
          '[]'::jsonb
        ) AS containers
      FROM with_status
    ) AS container_summary ON true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.portal_list_operation_bls() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_list_operation_bls() TO authenticated, anon;

-- ============================================================================
-- Recebiveis consolidaveis do portal
-- ============================================================================
CREATE OR REPLACE FUNCTION public.portal_list_consolidatable_receivables()
RETURNS TABLE(
  receivable_id bigint,
  bl_id text,
  customer_id bigint,
  customer_name text,
  customer_cnpj_cpf text,
  voyage_id bigint,
  vessel_name text,
  voyage_number text,
  individual_invoice_id bigint,
  individual_invoice_number text,
  balance_brl numeric,
  original_amount_brl numeric,
  receivable_status text,
  eligibility_status text,
  eligibility_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint := public.current_portal_customer_id();
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      br.id AS receivable_id,
      br.bl_id,
      br.customer_id,
      c.name AS customer_name,
      c.cnpj_cpf AS customer_cnpj_cpf,
      br.voyage_id,
      v.voyage_number,
      ve.name AS vessel_name,
      br.balance_brl,
      br.original_amount_brl,
      br.status AS receivable_status,
      indiv.invoice_id AS individual_invoice_id,
      inv_ind.invoice_number AS individual_invoice_number,
      EXISTS (
        SELECT 1
        FROM public.invoice_receivable_links irl
        JOIN public.invoices inv ON inv.id = irl.invoice_id
        WHERE irl.receivable_id = br.id
          AND inv.invoice_type = 'consolidated'
          AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
      ) AS has_open_consolidated
    FROM public.bl_receivables br
    JOIN public.customers c ON c.id = br.customer_id
    LEFT JOIN public.voyages v ON v.id = br.voyage_id
    LEFT JOIN public.vessels ve ON ve.id = v.vessel_id
    LEFT JOIN LATERAL (
      SELECT irl.invoice_id
      FROM public.invoice_receivable_links irl
      JOIN public.invoices inv ON inv.id = irl.invoice_id
      WHERE irl.receivable_id = br.id
        AND inv.invoice_type = 'individual'
      ORDER BY inv.id DESC
      LIMIT 1
    ) indiv ON TRUE
    LEFT JOIN public.invoices inv_ind ON inv_ind.id = indiv.invoice_id
    WHERE br.customer_id = v_customer_id AND br.source = 'local_charges' AND public.bl_has_portal_release(br.bl_id)
  )
  SELECT
    base.receivable_id,
    base.bl_id,
    base.customer_id,
    base.customer_name,
    base.customer_cnpj_cpf,
    base.voyage_id,
    base.vessel_name,
    base.voyage_number,
    base.individual_invoice_id,
    base.individual_invoice_number,
    base.balance_brl,
    base.original_amount_brl,
    base.receivable_status,
    CASE
      WHEN base.receivable_status = 'settled' THEN 'paid'
      WHEN base.receivable_status = 'void' THEN 'no_balance'
      WHEN base.has_open_consolidated THEN 'open_consolidated'
      WHEN base.balance_brl <= 0 THEN 'no_balance'
      ELSE 'eligible'
    END AS eligibility_status,
    CASE
      WHEN base.receivable_status = 'settled' THEN 'B/L ja liquidado.'
      WHEN base.receivable_status = 'void' THEN 'B/L sem saldo de taxas locais.'
      WHEN base.has_open_consolidated THEN 'B/L ja esta em consolidada aberta.'
      WHEN base.balance_brl <= 0 THEN 'B/L sem saldo aberto.'
      ELSE 'Elegivel para consolidacao.'
    END AS eligibility_reason
  FROM base
  ORDER BY base.voyage_id DESC NULLS LAST, base.bl_id ASC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.portal_list_consolidatable_receivables() TO authenticated, anon;

-- ============================================================================
-- Criacao de consolidada pelo portal
-- ============================================================================
CREATE OR REPLACE FUNCTION public.portal_create_consolidation(p_receivable_ids BIGINT[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_ids BIGINT[];
  v_result JSONB;
  v_invoice_id BIGINT;
BEGIN
  PERFORM public.check_portal_rate_limit('create_consolidation', 3, 10);

  SELECT ARRAY_AGG(DISTINCT id ORDER BY id)
  INTO v_ids
  FROM UNNEST(COALESCE(p_receivable_ids, ARRAY[]::BIGINT[])) AS u(id)
  WHERE id IS NOT NULL;

  IF EXISTS (
    SELECT 1
    FROM public.bl_receivables AS br
    WHERE br.id = ANY(v_ids)
      AND br.customer_id <> v_customer_id
  ) THEN
    RAISE EXCEPTION 'Selecao contem B/Ls de outro cliente.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bl_receivables AS br WHERE br.id = ANY(v_ids) AND NOT public.bl_has_portal_release(br.bl_id)
  ) THEN
    RAISE EXCEPTION 'Selecao contem B/L sem CE Mercante liberado para o portal.' USING ERRCODE = '42501';
  END IF;

  v_result := public.create_local_consolidated_invoice_core(
    v_customer_id,
    p_receivable_ids,
    auth.uid(),
    'portal'
  );

  v_invoice_id := (v_result->>'invoice_id')::BIGINT;

  INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
  VALUES (
    'portal_invoice_created',
    'invoice',
    v_invoice_id::text,
    'Cliente gerou fatura consolidada #' || v_invoice_id || ' com ' || array_length(p_receivable_ids, 1) || ' B/L(s).',
    'open'
  );

  INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
  VALUES (
    v_customer_id,
    'system',
    'Fatura consolidada criada',
    'Sua fatura consolidada foi gerada com ' || array_length(p_receivable_ids, 1) || ' B/L(s).',
    '/portal/billing'
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.portal_create_consolidation(BIGINT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_create_consolidation(BIGINT[]) TO authenticated;

-- ============================================================================
-- Lista de faturas locais do portal
-- ============================================================================
CREATE OR REPLACE FUNCTION public.portal_list_invoices()
RETURNS TABLE(
  id bigint,
  invoice_number text,
  issued_at timestamptz,
  due_date date,
  total_brl numeric,
  total_paid_brl numeric,
  balance_brl numeric,
  status text,
  invoice_type text,
  vessels text[],
  voyages text[],
  vessel_voyages text[],
  bls text[],
  pods text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint := public.current_portal_customer_id();
BEGIN
  RETURN QUERY
  WITH linked_invoice_bls AS (
    SELECT ib.invoice_id, ib.bl_id
    FROM public.invoice_bls AS ib
    UNION
    SELECT irl.invoice_id, irl.bl_id
    FROM public.invoice_receivable_links AS irl
    WHERE irl.status = 'active'
  ),
  eligible_invoices AS (
    SELECT i.id AS invoice_id
    FROM public.invoices AS i
    WHERE i.customer_id = v_customer_id
      AND EXISTS (
        SELECT 1
        FROM linked_invoice_bls AS linked
        WHERE linked.invoice_id = i.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM linked_invoice_bls AS linked
        WHERE linked.invoice_id = i.id
          AND NOT public.bl_has_portal_release(linked.bl_id)
      )
  ),
  bl_info AS (
    SELECT ib.invoice_id, ib.bl_id, b.pod, v.voyage_number, vs.name AS vessel_name
    FROM public.invoice_bls AS ib
    JOIN public.bls AS b ON b.id = ib.bl_id
    LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    UNION ALL
    SELECT irl.invoice_id, irl.bl_id, irl.bl_snapshot->>'pod', v.voyage_number, vs.name
    FROM public.invoice_receivable_links AS irl
    LEFT JOIN public.voyages AS v ON v.id = (irl.bl_snapshot->>'voyage_id')::bigint
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    WHERE irl.status = 'active'
  ),
  agg AS (
    SELECT
      bl_info.invoice_id,
      array_agg(DISTINCT bl_info.vessel_name) FILTER (WHERE bl_info.vessel_name IS NOT NULL) AS vessels,
      array_agg(DISTINCT bl_info.voyage_number) FILTER (WHERE bl_info.voyage_number IS NOT NULL) AS voyages,
      array_agg(DISTINCT (
        CASE
          WHEN bl_info.voyage_number IS NOT NULL THEN bl_info.vessel_name || ' / ' || bl_info.voyage_number
          ELSE bl_info.vessel_name
        END
      )) FILTER (WHERE bl_info.vessel_name IS NOT NULL) AS vessel_voyages,
      array_agg(DISTINCT bl_info.bl_id) FILTER (WHERE bl_info.bl_id IS NOT NULL) AS bls,
      array_agg(DISTINCT bl_info.pod) FILTER (WHERE bl_info.pod IS NOT NULL) AS pods
    FROM bl_info
    GROUP BY bl_info.invoice_id
  )
  SELECT
    i.id,
    i.invoice_number,
    i.issued_at,
    i.due_date,
    i.total_brl,
    i.total_paid_brl,
    CASE
      WHEN i.invoice_type IN ('individual', 'consolidated') AND ledger.link_count > 0
        THEN ledger.balance_brl
      ELSE i.balance_brl
    END AS balance_brl,
    i.status,
    i.invoice_type,
    COALESCE(agg.vessels, '{}'::text[]),
    COALESCE(agg.voyages, '{}'::text[]),
    COALESCE(agg.vessel_voyages, '{}'::text[]),
    COALESCE(agg.bls, '{}'::text[]),
    COALESCE(agg.pods, '{}'::text[])
  FROM public.invoices AS i
  JOIN eligible_invoices AS eligible ON eligible.invoice_id = i.id
  LEFT JOIN agg ON agg.invoice_id = i.id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS link_count,
      COALESCE(SUM(COALESCE(br.balance_brl, 0)), 0) AS balance_brl
    FROM public.invoice_receivable_links AS irl
    JOIN public.bl_receivables AS br ON br.id = irl.receivable_id
    WHERE irl.invoice_id = i.id
      AND irl.status = 'active'
  ) AS ledger ON true
  WHERE i.customer_id = v_customer_id
  ORDER BY i.created_at DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.portal_list_invoices() TO authenticated, anon;

-- ============================================================================
-- Detalhe de fatura local do portal
-- ============================================================================
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
  WITH linked_invoice_bls AS (
    SELECT ib.invoice_id, ib.bl_id
    FROM public.invoice_bls AS ib
    UNION
    SELECT irl.invoice_id, irl.bl_id
    FROM public.invoice_receivable_links AS irl
    WHERE irl.status = 'active'
  ),
  eligible_invoices AS (
    SELECT i.id AS invoice_id
    FROM public.invoices AS i
    WHERE i.customer_id = v_customer_id
      AND EXISTS (
        SELECT 1
        FROM linked_invoice_bls AS linked
        WHERE linked.invoice_id = i.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM linked_invoice_bls AS linked
        WHERE linked.invoice_id = i.id
          AND NOT public.bl_has_portal_release(linked.bl_id)
      )
  )
  SELECT TO_JSONB(i.*) || jsonb_build_object(
    'customer_name', c.name,
    'customer_cnpj_cpf', c.cnpj_cpf
  )
  INTO v_invoice
  FROM public.invoices AS i
  JOIN eligible_invoices AS eligible ON eligible.invoice_id = i.id
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

  SELECT COALESCE(JSONB_AGG(TO_JSONB(ii.*) ORDER BY ii.id), '[]'::JSONB)
  INTO v_items
  FROM public.invoice_items AS ii
  WHERE ii.invoice_id = p_invoice_id;

  IF v_items = '[]'::JSONB THEN
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
    WHERE l.invoice_id = p_invoice_id
      AND l.status = 'active';

    WITH links AS (
      SELECT l.id AS link_id, l.bl_id, COALESCE(l.subtotal_brl, 0) AS subtotal_brl
      FROM public.invoice_receivable_links AS l
      WHERE l.invoice_id = p_invoice_id
        AND l.status = 'active'
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
      AND irl.status = 'active'
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

-- ============================================================================
-- Demurrage no portal
-- ============================================================================
CREATE OR REPLACE FUNCTION public.portal_list_demurrage_invoices()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint := public.current_portal_customer_id();
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.doc_date DESC), '[]'::jsonb)
    FROM (
      SELECT
        di.id, di.doc_number, di.doc_date, di.due_date, di.billed_at, di.paid_at,
        di.total_usd, di.frozen_roe, di.frozen_total_brl, di.status, di.pix_payload,
        di.dispute_open, di.discount_type, di.discount_value, di.discount_mode,
        b.id AS bl_id, b.pol, b.pod, v.voyage_number, vs.name AS vessel_name
      FROM public.demurrage_invoices di
      JOIN public.bls b ON b.id = di.bl_id
      LEFT JOIN public.voyages v ON v.id = b.voyage_id
      LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
      WHERE di.customer_id = v_customer_id AND di.status IN ('issued', 'overdue', 'paid') AND public.bl_has_portal_release(di.bl_id)
    ) t
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.portal_list_demurrage_invoices() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.portal_get_demurrage_invoice_detail(p_invoice_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint := public.current_portal_customer_id();
  v_invoice JSONB;
  v_items   JSONB;
BEGIN
  SELECT row_to_json(t)::jsonb INTO v_invoice
  FROM (
    SELECT di.*, c.name AS customer_name, c.cnpj_cpf AS customer_cnpj_cpf,
      b.pol, b.pod, v.voyage_number, vs.name AS vessel_name
    FROM public.demurrage_invoices di
    JOIN public.customers c ON c.id = di.customer_id
    JOIN public.bls b ON b.id = di.bl_id
    LEFT JOIN public.voyages v ON v.id = b.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE di.id = p_invoice_id
      AND di.customer_id = v_customer_id
      AND di.status IN ('issued', 'overdue', 'paid')
      AND public.bl_has_portal_release(di.bl_id)
  ) t;

  IF v_invoice IS NULL THEN
    RAISE EXCEPTION 'Invoice % nao encontrada ou acesso negado', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.id), '[]'::jsonb) INTO v_items
  FROM (SELECT * FROM public.demurrage_invoice_items WHERE invoice_id = p_invoice_id) t;

  RETURN jsonb_build_object('invoice', v_invoice, 'items', v_items);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.portal_get_demurrage_invoice_detail(bigint) TO authenticated, anon;
