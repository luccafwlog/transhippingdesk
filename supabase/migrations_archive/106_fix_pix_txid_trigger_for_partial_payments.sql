-- Renumbered from 20260612164000 (original timestamped migration: 20260612164000_fix_pix_txid_trigger_for_partial_payments.sql).
CREATE OR REPLACE FUNCTION public.keep_single_pix_txid_settlement_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.source = 'pix_extract'
     AND NULLIF(TRIM(COALESCE(NEW.pix_txid, '')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.ledger_settlements
       WHERE invoice_id = NEW.invoice_id
         AND source = 'pix_extract'
         AND pix_txid IS NOT NULL
     ) THEN
    NEW.pix_txid := NULL;
  END IF;

  RETURN NEW;
END;
$$;
