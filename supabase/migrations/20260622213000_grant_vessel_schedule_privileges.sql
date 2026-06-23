-- Policies alone do not grant table privileges on a clean database.
-- RLS remains the authority for which authenticated profiles may write.
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.vessel_schedules
TO authenticated;

GRANT SELECT, INSERT, DELETE
ON TABLE public.ended_vessels
TO authenticated;
