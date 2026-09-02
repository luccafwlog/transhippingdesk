-- 380: autoridade server-side dos comunicados financeiros e configuração da régua.

CREATE OR REPLACE FUNCTION public.customer_local_charges_communication_payload(
  p_voyage_id BIGINT,
  p_customer_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  RETURN (
    WITH base_bls AS (
      SELECT b.id AS bl_id, b.ce_mercante, b.pod, c.name AS customer_name,
             v.eta, v.voyage_number, vs.name AS vessel_name
      FROM public.bls b
      JOIN public.customers c ON c.id = b.customer_id
      JOIN public.voyages v ON v.id = b.voyage_id
      LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
      WHERE b.voyage_id = p_voyage_id
        AND b.customer_id = p_customer_id
        AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
    ), direct_totals AS (
      SELECT ib.bl_id, sum(COALESCE(ib.subtotal_brl, 0)) AS total_brl
      FROM public.invoice_bls ib
      JOIN public.invoices i ON i.id = ib.invoice_id
      WHERE i.status IN ('issued', 'partially_paid', 'paid', 'covered')
      GROUP BY ib.bl_id
    ), ledger_totals AS (
      SELECT rl.bl_id, sum(COALESCE(rl.subtotal_brl, 0)) AS total_brl
      FROM public.invoice_receivable_links rl
      JOIN public.invoices i ON i.id = rl.invoice_id
      WHERE COALESCE(rl.status, '') <> 'obsolete'
        AND i.status IN ('issued', 'partially_paid', 'paid', 'covered')
        AND NOT EXISTS (SELECT 1 FROM direct_totals d WHERE d.bl_id = rl.bl_id)
      GROUP BY rl.bl_id
    )
    SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_build_object(
      'customer_id', p_customer_id,
      'customer_name', max(customer_name),
      'vessel_name', max(vessel_name),
      'voyage_number', max(voyage_number),
      'port', (array_agg(COALESCE(pod, '—') ORDER BY bl_id))[1],
      'milestone_at', max(COALESCE(eta::TEXT, '')),
      'bls', jsonb_agg(jsonb_build_object(
        'bl_id', base_bls.bl_id,
        'ce_mercante', NULLIF(btrim(base_bls.ce_mercante), ''),
        'total_brl', COALESCE(direct_totals.total_brl, ledger_totals.total_brl, 0)
      ) ORDER BY base_bls.bl_id)
    ) END
    FROM base_bls
    LEFT JOIN direct_totals ON direct_totals.bl_id = base_bls.bl_id
    LEFT JOIN ledger_totals ON ledger_totals.bl_id = base_bls.bl_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.customer_local_charges_communication_payload(BIGINT, BIGINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_local_charges_communication_payload(BIGINT, BIGINT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.set_demurrage_dunning_interval_days(p_days INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_previous INTEGER;
BEGIN
  IF v_role IS DISTINCT FROM 'administrativo' THEN
    RAISE EXCEPTION 'Somente o perfil administrativo pode alterar o intervalo da régua.' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
    RAISE EXCEPTION 'O intervalo deve estar entre 1 e 365 dias.' USING ERRCODE = '22023';
  END IF;
  SELECT demurrage_dunning_interval_days INTO v_previous
  FROM public.app_settings WHERE id = 1 FOR UPDATE;
  UPDATE public.app_settings SET demurrage_dunning_interval_days = p_days WHERE id = 1;
  IF v_previous IS DISTINCT FROM p_days THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('app_settings', '1', 'demurrage_dunning_interval_days', v_previous::TEXT, p_days::TEXT, auth.uid(), 'Alteração do intervalo da régua de Demurrage');
  END IF;
  RETURN p_days;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_demurrage_dunning_interval_days(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_demurrage_dunning_interval_days(INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.demurrage_dunning_candidate_sendable(p_invoice_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.demurrage_invoices
    WHERE id = p_invoice_id
      AND COALESCE(status, 'issued') IN ('issued', 'overdue')
      AND paid_at IS NULL
      AND COALESCE(dispute_open, false) = false
  );
$function$;

REVOKE ALL ON FUNCTION public.demurrage_dunning_candidate_sendable(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demurrage_dunning_candidate_sendable(BIGINT) TO service_role;
