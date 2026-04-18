-- Modulo Vazios Importacao: manifestos de containers vazios de importacao
-- Formato simples: container_number, container_type, tare_kg

CREATE TABLE IF NOT EXISTS public.vazios_importacao_manifests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description       TEXT,
  total_containers  INTEGER,
  imported_at       TIMESTAMPTZ DEFAULT now(),
  imported_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.vazios_importacao_containers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id      UUID NOT NULL REFERENCES public.vazios_importacao_manifests(id) ON DELETE CASCADE,
  container_number TEXT NOT NULL,
  container_type   TEXT,
  tare_kg          NUMERIC,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (manifest_id, container_number)
);

CREATE INDEX IF NOT EXISTS idx_vazios_imp_manifests ON public.vazios_importacao_manifests(imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_vazios_imp_containers_manifest ON public.vazios_importacao_containers(manifest_id);

-- RLS

ALTER TABLE public.vazios_importacao_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vazios_importacao_containers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN

  -- vazios_importacao_manifests
  DROP POLICY IF EXISTS vazios_imp_manifests_select ON public.vazios_importacao_manifests;
  CREATE POLICY vazios_imp_manifests_select ON public.vazios_importacao_manifests FOR SELECT TO authenticated USING (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS vazios_imp_manifests_insert ON public.vazios_importacao_manifests;
  CREATE POLICY vazios_imp_manifests_insert ON public.vazios_importacao_manifests FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS vazios_imp_manifests_update ON public.vazios_importacao_manifests;
  CREATE POLICY vazios_imp_manifests_update ON public.vazios_importacao_manifests FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS vazios_imp_manifests_delete ON public.vazios_importacao_manifests;
  CREATE POLICY vazios_imp_manifests_delete ON public.vazios_importacao_manifests FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

  -- vazios_importacao_containers
  DROP POLICY IF EXISTS vazios_imp_containers_select ON public.vazios_importacao_containers;
  CREATE POLICY vazios_imp_containers_select ON public.vazios_importacao_containers FOR SELECT TO authenticated USING (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS vazios_imp_containers_insert ON public.vazios_importacao_containers;
  CREATE POLICY vazios_imp_containers_insert ON public.vazios_importacao_containers FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS vazios_imp_containers_update ON public.vazios_importacao_containers;
  CREATE POLICY vazios_imp_containers_update ON public.vazios_importacao_containers FOR UPDATE TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
  DROP POLICY IF EXISTS vazios_imp_containers_delete ON public.vazios_importacao_containers;
  CREATE POLICY vazios_imp_containers_delete ON public.vazios_importacao_containers FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vazios_importacao_manifests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vazios_importacao_containers  TO authenticated;
