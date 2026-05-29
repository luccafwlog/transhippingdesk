-- When an obsolete consolidated invoice is reissued as a new consolidated
-- document for remaining/open receivables, keep the document chain explicit.

CREATE OR REPLACE FUNCTION public.mark_replaced_obsolete_consolidated_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_invoice RECORD;
BEGIN
  SELECT id, invoice_type, status
  INTO v_new_invoice
  FROM public.invoices
  WHERE id = NEW.invoice_id;

  IF v_new_invoice.invoice_type = 'consolidated'
     AND COALESCE(v_new_invoice.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue') THEN
    UPDATE public.invoices AS old_inv
    SET replaced_by_invoice_id = NEW.invoice_id
    WHERE old_inv.invoice_type = 'consolidated'
      AND old_inv.status = 'obsolete'
      AND old_inv.replaced_by_invoice_id IS NULL
      AND old_inv.id <> NEW.invoice_id
      AND EXISTS (
        SELECT 1
        FROM public.invoice_receivable_links AS old_link
        WHERE old_link.invoice_id = old_inv.id
          AND old_link.receivable_id = NEW.receivable_id
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_replaced_obsolete_consolidated_invoice ON public.invoice_receivable_links;
CREATE TRIGGER trg_mark_replaced_obsolete_consolidated_invoice
AFTER INSERT ON public.invoice_receivable_links
FOR EACH ROW
WHEN (NEW.status = 'active')
EXECUTE FUNCTION public.mark_replaced_obsolete_consolidated_invoice();
