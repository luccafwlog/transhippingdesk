-- Modulo Granito: granite_manifests, granite_bls, granite_rates, granite_bl_charges

CREATE TABLE IF NOT EXISTS public.granite_manifests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voyage_id       BIGINT REFERENCES public.voyages(id) ON DELETE SET NULL,
  vessel_voyage   TEXT NOT NULL,
  loading_port    TEXT,
  discharge_port  TEXT,
  total_bls       INTEGER,
  total_weight_kg NUMERIC(14,3),
  imported_at     TIMESTAMPTZ DEFAULT now(),
  imported_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_granite_manifests_voyage_id ON public.granite_manifests(voyage_id);

CREATE TABLE IF NOT EXISTS public.granite_bls (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id          UUID NOT NULL REFERENCES public.granite_manifests(id) ON DELETE CASCADE,
  client_id            BIGINT REFERENCES public.customers(id) ON DELETE SET NULL,
  sequence             INTEGER,
  booking_number       TEXT,
  bl_number            TEXT NOT NULL,
  shipper_ref          TEXT,
  vessel_voyage        TEXT,
  loading_port         TEXT,
  discharge_port       TEXT,
  shipper_name         TEXT,
  shipper_cnpj         TEXT,
  consignee_name       TEXT,
  charter              TEXT,
  shipper_m3           NUMERIC(12,3),
  shipper_weight_kg    NUMERIC(14,3),
  blocks_qty           INTEGER,
  received_blocks_qty  INTEGER,
  final_m3             NUMERIC(12,3),
  real_weight_kg       NUMERIC(14,3),
  stockyard            TEXT,
  remarks              TEXT,
  partial_restriction  BOOLEAN DEFAULT false,
  cosco_transport      TEXT,
  fragile_blocks       INTEGER,
  cssc_selection       TEXT,
  cargo_readiness_date DATE,
  phase                TEXT,
  charge_status        TEXT NOT NULL DEFAULT 'not_calculated'
    CHECK (charge_status IN ('not_calculated','calculated','ready_for_billing','invoiced')),
  created_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE (manifest_id, bl_number)
);

CREATE INDEX IF NOT EXISTS idx_granite_bls_manifest_id ON public.granite_bls(manifest_id);
CREATE INDEX IF NOT EXISTS idx_granite_bls_client_id   ON public.granite_bls(client_id);

CREATE TABLE IF NOT EXISTS public.granite_rates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  charge_type TEXT NOT NULL CHECK (charge_type IN ('per_kg','per_ton','per_bl','fixed')),
  unit_value  NUMERIC(12,4) NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'BRL',
  valid_from  DATE,
  valid_to    DATE,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.granite_bl_charges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bl_id         UUID NOT NULL REFERENCES public.granite_bls(id) ON DELETE CASCADE,
  rate_id       UUID REFERENCES public.granite_rates(id) ON DELETE SET NULL,
  description   TEXT,
  charge_type   TEXT,
  unit_value    NUMERIC(12,4),
  quantity      NUMERIC(14,3),
  subtotal      NUMERIC(12,2),
  currency      TEXT,
  calculated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_granite_bl_charges_bl_id ON public.granite_bl_charges(bl_id);

-- RLS

ALTER TABLE public.granite_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.granite_bls       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.granite_rates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.granite_bl_charges ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN

  -- granite_manifests
  DROP POLICY IF EXISTS granite_manifests_select ON public.granite_manifests;
  CREATE POLICY granite_manifests_select ON public.granite_manifests FOR SELECT TO authenticated USING (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS granite_manifests_insert ON public.granite_manifests;
  CREATE POLICY granite_manifests_insert ON public.granite_manifests FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS granite_manifests_update ON public.granite_manifests;
  CREATE POLICY granite_manifests_update ON public.granite_manifests FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS granite_manifests_delete ON public.granite_manifests;
  CREATE POLICY granite_manifests_delete ON public.granite_manifests FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

  -- granite_bls
  DROP POLICY IF EXISTS granite_bls_select ON public.granite_bls;
  CREATE POLICY granite_bls_select ON public.granite_bls FOR SELECT TO authenticated USING (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS granite_bls_insert ON public.granite_bls;
  CREATE POLICY granite_bls_insert ON public.granite_bls FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS granite_bls_update ON public.granite_bls;
  CREATE POLICY granite_bls_update ON public.granite_bls FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS granite_bls_delete ON public.granite_bls;
  CREATE POLICY granite_bls_delete ON public.granite_bls FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

  -- granite_rates
  DROP POLICY IF EXISTS granite_rates_select ON public.granite_rates;
  CREATE POLICY granite_rates_select ON public.granite_rates FOR SELECT TO authenticated USING (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS granite_rates_insert ON public.granite_rates;
  CREATE POLICY granite_rates_insert ON public.granite_rates FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS granite_rates_update ON public.granite_rates;
  CREATE POLICY granite_rates_update ON public.granite_rates FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS granite_rates_delete ON public.granite_rates;
  CREATE POLICY granite_rates_delete ON public.granite_rates FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

  -- granite_bl_charges
  DROP POLICY IF EXISTS granite_bl_charges_select ON public.granite_bl_charges;
  CREATE POLICY granite_bl_charges_select ON public.granite_bl_charges FOR SELECT TO authenticated USING (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS granite_bl_charges_insert ON public.granite_bl_charges;
  CREATE POLICY granite_bl_charges_insert ON public.granite_bl_charges FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS granite_bl_charges_update ON public.granite_bl_charges;
  CREATE POLICY granite_bl_charges_update ON public.granite_bl_charges FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS granite_bl_charges_delete ON public.granite_bl_charges;
  CREATE POLICY granite_bl_charges_delete ON public.granite_bl_charges FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.granite_manifests  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.granite_bls        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.granite_rates      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.granite_bl_charges TO authenticated;
