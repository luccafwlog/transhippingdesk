-- A PK (operation_id, depot_service_id) não indexa depot_service_id isolado; o
-- ON DELETE CASCADE de depot_services faz varredura sem este índice.

CREATE INDEX IF NOT EXISTS idx_vazios_operation_service_qty_service
  ON public.vazios_operation_service_qty (depot_service_id);
