-- 351_reconcile_branch_schema_drift.sql
-- Reasserts schema objects whose historical migrations can be recorded as
-- applied while their effect is absent from a freshly replayed branch.
--
-- Intent: keep the production schema and the persistent staging branch aligned
-- without editing migrations that are already part of the remote history.
-- Scope: invoice PIX tracking, demurrage overdue status and the indexes that
-- enforce/accelerate those contracts.
-- Data impact: none; this migration only adds columns, constraints and indexes.
-- Rollback: remove the indexes and constraint, then drop only the two columns
-- after confirming that no later function or data depends on them.

-- The local-charge invoice PIX fields are required by the reconciliation RPCs.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS pix_txid TEXT,
  ADD COLUMN IF NOT EXISTS conciliated_by_extract BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_invoices_pix_txid
  ON public.invoices (pix_txid)
  WHERE pix_txid IS NOT NULL;

-- Demurrage invoices can become overdue through the scheduled enforcement job.
-- Rebuild the check so the contract is identical on production and staging.
ALTER TABLE public.demurrage_invoices
  DROP CONSTRAINT IF EXISTS demurrage_invoices_status_check;

ALTER TABLE public.demurrage_invoices
  ADD CONSTRAINT demurrage_invoices_status_check
  CHECK (status IN ('draft', 'issued', 'overdue', 'paid', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_bl_containers_discharge_date
  ON public.bl_containers (discharge_date)
  WHERE discharge_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bl_containers_demurrage_status
  ON public.bl_containers (demurrage_status)
  WHERE demurrage_status IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_demurrage_invoices_active_bl
  ON public.demurrage_invoices (bl_id)
  WHERE status IN ('issued', 'paid');
