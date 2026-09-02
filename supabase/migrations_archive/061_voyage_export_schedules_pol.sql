-- Renumbered from 20260521110000 (original timestamped migration: 20260521110000_voyage_export_schedules_pol.sql).
ALTER TABLE public.voyage_export_schedules
  ADD COLUMN IF NOT EXISTS pol TEXT;
