-- Vazios/ADR: operacao de vazios da escala, overtime por depot e servicos
-- extra de reorganizacao (spec 2026-07-19, blocos EMBARQUE CONTAINER VAZIO,
-- OVER TIME e SERVICO EXTRA do modelo real).
-- Intent: OS por (viagem, porto); % de overtime aplicado por depot (as
--   quantidades derivam das flags por container da migration 208); servicos
--   bundle/desova/visual_check com qty por tipo x tarifa configuravel
--   (mesmo padrao de granite_rates — tarifas nunca fixas em codigo).
-- Rollback: DROP TABLE das quatro tabelas.

CREATE TABLE IF NOT EXISTS public.vazios_export_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voyage_id BIGINT NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  embark_port TEXT NOT NULL,
  os_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (voyage_id, embark_port)
);

CREATE TABLE IF NOT EXISTS public.vazios_export_overtime_depots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES public.vazios_export_operations(id) ON DELETE CASCADE,
  depot TEXT NOT NULL,
  percent NUMERIC(5,2) NOT NULL CHECK (percent >= 0),
  UNIQUE (operation_id, depot)
);

CREATE TABLE IF NOT EXISTS public.vazios_reorg_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES public.vazios_export_operations(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN ('bundle', 'desova', 'visual_check')),
  container_type TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty >= 0),
  UNIQUE (operation_id, service, container_type)
);

CREATE TABLE IF NOT EXISTS public.vazios_reorg_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL CHECK (service IN ('bundle', 'desova', 'visual_check')),
  rate_brl NUMERIC(10,2) NOT NULL CHECK (rate_brl >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vazios_export_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vazios_export_overtime_depots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vazios_reorg_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vazios_reorg_rates ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vazios_export_operations', 'vazios_export_overtime_depots',
    'vazios_reorg_services', 'vazios_reorg_rates'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_select ON public.%I FOR SELECT TO authenticated USING (public.is_active_user())', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON public.%I FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user())', t, t);
  END LOOP;
END $$;
