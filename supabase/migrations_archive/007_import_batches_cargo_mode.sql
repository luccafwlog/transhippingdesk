ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS cargo_mode TEXT;

UPDATE public.import_batches AS batch
SET cargo_mode = CASE
  WHEN EXISTS (
    SELECT 1
    FROM public.bls bl
    WHERE bl.batch_id = batch.id
      AND bl.cargo_mode = 'carga_solta'
  ) THEN 'carga_solta'
  ELSE 'container'
END
WHERE batch.cargo_mode IS NULL;

ALTER TABLE public.import_batches
  ALTER COLUMN cargo_mode SET DEFAULT 'container';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'import_batches_cargo_mode_check'
  ) THEN
    ALTER TABLE public.import_batches
      ADD CONSTRAINT import_batches_cargo_mode_check
      CHECK (cargo_mode IN ('container', 'carga_solta'));
  END IF;
END $$;

ALTER TABLE public.import_batches
  ALTER COLUMN cargo_mode SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_import_batches_cargo_mode
  ON public.import_batches(cargo_mode);
