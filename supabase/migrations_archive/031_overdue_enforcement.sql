-- Migration 031: pg_cron daily overdue marking + block new invoice for overdue customer

-- ── 1. Enable pg_cron (no-op if already enabled) ──────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- ── 2. Add 'overdue' status to demurrage_invoices ─────────────────
-- Drop old constraint and re-add with overdue included
ALTER TABLE public.demurrage_invoices
  DROP CONSTRAINT IF EXISTS demurrage_invoices_status_check;

ALTER TABLE public.demurrage_invoices
  ADD CONSTRAINT demurrage_invoices_status_check
  CHECK (status IN ('draft', 'issued', 'overdue', 'paid', 'cancelled'));

-- ── 3. Function: mark overdue invoices (both tables) ──────────────
CREATE OR REPLACE FUNCTION public.mark_overdue_invoices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Local charge invoices
  UPDATE public.invoices
  SET status = 'overdue'
  WHERE status = 'issued'
    AND due_date < CURRENT_DATE;

  -- Demurrage invoices
  UPDATE public.demurrage_invoices
  SET status = 'overdue'
  WHERE status = 'issued'
    AND due_date < CURRENT_DATE;
END;
$$;

-- ── 4. Schedule daily job at 06:00 UTC ────────────────────────────
SELECT cron.schedule(
  'mark-overdue-invoices',
  '0 6 * * *',
  $$SELECT public.mark_overdue_invoices()$$
);

-- ── 5. Trigger: block new invoice for customer with overdue invoices ──
CREATE OR REPLACE FUNCTION public.fn_block_invoice_overdue_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_overdue_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_overdue_count
  FROM public.invoices
  WHERE customer_id = NEW.customer_id
    AND status = 'overdue';

  IF v_overdue_count > 0 THEN
    RAISE EXCEPTION
      'Cliente possui % invoice(s) de taxas locais vencida(s) em aberto. Regularize antes de emitir nova fatura.',
      v_overdue_count
      USING ERRCODE = 'P0003';
  END IF;

  RETURN NEW;
END;
$$;

-- Apply only on INSERT (status='issued'/'draft') — not on status transitions
CREATE TRIGGER trg_block_invoice_overdue_customer
  BEFORE INSERT ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_block_invoice_overdue_customer();

-- Grant: function already SECURITY DEFINER, trigger fires automatically
REVOKE ALL ON FUNCTION public.mark_overdue_invoices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_overdue_invoices() TO service_role;
