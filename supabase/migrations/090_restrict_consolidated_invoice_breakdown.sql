-- Renumbered from 20260609133000 (original timestamped migration: 20260609133000_restrict_consolidated_invoice_breakdown.sql).
-- Restrict consolidated invoice charge breakdowns to active admins.
--
-- The function is SECURITY DEFINER because charge_calculations and
-- charge_table_items are admin-only under RLS. Keep the explicit admin gate in
-- the function body so the elevated read cannot be used by regular users.

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
SET search_path = public, pg_temp
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
    AND public.is_admin()
    AND irl.invoice_id = p_invoice_id
    AND COALESCE(cc.total_value_brl, 0) > 0
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt')
  ORDER BY irl.bl_id, cc.id;
$$;

REVOKE ALL ON FUNCTION public.get_consolidated_invoice_item_breakdown(bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.get_consolidated_invoice_item_breakdown(bigint) TO authenticated;
