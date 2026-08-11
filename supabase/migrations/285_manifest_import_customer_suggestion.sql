-- 285: preserva a sugestao no import generico usado por carga solta.
-- Rollback: restaurar a funcao 165 e remover a coluna sugerida por migration
-- posterior; nao reverter em ambiente com dados novos sem plano de dados.

ALTER FUNCTION public.import_manifest_transactional(
  text, bigint, uuid, text, text, integer, integer, jsonb, jsonb, jsonb, boolean
) RENAME TO import_manifest_transactional_legacy_165;

REVOKE ALL ON FUNCTION public.import_manifest_transactional_legacy_165(
  text, bigint, uuid, text, text, integer, integer, jsonb, jsonb, jsonb, boolean
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.import_manifest_transactional(
  p_filename text,
  p_voyage_id bigint,
  p_uploaded_by uuid,
  p_cargo_mode text,
  p_file_hash text,
  p_total_bls integer,
  p_total_containers integer,
  p_bls jsonb,
  p_containers jsonb,
  p_errors jsonb,
  p_apply_overwrites boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result BIGINT;
BEGIN
  v_result := public.import_manifest_transactional_legacy_165(
    p_filename,
    p_voyage_id,
    p_uploaded_by,
    p_cargo_mode,
    p_file_hash,
    p_total_bls,
    p_total_containers,
    p_bls,
    p_containers,
    p_errors,
    p_apply_overwrites
  );

  UPDATE public.bls AS b
  SET
    suggested_customer_id = CASE
      WHEN item ? 'suggested_customer_id' THEN NULLIF(item->>'suggested_customer_id', '')::BIGINT
      ELSE b.suggested_customer_id
    END,
    customer_reconciliation_status = COALESCE(
      NULLIF(item->>'customer_reconciliation_status', ''),
      CASE
        WHEN NULLIF(item->>'customer_id', '') IS NOT NULL THEN 'reconciled'
        ELSE 'missing_customer'
      END
    )
  FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item
  WHERE b.id = item->>'id';

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_manifest_transactional(
  text, bigint, uuid, text, text, integer, integer, jsonb, jsonb, jsonb, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_manifest_transactional(
  text, bigint, uuid, text, text, integer, integer, jsonb, jsonb, jsonb, boolean
) TO authenticated;
