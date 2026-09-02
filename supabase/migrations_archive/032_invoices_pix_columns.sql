-- Migration 032: Add PIX reconciliation tracking columns to invoices table
-- Mirrors the pix_txid / conciliated_by_extract columns already on demurrage_invoices.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS pix_txid text,
  ADD COLUMN IF NOT EXISTS conciliated_by_extract boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_invoices_pix_txid
  ON public.invoices (pix_txid)
  WHERE pix_txid IS NOT NULL;
