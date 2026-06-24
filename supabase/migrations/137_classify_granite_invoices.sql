-- Renumbered from 20260622175108 (original timestamped migration: 20260622175108_classify_granite_invoices.sql).
-- Keep the shared invoice document explicitly classified by its Granite link.

CREATE OR REPLACE FUNCTION public.classify_granite_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.invoices
  SET invoice_type = 'granite'
  WHERE id = NEW.invoice_id
    AND invoice_type IS DISTINCT FROM 'granite';

  IF NOT FOUND THEN
    PERFORM 1 FROM public.invoices WHERE id = NEW.invoice_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice vinculada ao Granito nao encontrada.'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_classify_granite_invoice
ON public.invoice_granite_bls;

CREATE TRIGGER trg_classify_granite_invoice
AFTER INSERT ON public.invoice_granite_bls
FOR EACH ROW
EXECUTE FUNCTION public.classify_granite_invoice();

UPDATE public.invoices AS invoice
SET invoice_type = 'granite'
WHERE invoice.invoice_type IS DISTINCT FROM 'granite'
  AND EXISTS (
    SELECT 1
    FROM public.invoice_granite_bls AS link
    WHERE link.invoice_id = invoice.id
  );

REVOKE ALL ON FUNCTION public.classify_granite_invoice()
FROM PUBLIC, anon, authenticated;
