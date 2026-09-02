-- Renumbered from 20260521000000 (original timestamped migration: 20260521000000_voyage_export_schedules.sql).
CREATE TABLE IF NOT EXISTS public.voyage_export_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voyage_id INTEGER NOT NULL UNIQUE REFERENCES public.voyages(id) ON DELETE CASCADE,
  has_granite BOOLEAN NOT NULL DEFAULT false,
  containers_qty INTEGER,
  movements_qty INTEGER,
  eta DATE,
  etb DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON public.voyage_export_schedules(voyage_id);

ALTER TABLE public.voyage_export_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read voyage_export_schedules"
  ON public.voyage_export_schedules FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert voyage_export_schedules"
  ON public.voyage_export_schedules FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update voyage_export_schedules"
  ON public.voyage_export_schedules FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete voyage_export_schedules"
  ON public.voyage_export_schedules FOR DELETE
  TO authenticated
  USING (true);
