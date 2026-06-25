-- Renumbered from 20260529143000 (original timestamped migration: 20260529143000_ledger_obsolete_consolidated_links.sql).
-- Keep link lifecycle aligned with document lifecycle. When a consolidated
-- invoice becomes obsolete, every active receivable link in that document is
-- obsolete too, including B/Ls that remain open for a new consolidation.

CREATE OR REPLACE FUNCTION public.mark_obsolete_consolidated_links()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.invoice_type = 'consolidated'
     AND NEW.status = 'obsolete'
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.invoice_receivable_links
    SET status = 'obsolete'
    WHERE invoice_id = NEW.id
      AND status = 'active';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_obsolete_consolidated_links ON public.invoices;
CREATE TRIGGER trg_mark_obsolete_consolidated_links
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.mark_obsolete_consolidated_links();
