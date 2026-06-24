-- Demurrage Fase 2.3 — Remove o conceito de 'overdue' do Demurrage (ADR 0014).
-- Intent: sob recálculo diário não há vencimento. mark_overdue_invoices passa a
--   tratar apenas faturas de taxas locais (public.invoices); o trecho de demurrage
--   é removido. Faturas de demurrage já marcadas 'overdue' voltam a 'issued'.
-- Escopo: comportamental. O job pg_cron e a parte de taxas locais permanecem.
-- Rollback: restaurar o corpo de mark_overdue_invoices de 031_overdue_enforcement.sql
--   e re-marcar as faturas (não recomendado).

CREATE OR REPLACE FUNCTION public.mark_overdue_invoices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Apenas faturas de taxas locais. Demurrage não tem vencimento sob recálculo
  -- diário (ADR 0014) e não é mais tocado aqui.
  UPDATE public.invoices
  SET status = 'overdue'
  WHERE status = 'issued'
    AND due_date < CURRENT_DATE;
END;
$$;

-- Backfill: faturas de demurrage que o job antigo marcou 'overdue' voltam a 'issued'.
UPDATE public.demurrage_invoices
SET status = 'issued'
WHERE status = 'overdue';
