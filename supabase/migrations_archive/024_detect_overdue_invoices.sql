-- Fase 3.3: Detecção automática de invoices vencidas
-- Função chamada pelo frontend ao abrir o módulo de Faturamento.
-- Marca invoices como 'overdue' e cria um alerta para cada uma (sem duplicatas).

CREATE OR REPLACE FUNCTION public.detect_overdue_invoices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row RECORD;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    UPDATE public.invoices
    SET status = 'overdue'
    WHERE status IN ('issued', 'partially_paid')
      AND due_date IS NOT NULL
      AND due_date < CURRENT_DATE
    RETURNING id, invoice_number, balance_brl, due_date
  LOOP
    -- Cria alerta apenas se não existe um aberto/reconhecido para esta invoice
    INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
    SELECT
      'invoice_overdue',
      'invoice',
      v_row.id::text,
      format(
        'Invoice %s venceu em %s — saldo pendente: R$ %s',
        COALESCE(v_row.invoice_number, 'INV-' || v_row.id),
        to_char(v_row.due_date, 'DD/MM/YYYY'),
        to_char(COALESCE(v_row.balance_brl, 0), 'FM999,999,990.00')
      ),
      'open'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.alerts
      WHERE type = 'invoice_overdue'
        AND entity_id = v_row.id::text
        AND status != 'closed'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
