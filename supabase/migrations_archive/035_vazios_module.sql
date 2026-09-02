-- Modulo Vazios: vazios_manifests, vazios_bookings

CREATE TABLE IF NOT EXISTS public.vazios_manifests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voyage_id      BIGINT REFERENCES public.voyages(id) ON DELETE SET NULL,
  description    TEXT,
  total_bookings INTEGER,
  imported_at    TIMESTAMPTZ DEFAULT now(),
  imported_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_vazios_manifests_voyage_id ON public.vazios_manifests(voyage_id);

CREATE TABLE IF NOT EXISTS public.vazios_bookings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id      UUID NOT NULL REFERENCES public.vazios_manifests(id) ON DELETE CASCADE,
  booking_number   TEXT NOT NULL,
  container_number TEXT,
  container_type   TEXT,
  movement_date    DATE,
  origin_terminal  TEXT,
  destination      TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (manifest_id, booking_number)
);

CREATE INDEX IF NOT EXISTS idx_vazios_bookings_manifest_id ON public.vazios_bookings(manifest_id);

-- RLS

ALTER TABLE public.vazios_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vazios_bookings  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN

  -- vazios_manifests
  DROP POLICY IF EXISTS vazios_manifests_select ON public.vazios_manifests;
  CREATE POLICY vazios_manifests_select ON public.vazios_manifests FOR SELECT TO authenticated USING (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS vazios_manifests_insert ON public.vazios_manifests;
  CREATE POLICY vazios_manifests_insert ON public.vazios_manifests FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS vazios_manifests_update ON public.vazios_manifests;
  CREATE POLICY vazios_manifests_update ON public.vazios_manifests FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS vazios_manifests_delete ON public.vazios_manifests;
  CREATE POLICY vazios_manifests_delete ON public.vazios_manifests FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

  -- vazios_bookings
  DROP POLICY IF EXISTS vazios_bookings_select ON public.vazios_bookings;
  CREATE POLICY vazios_bookings_select ON public.vazios_bookings FOR SELECT TO authenticated USING (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS vazios_bookings_insert ON public.vazios_bookings;
  CREATE POLICY vazios_bookings_insert ON public.vazios_bookings FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS vazios_bookings_update ON public.vazios_bookings;
  CREATE POLICY vazios_bookings_update ON public.vazios_bookings FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS vazios_bookings_delete ON public.vazios_bookings;
  CREATE POLICY vazios_bookings_delete ON public.vazios_bookings FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vazios_manifests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vazios_bookings  TO authenticated;
