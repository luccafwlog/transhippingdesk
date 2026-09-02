-- Renumbered from 20260612163000 (original timestamped migration: 20260612163000_portal_invoice_history_links.sql).
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
  WITH bl_info AS (
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
    SELECT
      COALESCE(JSONB_AGG(
        jsonb_build_object(
          'id', l.id, 'invoice_id', p_invoice_id, 'bl_id', l.bl_id,
          'charge_status_snapshot', NULL, 'financial_status_snapshot', NULL,
          'subtotal_brl', l.subtotal_brl, 'subtotal_usd', 0, 'created_at', NULL,
          'pol', l.bl_snapshot->>'pol', 'pod', l.bl_snapshot->>'pod',
          'voyage_number', v.voyage_number, 'vessel_name', vs.name
        ) ORDER BY l.id
      ), '[]'::JSONB),
      COALESCE(JSONB_AGG(
        jsonb_build_object(
          'id', l.id, 'invoice_id', p_invoice_id, 'charge_calculation_id', NULL,
          'description', 'BL ' || l.bl_id || ' - Taxas locais', 'quantity', 1,
          'unit_value_brl', l.subtotal_brl, 'total_value_brl', l.subtotal_brl,
          'bl_id', l.bl_id, 'manifest_id', NULL, 'charge_table_id', NULL,
          'charge_item_id', NULL, 'source', 'ledger', 'currency', 'BRL',
          'unit_value_usd', NULL, 'total_value_usd', NULL
        ) ORDER BY l.id
      ), '[]'::JSONB)
    INTO v_bls, v_items
    FROM public.invoice_receivable_links AS l
    LEFT JOIN public.voyages AS v ON v.id = (l.bl_snapshot->>'voyage_id')::bigint
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    WHERE l.invoice_id = p_invoice_id;
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

GRANT EXECUTE ON FUNCTION public.portal_list_invoices() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.portal_invoice_details(bigint) TO authenticated, anon;
