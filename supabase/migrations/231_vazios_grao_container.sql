-- VAZIOS EXP: container como identidade e campos da planilha real (ADR 0031).
-- O ambiente atual nao possui dados legados; a troca de chave e intencional.

ALTER TABLE public.vazios_bookings
  ADD COLUMN IF NOT EXISTS voyage_id BIGINT REFERENCES public.voyages(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS os_number TEXT,
  ADD COLUMN IF NOT EXISTS depot_id UUID REFERENCES public.depots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS condition TEXT CHECK (condition IS NULL OR condition IN ('empty', 'damage', 'material')),
  ADD COLUMN IF NOT EXISTS visual_check BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS overtime_handling_pct NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (overtime_handling_pct >= 0),
  ADD COLUMN IF NOT EXISTS overtime_transport_pct NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (overtime_transport_pct >= 0);

UPDATE public.vazios_bookings booking
SET voyage_id = manifest.voyage_id
FROM public.vazios_manifests manifest
WHERE booking.manifest_id = manifest.id AND booking.voyage_id IS NULL;

UPDATE public.vazios_bookings booking
SET depot_id = depot.id
FROM public.depots depot
WHERE booking.depot_id IS NULL AND booking.depot IS NOT NULL AND lower(depot.code) = lower(booking.depot);

ALTER TABLE public.vazios_bookings DROP CONSTRAINT IF EXISTS vazios_bookings_manifest_id_booking_number_key;
ALTER TABLE public.vazios_bookings ALTER COLUMN booking_number DROP NOT NULL;
ALTER TABLE public.vazios_bookings ALTER COLUMN voyage_id SET NOT NULL;
ALTER TABLE public.vazios_bookings ALTER COLUMN container_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vazios_bookings_voyage_container
  ON public.vazios_bookings(voyage_id, container_number);
CREATE INDEX IF NOT EXISTS idx_vazios_bookings_voyage_id ON public.vazios_bookings(voyage_id);
