-- 352_reconcile_remaining_runtime_drift.sql
-- Reconciles runtime objects that can survive as drift after migrations are
-- recorded as applied in production or in a repaired persistent branch.
--
-- Intent: make the schema produced by a fresh replay agree with the current
-- production contract without rewriting historical migration metadata.
-- Scope: import-batch compatibility timestamp, the CE index, and the retired
-- local-invoice overdue enforcement objects.
-- Data impact: no values are changed. The timestamp conversion is guarded by
-- an equality check before the derived column is rebuilt.
-- Rollback: restore the previous import_batches.created_at definition only
-- after inspecting the live values; recreate the CE index and retired overdue
-- objects only if the corresponding contracts are deliberately reintroduced.

-- Migration 140 intended this compatibility column to be derived from the
-- canonical uploaded_at value. Production may already have a regular column
-- from an older baseline, so ADD COLUMN IF NOT EXISTS could not repair it.
DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.import_batches
    WHERE created_at IS DISTINCT FROM uploaded_at
  ) THEN
    RAISE EXCEPTION
      'import_batches.created_at differs from uploaded_at; refusing to rebuild the compatibility column';
  END IF;
END
$guard$;

ALTER TABLE public.import_batches
  DROP COLUMN IF EXISTS created_at;

ALTER TABLE public.import_batches
  ADD COLUMN created_at TIMESTAMPTZ
  GENERATED ALWAYS AS (uploaded_at) STORED;

-- Migration 008 defines this index. Recreate it where a production baseline
-- or manual cleanup left the table without the expected access path.
CREATE INDEX IF NOT EXISTS idx_bls_ce_mercante
  ON public.bls (ce_mercante);

-- Migration 348 retired local-invoice overdue enforcement. These drops are
-- intentionally idempotent so a branch that recorded 348 without executing
-- every cleanup statement converges on the same contract as production.
DROP TRIGGER IF EXISTS trg_block_invoice_overdue_customer
  ON public.invoices;

DROP FUNCTION IF EXISTS public.fn_block_invoice_overdue_customer();
DROP FUNCTION IF EXISTS public.mark_overdue_invoices();
