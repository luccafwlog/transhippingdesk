-- 354_reconcile_import_batches_timestamp.sql
-- Converges persistent branches that already recorded migration 352 before its
-- timestamp repair was made safe for a missing column.
--
-- Scope: public.import_batches.created_at compatibility column only.
-- Data impact: none when the legacy values agree with uploaded_at; otherwise
-- the migration aborts before changing the column.
-- Rollback: drop the generated compatibility column only after confirming that
-- no deployed function still depends on import_batches.created_at.

DO $guard$
DECLARE
  v_is_generated BOOLEAN;
  v_generation_expression TEXT;
BEGIN
  -- Acquire the same lock that the later ALTER TABLE would take before
  -- comparing legacy values. This closes the validation-to-rebuild race.
  LOCK TABLE public.import_batches IN ACCESS EXCLUSIVE MODE;

  SELECT is_generated = 'ALWAYS', generation_expression
  INTO v_is_generated, v_generation_expression
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'import_batches'
    AND column_name = 'created_at';

  IF NOT FOUND THEN
    ALTER TABLE public.import_batches
      ADD COLUMN created_at TIMESTAMPTZ
      GENERATED ALWAYS AS (uploaded_at) STORED;
  ELSIF v_is_generated AND v_generation_expression = 'uploaded_at' THEN
    NULL;
  ELSE
    IF EXISTS (
      SELECT 1
      FROM public.import_batches
      WHERE created_at IS DISTINCT FROM uploaded_at
    ) THEN
      RAISE EXCEPTION
        'import_batches.created_at differs from uploaded_at; refusing to rebuild the compatibility column';
    END IF;

    ALTER TABLE public.import_batches
      DROP COLUMN created_at;

    ALTER TABLE public.import_batches
      ADD COLUMN created_at TIMESTAMPTZ
      GENERATED ALWAYS AS (uploaded_at) STORED;
  END IF;
END
$guard$;
