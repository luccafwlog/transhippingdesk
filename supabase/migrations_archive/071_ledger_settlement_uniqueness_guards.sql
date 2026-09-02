-- Renumbered from 20260529141000 (original timestamped migration: 20260529141000_ledger_settlement_uniqueness_guards.sql).
-- Guard the ledger invariant at the database level: a B/L receivable balance can
-- only be settled once by live payment flows, and an extracted PIX TXID can only
-- be applied once after normalization.

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_settlements_one_live_receivable
  ON public.ledger_settlements(receivable_id)
  WHERE source IN ('manual', 'pix_extract');

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_settlements_unique_normalized_pix_txid
  ON public.ledger_settlements((UPPER(REGEXP_REPLACE(pix_txid, '[^A-Za-z0-9]', '', 'g'))))
  WHERE pix_txid IS NOT NULL AND source = 'pix_extract';
