-- 344_escala_terminal_trigger_after_columns.sql
-- Repara bases em que a migration 341 foi pulada por causa do prefixo duplicado
-- e reinstala o trigger somente depois que ETB/ETD existirem.

ALTER TABLE public.voyage_escala_terminal_state
  ADD COLUMN IF NOT EXISTS terminal_etb TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terminal_etd TIMESTAMPTZ;

DROP TRIGGER IF EXISTS reconcile_voyage_operation_alerts_on_terminal_change
  ON public.voyage_escala_terminal_state;

CREATE TRIGGER reconcile_voyage_operation_alerts_on_terminal_change
  AFTER INSERT OR UPDATE OF port, terminal_id, terminal_etb, terminal_atb, terminal_etd, terminal_atd, terminal_rtw
  ON public.voyage_escala_terminal_state
  FOR EACH ROW EXECUTE FUNCTION public.reconcile_voyage_operation_alerts_on_terminal_change();
