-- 315: o Portal recebe o fato operacional da omissão, nunca sua justificativa interna.
-- Rollback: restaurar a projeção anterior da migration 202_portal_global_transshipment.sql
-- (incluindo omission.reason) e reaplicar os mesmos grants.

CREATE OR REPLACE FUNCTION public.portal_list_operation_bls()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_rows JSONB := public._portal_list_operation_bls_core(public.current_portal_customer_id());
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(
      item || jsonb_build_object(
        'transshipment', CASE WHEN omission.id IS NULL THEN NULL ELSE jsonb_build_object(
          'omission_id', omission.id,
          'disposition', omission.disposition,
          'omitted_pod', omission.omitted_pod,
          'discharge_pod', omission.discharge_pod,
          'onward_vessel_name', omission.onward_vessel_name,
          'onward_carrier', omission.onward_carrier,
          'onward_voyage_number', omission.onward_voyage_number,
          'onward_etd', omission.onward_etd,
          'onward_eta', omission.onward_eta
        ) END
      ) ORDER BY ordinality
    ), '[]'::jsonb)
    FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS rows(item, ordinality)
    LEFT JOIN LATERAL (
      SELECT vo.id, bt.disposition, vo.omitted_pod, vo.discharge_pod,
             vo.onward_vessel_name, vo.onward_carrier, vo.onward_voyage_number,
             vo.onward_etd, vo.onward_eta
      FROM public.bl_transshipments bt
      JOIN public.voyage_omissions vo ON vo.id = bt.omission_id
      WHERE bt.bl_id = item->>'bl_id'
      ORDER BY vo.omitted_at DESC, vo.id DESC
      LIMIT 1
    ) omission ON true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.portal_list_operation_bls() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_operation_bls() TO authenticated;
