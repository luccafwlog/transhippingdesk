-- Funções e triggers transacionais para regras críticas.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_bls_updated_at ON public.bls;
CREATE TRIGGER set_bls_updated_at
BEFORE UPDATE ON public.bls
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_customers_updated_at ON public.customers;
CREATE TRIGGER set_customers_updated_at
BEFORE UPDATE ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.invoice_counters (
  year INTEGER PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_counters_service_only ON public.invoice_counters;
CREATE POLICY invoice_counters_service_only
ON public.invoice_counters
FOR ALL
TO authenticated
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');

GRANT SELECT, INSERT, UPDATE ON public.invoice_counters TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_invoice_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  invoice_year INTEGER;
  next_number INTEGER;
BEGIN
  IF NEW.invoice_number IS NOT NULL AND NEW.invoice_number <> '' THEN
    RETURN NEW;
  END IF;

  invoice_year := EXTRACT(YEAR FROM COALESCE(NEW.issued_at, now()))::INTEGER;

  INSERT INTO public.invoice_counters(year, last_number)
  VALUES (invoice_year, 1)
  ON CONFLICT (year)
  DO UPDATE SET last_number = public.invoice_counters.last_number + 1
  RETURNING last_number INTO next_number;

  NEW.invoice_number := format('INV-%s-%s', invoice_year, lpad(next_number::TEXT, 4, '0'));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_invoice_number ON public.invoices;
CREATE TRIGGER assign_invoice_number
BEFORE INSERT ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.assign_invoice_number();

CREATE OR REPLACE FUNCTION public.prevent_pending_review_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_review_status TEXT;
BEGIN
  IF NEW.financial_status = 'invoiced' THEN
    SELECT review_status INTO current_review_status
    FROM public.bls
    WHERE id = NEW.id;

    IF COALESCE(current_review_status, NEW.review_status) = 'pending_review' THEN
      RAISE EXCEPTION 'B/L em revisão manual não pode ser faturado';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_pending_review_invoice ON public.bls;
CREATE TRIGGER prevent_pending_review_invoice
BEFORE INSERT OR UPDATE OF financial_status ON public.bls
FOR EACH ROW
EXECUTE FUNCTION public.prevent_pending_review_invoice();
