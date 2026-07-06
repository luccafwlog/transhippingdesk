-- Design audit remediation: normalize overdue invoice alerts.
-- Business intent: alerts generated for overdue local invoices must use
-- Portuguese copy, Brazilian currency formatting and the invoice number as the
-- invoice entity identifier.
-- Affected contracts: public.detect_overdue_invoices(), public.alerts.
-- Rollback: restore the function body from 151_guard_definer_rpcs_active_user.sql
-- and keep/repair alert entity_id values according to operational need.

UPDATE public.alerts AS a
SET entity_id = i.invoice_number
FROM public.invoices AS i
WHERE a.type = 'invoice_overdue'
  AND a.entity_type = 'invoice'
  AND a.entity_id = i.id::text
  AND i.invoice_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.detect_overdue_invoices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row RECORD;
  v_count integer := 0;
  v_balance_cents bigint;
  v_balance_abs numeric;
  v_balance_integer text;
  v_balance_grouped text;
  v_balance_text text;
  v_invoice_entity_id text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN
    UPDATE public.invoices
    SET status = 'overdue'
    WHERE status IN ('issued', 'partially_paid')
      AND due_date IS NOT NULL
      AND due_date < CURRENT_DATE
    RETURNING id, invoice_number, balance_brl, due_date
  LOOP
    v_invoice_entity_id := COALESCE(v_row.invoice_number, v_row.id::text);
    v_balance_cents := round(COALESCE(v_row.balance_brl, 0) * 100)::bigint;
    v_balance_abs := abs(v_balance_cents) / 100;
    v_balance_integer := trunc(v_balance_abs)::bigint::text;
    v_balance_grouped := '';
    WHILE length(v_balance_integer) > 3 LOOP
      v_balance_grouped := '.' || right(v_balance_integer, 3) || v_balance_grouped;
      v_balance_integer := left(v_balance_integer, length(v_balance_integer) - 3);
    END LOOP;
    v_balance_grouped := v_balance_integer || v_balance_grouped;
    v_balance_text :=
      CASE WHEN v_balance_cents < 0 THEN '-' ELSE '' END ||
      v_balance_grouped ||
      ',' ||
      lpad((abs(v_balance_cents) % 100)::text, 2, '0');

    -- Cria alerta apenas se nao existe um aberto/reconhecido para esta invoice.
    INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
    SELECT
      'invoice_overdue',
      'invoice',
      v_invoice_entity_id,
      format(
        'Fatura %s venceu em %s — saldo pendente: R$ %s',
        COALESCE(v_row.invoice_number, 'INV-' || v_row.id),
        to_char(v_row.due_date, 'DD/MM/YYYY'),
        v_balance_text
      ),
      'open'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.alerts
      WHERE type = 'invoice_overdue'
        AND entity_type = 'invoice'
        AND entity_id IN (v_invoice_entity_id, v_row.id::text)
        AND status != 'closed'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.detect_overdue_invoices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_overdue_invoices() TO authenticated;
