-- Renumbered from 20260529145000 (original timestamped migration: 20260529145000_ledger_pix_txid_single_settlement_row.sql).
-- A consolidated PIX payment creates one ledger_settlement per receivable.
-- Keep the unique normalized TXID invariant by storing the TXID on the first
-- settlement row for the payment and linking the rest through payment_id.

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
       FROM public.invoice_receivable_links l
       JOIN public.bl_receivables br ON br.id = l.receivable_id
       WHERE l.invoice_id = NEW.invoice_id
         AND l.status = 'active'
         AND COALESCE(br.balance_brl, 0) > 0
         AND l.receivable_id < NEW.receivable_id
     ) THEN
    NEW.pix_txid := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_keep_single_pix_txid_settlement_row ON public.ledger_settlements;
CREATE TRIGGER trg_keep_single_pix_txid_settlement_row
BEFORE INSERT ON public.ledger_settlements
FOR EACH ROW
EXECUTE FUNCTION public.keep_single_pix_txid_settlement_row();
