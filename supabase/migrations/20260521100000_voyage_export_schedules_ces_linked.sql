ALTER TABLE public.voyage_export_schedules
  ADD COLUMN IF NOT EXISTS ce_status TEXT DEFAULT 'waiting'
    CONSTRAINT voyage_export_schedules_ce_status_check
    CHECK (ce_status IN ('waiting', 'received', 'launching', 'approving', 'approved')),
  ADD COLUMN IF NOT EXISTS linked BOOLEAN NOT NULL DEFAULT false;
