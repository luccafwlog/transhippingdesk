-- Make ledger backfills auditable: callers get explicit exception examples and
-- total mismatch counts instead of only coarse skipped/upserted counters.

CREATE OR REPLACE FUNCTION public.backfill_local_charge_receivables(p_limit INTEGER DEFAULT 5000)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row RECORD;
  v_receivable_id BIGINT;
  v_actual_amount NUMERIC(14,2);
  v_synced INTEGER := 0;
  v_skipped INTEGER := 0;
  v_total_mismatches INTEGER := 0;
  v_exceptions JSONB := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN
    SELECT
      b.id,
      COALESCE(SUM(COALESCE(cc.total_value_brl, 0)), 0)::NUMERIC(14,2) AS expected_amount
    FROM public.bls b
    JOIN public.charge_calculations cc ON cc.bl_id = b.id
    WHERE b.customer_id IS NOT NULL
      AND COALESCE(cc.total_value_brl, 0) > 0
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt')
    GROUP BY b.id, b.created_at
    ORDER BY b.created_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
  LOOP
    BEGIN
      v_receivable_id := public.sync_local_charge_receivable(v_row.id);
      SELECT original_amount_brl INTO v_actual_amount
      FROM public.bl_receivables
      WHERE id = v_receivable_id;

      v_synced := v_synced + 1;

      IF ABS(COALESCE(v_actual_amount, 0) - COALESCE(v_row.expected_amount, 0)) > 0.01 THEN
        v_total_mismatches := v_total_mismatches + 1;
        v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object(
          'bl_id', v_row.id,
          'error', 'total_mismatch',
          'expected_amount_brl', v_row.expected_amount,
          'actual_amount_brl', v_actual_amount
        ));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object(
        'bl_id', v_row.id,
        'error', SQLERRM,
        'sqlstate', SQLSTATE
      ));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'synced', v_synced,
    'skipped', v_skipped,
    'total_mismatches', v_total_mismatches,
    'exceptions', v_exceptions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_local_charge_receivables(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_local_charge_receivables(INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.backfill_invoice_receivable_links(p_limit INTEGER DEFAULT 5000)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted INTEGER := 0;
  v_missing_receivables INTEGER := 0;
  v_total_mismatches INTEGER := 0;
  v_exceptions JSONB := '[]'::jsonb;
  v_mismatch_examples JSONB := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  WITH invoice_bl_counts AS (
    SELECT invoice_id, COUNT(*) AS bl_count
    FROM public.invoice_bls
    GROUP BY invoice_id
  )
  UPDATE public.invoices i
  SET invoice_type = CASE WHEN COALESCE(c.bl_count, 1) > 1 THEN 'consolidated' ELSE 'individual' END
  FROM invoice_bl_counts c
  WHERE c.invoice_id = i.id
    AND i.invoice_type = 'individual';

  SELECT COUNT(*)
  INTO v_missing_receivables
  FROM public.invoice_bls ib
  LEFT JOIN public.bl_receivables br ON br.source = 'local_charges' AND br.bl_id = ib.bl_id
  WHERE br.id IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'invoice_id', missing.invoice_id,
    'bl_id', missing.bl_id,
    'error', 'missing_receivable'
  )), '[]'::jsonb)
  INTO v_exceptions
  FROM (
    SELECT ib.invoice_id, ib.bl_id
    FROM public.invoice_bls ib
    LEFT JOIN public.bl_receivables br ON br.source = 'local_charges' AND br.bl_id = ib.bl_id
    WHERE br.id IS NULL
    ORDER BY ib.id DESC
    LIMIT 50
  ) AS missing;

  WITH inserted AS (
    INSERT INTO public.invoice_receivable_links (
      invoice_id,
      receivable_id,
      bl_id,
      subtotal_brl,
      status,
      bl_snapshot
    )
    SELECT
      ib.invoice_id,
      br.id,
      ib.bl_id,
      COALESCE(ib.subtotal_brl, br.original_amount_brl, 0),
      CASE
        WHEN COALESCE(i.status, 'issued') = 'paid' THEN 'settled_by_this_invoice'
        WHEN COALESCE(i.status, 'issued') = 'cancelled' THEN 'obsolete'
        ELSE 'active'
      END,
      jsonb_build_object(
        'bl_id', b.id,
        'voyage_id', b.voyage_id,
        'cargo_mode', b.cargo_mode,
        'pol', b.pol,
        'pod', b.pod
      )
    FROM public.invoice_bls ib
    JOIN public.invoices i ON i.id = ib.invoice_id
    JOIN public.bl_receivables br ON br.source = 'local_charges' AND br.bl_id = ib.bl_id
    JOIN public.bls b ON b.id = ib.bl_id
    ORDER BY ib.id DESC
    LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
    ON CONFLICT (invoice_id, receivable_id)
    DO UPDATE SET
      subtotal_brl = EXCLUDED.subtotal_brl,
      status = EXCLUDED.status,
      bl_snapshot = EXCLUDED.bl_snapshot
    RETURNING id
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  SELECT COUNT(*)
  INTO v_total_mismatches
  FROM public.invoice_receivable_links irl
  JOIN public.invoice_bls ib ON ib.invoice_id = irl.invoice_id AND ib.bl_id = irl.bl_id
  WHERE ABS(COALESCE(irl.subtotal_brl, 0) - COALESCE(ib.subtotal_brl, 0)) > 0.01;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'invoice_id', mismatch.invoice_id,
    'bl_id', mismatch.bl_id,
    'error', 'total_mismatch',
    'invoice_bl_subtotal_brl', mismatch.invoice_bl_subtotal_brl,
    'link_subtotal_brl', mismatch.link_subtotal_brl
  )), '[]'::jsonb)
  INTO v_mismatch_examples
  FROM (
    SELECT
      irl.invoice_id,
      irl.bl_id,
      COALESCE(ib.subtotal_brl, 0) AS invoice_bl_subtotal_brl,
      COALESCE(irl.subtotal_brl, 0) AS link_subtotal_brl
    FROM public.invoice_receivable_links irl
    JOIN public.invoice_bls ib ON ib.invoice_id = irl.invoice_id AND ib.bl_id = irl.bl_id
    WHERE ABS(COALESCE(irl.subtotal_brl, 0) - COALESCE(ib.subtotal_brl, 0)) > 0.01
    ORDER BY irl.id DESC
    LIMIT 50
  ) AS mismatch;

  v_exceptions := v_exceptions || v_mismatch_examples;

  RETURN jsonb_build_object(
    'links_upserted', v_inserted,
    'missing_receivables', v_missing_receivables,
    'total_mismatches', v_total_mismatches,
    'exceptions', v_exceptions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_invoice_receivable_links(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_invoice_receivable_links(INTEGER) TO authenticated;
