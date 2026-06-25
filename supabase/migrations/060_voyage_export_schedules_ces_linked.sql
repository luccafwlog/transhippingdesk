-- Renumbered from 20260521100000 (original timestamped migration: 20260521100000_voyage_export_schedules_ces_linked.sql).
ALTER TABLE public.voyage_export_schedules
  ADD COLUMN IF NOT EXISTS ce_status TEXT DEFAULT 'waiting'
    CONSTRAINT voyage_export_schedules_ce_status_check
    CHECK (ce_status IN ('waiting', 'received', 'launching', 'approving', 'approved')),
  ADD COLUMN IF NOT EXISTS linked BOOLEAN NOT NULL DEFAULT false;
