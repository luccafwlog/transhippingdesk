ALTER TABLE public.bls
ADD COLUMN IF NOT EXISTS cargo_mode TEXT;

UPDATE public.bls
SET cargo_mode = COALESCE(NULLIF(trim(cargo_mode), ''), 'container')
WHERE cargo_mode IS NULL OR trim(cargo_mode) = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bls_cargo_mode_check'
      AND conrelid = 'public.bls'::regclass
  ) THEN
    ALTER TABLE public.bls
      ADD CONSTRAINT bls_cargo_mode_check CHECK (cargo_mode IN ('container', 'carga_solta'));
  END IF;
END $$;

ALTER TABLE public.bls
ALTER COLUMN cargo_mode SET NOT NULL;

ALTER TABLE public.bls
ALTER COLUMN cargo_mode SET DEFAULT 'container';

CREATE TABLE IF NOT EXISTS public.bl_breakbulk_items (
  id BIGSERIAL PRIMARY KEY,
  bl_id TEXT NOT NULL REFERENCES public.bls(id) ON DELETE CASCADE,
  item_description TEXT NOT NULL,
  package_qty NUMERIC(12,3),
  package_unit TEXT,
  gross_weight_kg NUMERIC(12,3),
  cbm NUMERIC(12,3),
  marks TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bl_breakbulk_items_bl_id
  ON public.bl_breakbulk_items(bl_id);

CREATE OR REPLACE FUNCTION public.validate_bl_breakbulk_item_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_mode TEXT;
BEGIN
  SELECT cargo_mode
    INTO parent_mode
  FROM public.bls
  WHERE id = NEW.bl_id;

  IF parent_mode IS NULL THEN
    RAISE EXCEPTION 'BL nao encontrado para item de carga solta';
  END IF;

  IF parent_mode <> 'carga_solta' THEN
    RAISE EXCEPTION 'BL de item de carga solta precisa ter cargo_mode = carga_solta';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_bl_breakbulk_item_parent ON public.bl_breakbulk_items;
CREATE TRIGGER validate_bl_breakbulk_item_parent
BEFORE INSERT OR UPDATE ON public.bl_breakbulk_items
FOR EACH ROW
EXECUTE FUNCTION public.validate_bl_breakbulk_item_parent();

ALTER TABLE public.bl_breakbulk_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bl_breakbulk_items_select_authenticated ON public.bl_breakbulk_items;
DROP POLICY IF EXISTS bl_breakbulk_items_insert_authenticated ON public.bl_breakbulk_items;
DROP POLICY IF EXISTS bl_breakbulk_items_update_authenticated ON public.bl_breakbulk_items;
DROP POLICY IF EXISTS bl_breakbulk_items_delete_authenticated ON public.bl_breakbulk_items;

CREATE POLICY bl_breakbulk_items_select_authenticated
ON public.bl_breakbulk_items
FOR SELECT
TO authenticated
USING (auth.role() = 'authenticated');

CREATE POLICY bl_breakbulk_items_insert_authenticated
ON public.bl_breakbulk_items
FOR INSERT
TO authenticated
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY bl_breakbulk_items_update_authenticated
ON public.bl_breakbulk_items
FOR UPDATE
TO authenticated
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY bl_breakbulk_items_delete_authenticated
ON public.bl_breakbulk_items
FOR DELETE
TO authenticated
USING (auth.role() = 'authenticated');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bl_breakbulk_items TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.bl_breakbulk_items_id_seq TO authenticated;
