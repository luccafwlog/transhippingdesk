-- 344_escala_terminal_trigger_after_columns.sql
-- Reinstala o trigger com ETB/ETD somente depois que 341 criar essas colunas.

DROP TRIGGER IF EXISTS reconcile_voyage_operation_alerts_on_terminal_change
  ON public.voyage_escala_terminal_state;

CREATE TRIGGER reconcile_voyage_operation_alerts_on_terminal_change
  AFTER INSERT OR UPDATE OF port, terminal_id, terminal_etb, terminal_atb, terminal_etd, terminal_atd, terminal_rtw
  ON public.voyage_escala_terminal_state
  FOR EACH ROW EXECUTE FUNCTION public.reconcile_voyage_operation_alerts_on_terminal_change();
