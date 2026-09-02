-- Migration 029: Indexes for container demurrage date columns
-- Columns discharge_date / return_date / demurrage_status were added in 028.

CREATE INDEX IF NOT EXISTS idx_bl_containers_discharge_date
  ON public.bl_containers (discharge_date)
  WHERE discharge_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bl_containers_demurrage_status
  ON public.bl_containers (demurrage_status)
  WHERE demurrage_status IS NOT NULL;
