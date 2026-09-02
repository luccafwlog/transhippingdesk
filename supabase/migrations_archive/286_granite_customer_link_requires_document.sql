-- 286: separa sugestao por nome do vinculo confirmado no Granito.
-- Rollback: restaurar as funcoes 136/148 e remover a coluna sugerida por
-- migration posterior, com conferencia dos dados antes de qualquer rollback.

ALTER TABLE public.granite_bls
  ADD COLUMN IF NOT EXISTS suggested_client_id BIGINT;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'granite_bls_suggested_client_id_fkey'
      AND conrelid = 'public.granite_bls'::regclass
  ) THEN
    ALTER TABLE public.granite_bls
      ADD CONSTRAINT granite_bls_suggested_client_id_fkey
      FOREIGN KEY (suggested_client_id)
      REFERENCES public.customers(id)
      ON DELETE SET NULL;
  END IF;
END;
$migration$;

CREATE INDEX IF NOT EXISTS idx_granite_bls_suggested_client_id
  ON public.granite_bls (suggested_client_id);

ALTER FUNCTION public.import_granite_manifest_transactional(
  BIGINT, TEXT, TEXT, TEXT, INTEGER, NUMERIC, UUID, JSONB
) RENAME TO import_granite_manifest_transactional_legacy_136;

REVOKE ALL ON FUNCTION public.import_granite_manifest_transactional_legacy_136(
  BIGINT, TEXT, TEXT, TEXT, INTEGER, NUMERIC, UUID, JSONB
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.import_granite_manifest_transactional(
  p_voyage_id BIGINT,
  p_vessel_voyage TEXT,
  p_loading_port TEXT,
  p_discharge_port TEXT,
  p_total_bls INTEGER,
  p_total_weight_kg NUMERIC,
  p_uploaded_by UUID,
  p_bls JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_result JSONB;
  v_manifest_id UUID;
BEGIN
  v_result := public.import_granite_manifest_transactional_legacy_136(
    p_voyage_id, p_vessel_voyage, p_loading_port, p_discharge_port,
    p_total_bls, p_total_weight_kg, p_uploaded_by, p_bls
  );
  v_manifest_id := (v_result->>'manifest_id')::UUID;

  UPDATE public.granite_bls AS g
  SET suggested_client_id = NULLIF(item->>'suggested_client_id', '')::BIGINT
  FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item
  WHERE g.manifest_id = v_manifest_id
    AND g.bl_number = item->>'bl_number';

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_granite_manifest_transactional(
  BIGINT, TEXT, TEXT, TEXT, INTEGER, NUMERIC, UUID, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_granite_manifest_transactional(
  BIGINT, TEXT, TEXT, TEXT, INTEGER, NUMERIC, UUID, JSONB
) TO authenticated;

ALTER FUNCTION public.save_granite_bl_review(UUID, BIGINT, UUID)
  RENAME TO save_granite_bl_review_legacy_148;

REVOKE ALL ON FUNCTION public.save_granite_bl_review_legacy_148(UUID, BIGINT, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_granite_bl_review(
  p_granite_bl_id UUID,
  p_client_id BIGINT,
  p_changed_by UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public.save_granite_bl_review_legacy_148(p_granite_bl_id, p_client_id, p_changed_by);
  UPDATE public.granite_bls
  SET suggested_client_id = NULL
  WHERE id = p_granite_bl_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_granite_bl_review(UUID, BIGINT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_granite_bl_review(UUID, BIGINT, UUID) TO authenticated;
