-- Remove a publication member with no application consumer.
-- The table, RPCs, policies, grants, and publication itself remain intact.
-- Rollback: ALTER PUBLICATION supabase_realtime ADD TABLE public.vessel_schedules;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'vessel_schedules'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.vessel_schedules;
  END IF;
END
$$;
