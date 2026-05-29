-- Phase 1: Local-charge billing ledger foundation.
-- Keeps existing invoice flows intact while adding receivable-level truth.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS invoice_type TEXT NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS obsolete_reason TEXT,
  ADD COLUMN IF NOT EXISTS covered_by_invoice_id BIGINT REFERENCES public.invoices(id),
  ADD COLUMN IF NOT EXISTS replaced_by_invoice_id BIGINT REFERENCES public.invoices(id);

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'covered', 'obsolete', 'overdue', 'cancelled'));

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_invoice_type_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_invoice_type_check
  CHECK (invoice_type IN ('individual', 'consolidated', 'granite'));

CREATE TABLE IF NOT EXISTS public.bl_receivables (
  id BIGSERIAL PRIMARY KEY,
  bl_id TEXT NOT NULL REFERENCES public.bls(id) ON DELETE RESTRICT,
  customer_id BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  source TEXT NOT NULL DEFAULT 'local_charges',
  original_amount_brl NUMERIC(14,2) NOT NULL DEFAULT 0,
  settled_amount_brl NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance_brl NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  voyage_id BIGINT REFERENCES public.voyages(id),
  cargo_mode TEXT,
  pol TEXT,
  pod TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, bl_id),
  CONSTRAINT bl_receivables_amounts_non_negative
    CHECK (original_amount_brl >= 0 AND settled_amount_brl >= 0 AND balance_brl >= 0),
  CONSTRAINT bl_receivables_status_check
    CHECK (status IN ('open', 'partially_settled', 'settled', 'void')),
  CONSTRAINT bl_receivables_source_check
    CHECK (source IN ('local_charges'))
);

CREATE INDEX IF NOT EXISTS idx_bl_receivables_customer_status
  ON public.bl_receivables(customer_id, status);

CREATE INDEX IF NOT EXISTS idx_bl_receivables_voyage
  ON public.bl_receivables(voyage_id);

CREATE INDEX IF NOT EXISTS idx_bl_receivables_bl
  ON public.bl_receivables(bl_id);

CREATE TABLE IF NOT EXISTS public.invoice_receivable_links (
  id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  receivable_id BIGINT NOT NULL REFERENCES public.bl_receivables(id) ON DELETE RESTRICT,
  bl_id TEXT NOT NULL REFERENCES public.bls(id) ON DELETE RESTRICT,
  subtotal_brl NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  bl_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, receivable_id),
  CONSTRAINT invoice_receivable_links_status_check
    CHECK (status IN ('active', 'settled_by_this_invoice', 'settled_elsewhere', 'obsolete'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_receivable_links_invoice
  ON public.invoice_receivable_links(invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_receivable_links_receivable_status
  ON public.invoice_receivable_links(receivable_id, status);

CREATE TABLE IF NOT EXISTS public.ledger_settlements (
  id BIGSERIAL PRIMARY KEY,
  payment_id BIGINT REFERENCES public.payments(id) ON DELETE SET NULL,
  receivable_id BIGINT NOT NULL REFERENCES public.bl_receivables(id) ON DELETE RESTRICT,
  invoice_id BIGINT REFERENCES public.invoices(id) ON DELETE SET NULL,
  amount_brl NUMERIC(14,2) NOT NULL,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  method TEXT,
  pix_txid TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ledger_settlements_amount_positive CHECK (amount_brl > 0),
  CONSTRAINT ledger_settlements_source_check CHECK (source IN ('manual', 'pix_extract', 'backfill'))
);

CREATE INDEX IF NOT EXISTS idx_ledger_settlements_receivable
  ON public.ledger_settlements(receivable_id);

CREATE INDEX IF NOT EXISTS idx_ledger_settlements_pix_txid
  ON public.ledger_settlements(pix_txid)
  WHERE pix_txid IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.invoice_lifecycle_events (
  id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  related_invoice_id BIGINT REFERENCES public.invoices(id),
  receivable_id BIGINT REFERENCES public.bl_receivables(id),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invoice_lifecycle_events_type_check
    CHECK (event_type IN ('issued', 'paid', 'partially_paid', 'covered', 'obsolete', 'cancelled', 'reconciled_by_txid', 'backfilled'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_lifecycle_events_invoice
  ON public.invoice_lifecycle_events(invoice_id, created_at DESC);

ALTER TABLE public.bl_receivables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_receivable_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lifecycle_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bl_receivables_select_admin ON public.bl_receivables;
DROP POLICY IF EXISTS bl_receivables_insert_admin ON public.bl_receivables;
DROP POLICY IF EXISTS bl_receivables_update_admin ON public.bl_receivables;
DROP POLICY IF EXISTS bl_receivables_delete_admin ON public.bl_receivables;

CREATE POLICY bl_receivables_select_admin
  ON public.bl_receivables FOR SELECT
  TO authenticated USING (public.is_admin());

CREATE POLICY bl_receivables_insert_admin
  ON public.bl_receivables FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY bl_receivables_update_admin
  ON public.bl_receivables FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY bl_receivables_delete_admin
  ON public.bl_receivables FOR DELETE
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS invoice_receivable_links_select_admin ON public.invoice_receivable_links;
DROP POLICY IF EXISTS invoice_receivable_links_insert_admin ON public.invoice_receivable_links;
DROP POLICY IF EXISTS invoice_receivable_links_update_admin ON public.invoice_receivable_links;
DROP POLICY IF EXISTS invoice_receivable_links_delete_admin ON public.invoice_receivable_links;

CREATE POLICY invoice_receivable_links_select_admin
  ON public.invoice_receivable_links FOR SELECT
  TO authenticated USING (public.is_admin());

CREATE POLICY invoice_receivable_links_insert_admin
  ON public.invoice_receivable_links FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY invoice_receivable_links_update_admin
  ON public.invoice_receivable_links FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY invoice_receivable_links_delete_admin
  ON public.invoice_receivable_links FOR DELETE
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS ledger_settlements_select_admin ON public.ledger_settlements;
DROP POLICY IF EXISTS ledger_settlements_insert_admin ON public.ledger_settlements;
DROP POLICY IF EXISTS ledger_settlements_update_admin ON public.ledger_settlements;
DROP POLICY IF EXISTS ledger_settlements_delete_admin ON public.ledger_settlements;

CREATE POLICY ledger_settlements_select_admin
  ON public.ledger_settlements FOR SELECT
  TO authenticated USING (public.is_admin());

CREATE POLICY ledger_settlements_insert_admin
  ON public.ledger_settlements FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY ledger_settlements_update_admin
  ON public.ledger_settlements FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY ledger_settlements_delete_admin
  ON public.ledger_settlements FOR DELETE
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS invoice_lifecycle_events_select_admin ON public.invoice_lifecycle_events;
DROP POLICY IF EXISTS invoice_lifecycle_events_insert_admin ON public.invoice_lifecycle_events;
DROP POLICY IF EXISTS invoice_lifecycle_events_update_admin ON public.invoice_lifecycle_events;
DROP POLICY IF EXISTS invoice_lifecycle_events_delete_admin ON public.invoice_lifecycle_events;

CREATE POLICY invoice_lifecycle_events_select_admin
  ON public.invoice_lifecycle_events FOR SELECT
  TO authenticated USING (public.is_admin());

CREATE POLICY invoice_lifecycle_events_insert_admin
  ON public.invoice_lifecycle_events FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY invoice_lifecycle_events_update_admin
  ON public.invoice_lifecycle_events FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY invoice_lifecycle_events_delete_admin
  ON public.invoice_lifecycle_events FOR DELETE
  TO authenticated USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bl_receivables TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_receivable_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ledger_settlements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_lifecycle_events TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.bl_receivables_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.invoice_receivable_links_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.ledger_settlements_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.invoice_lifecycle_events_id_seq TO authenticated;
