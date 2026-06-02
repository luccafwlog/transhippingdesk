CREATE TABLE IF NOT EXISTS public.baplie_reconciliation_resolutions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  voyage_id BIGINT NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  bl_container_id BIGINT NOT NULL REFERENCES public.bl_containers(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL CHECK (field_name IN ('is_imo', 'imo_class', 'un_number')),
  baplie_value TEXT NOT NULL,
  manifest_value TEXT NOT NULL,
  resolution TEXT NOT NULL DEFAULT 'manifest' CHECK (resolution = 'manifest'),
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (voyage_id, bl_container_id, field_name, baplie_value, manifest_value, resolution)
);

CREATE INDEX IF NOT EXISTS baplie_reconciliation_resolutions_voyage_idx
  ON public.baplie_reconciliation_resolutions(voyage_id, bl_container_id);

ALTER TABLE public.baplie_reconciliation_resolutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read baplie_reconciliation_resolutions"
  ON public.baplie_reconciliation_resolutions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert baplie_reconciliation_resolutions"
  ON public.baplie_reconciliation_resolutions FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update baplie_reconciliation_resolutions"
  ON public.baplie_reconciliation_resolutions FOR UPDATE
  TO authenticated
  USING (true);
