-- Consolidated (ledger) invoices only persist invoice_receivable_links (one subtotal per BL),
-- so the printable document could not show the per-BL charge breakdown (THD, ISPS, Drop-Off, etc.).
-- charge_calculations / charge_table_items are admin-only under RLS, so the client cannot read them
-- directly at render time. This SECURITY DEFINER function returns the breakdown for a single
-- consolidated invoice to active users, scoped strictly to that invoice's receivable links.
--
-- Rollback: DROP FUNCTION public.get_consolidated_invoice_item_breakdown(bigint);

CREATE OR REPLACE FUNCTION public.get_consolidated_invoice_item_breakdown(p_invoice_id bigint)
RETURNS TABLE (
  bl_id text,
  charge_calculation_id bigint,
  charge_table_id bigint,
  charge_item_id bigint,
  quantity numeric,
  unit_value_brl numeric,
  total_value_brl numeric,
  currency text,
  unit_value_usd numeric,
  total_value_usd numeric,
  calculation_key text,
  charge_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    irl.bl_id,
    cc.id            AS charge_calculation_id,
    cc.charge_table_id,
    cc.charge_item_id,
    cc.quantity,
    cc.unit_value_brl,
    cc.total_value_brl,
    cti.currency     AS currency,
    cc.unit_value_usd,
    cc.total_value_usd,
    cc.calculation_key,
    cti.name         AS charge_name
  FROM public.invoice_receivable_links irl
  JOIN public.charge_calculations cc ON cc.bl_id = irl.bl_id
  LEFT JOIN public.charge_table_items cti ON cti.id = cc.charge_item_id
  WHERE public.is_active_user()
    AND irl.invoice_id = p_invoice_id
    AND COALESCE(cc.total_value_brl, 0) > 0
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt')
  ORDER BY irl.bl_id, cc.id;
$$;

REVOKE ALL ON FUNCTION public.get_consolidated_invoice_item_breakdown(bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.get_consolidated_invoice_item_breakdown(bigint) TO authenticated;
