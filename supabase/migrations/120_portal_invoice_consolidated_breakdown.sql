-- Renumbered from 20260615190000 (original timestamped migration: 20260615190000_portal_invoice_consolidated_breakdown.sql).
-- Portal consolidated invoices showed a single aggregated line per BL
-- ("BL X - Taxas locais"), while the internal system shows the full per-BL
-- charge breakdown (THD, ISPS, Drop-Off, ...). The internal detail goes through
-- get_consolidated_invoice_item_breakdown(), which is gated by is_admin() and so
-- cannot be used by portal users.
--
-- This redefines portal_invoice_details to reconstruct the same per-BL charge
-- lines directly. The function is SECURITY DEFINER and already scoped to the
-- caller's own invoice (i.customer_id = current_portal_customer_id()), so the
-- elevated read of charge_calculations / charge_table_items stays confined to
-- that invoice. The ledger subtotal remains the source of truth: detailed lines
-- are only used when they reconcile with the BL subtotal; otherwise we fall back
-- to a single aggregated line for that BL (mirrors listInvoiceDetails in
-- src/services/billing.ts).
--
-- Rollback: restore the prior definition from
-- 20260612163000_portal_invoice_history_links.sql.

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

  SELECT COALESCE(JSONB_AGG(TO_JSONB(ii.*) ORDER BY ii.id), '[]'::JSONB)
  INTO v_items
  FROM public.invoice_items AS ii
  WHERE ii.invoice_id = p_invoice_id;

  IF v_items = '[]'::JSONB THEN
    -- Consolidated ledger invoices have no invoice_items/invoice_bls; build the
    -- BL summary rows from the receivable links.
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

    -- Per-BL charge breakdown reconstructed from charge_calculations, matching
    -- the internal invoice detail. Only emit detailed lines for a BL when they
    -- reconcile with that BL's ledger subtotal; otherwise fall back to one line.
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
