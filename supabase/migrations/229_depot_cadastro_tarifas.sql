-- Cadastro de Depot: entidade registrada + tarifas e servicos (ADR 0031).

CREATE TABLE IF NOT EXISTS public.depots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT,
  pol_port TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.depot_tariffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  depot_id UUID NOT NULL REFERENCES public.depots(id) ON DELETE CASCADE,
  handling_in_brl NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (handling_in_brl >= 0),
  handling_out_brl NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (handling_out_brl >= 0),
  transporte_brl NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (transporte_brl >= 0),
  storage_day_brl NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (storage_day_brl >= 0),
  free_time_days INTEGER NOT NULL DEFAULT 0 CHECK (free_time_days >= 0),
  valid_from DATE NOT NULL,
  valid_to DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS idx_depot_tariffs_depot ON public.depot_tariffs(depot_id);

CREATE TABLE IF NOT EXISTS public.depot_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  depot_id UUID NOT NULL REFERENCES public.depots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  charge_basis TEXT NOT NULL CHECK (charge_basis IN ('per_container_flag', 'per_operation_qty')),
  rate_brl NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (rate_brl >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from DATE NOT NULL,
  valid_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (depot_id, name),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS idx_depot_services_depot ON public.depot_services(depot_id);

ALTER TABLE public.depots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.depot_tariffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.depot_services ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.depots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.depot_tariffs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.depot_services TO authenticated;
