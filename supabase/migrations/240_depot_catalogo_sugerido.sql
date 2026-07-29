-- ADR 0033: o Cadastro de Terminais sugere valores; nao calcula custos.

ALTER TABLE public.depot_services
  DROP COLUMN IF EXISTS calc_type,
  DROP COLUMN IF EXISTS subject_to_overtime,
  DROP COLUMN IF EXISTS valid_from,
  DROP COLUMN IF EXISTS valid_to,
  ADD COLUMN IF NOT EXISTS natureza TEXT NOT NULL DEFAULT 'geral',
  ADD COLUMN IF NOT EXISTS container_type TEXT,
  ADD COLUMN IF NOT EXISTS route_destino_id UUID REFERENCES public.depots(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS condition TEXT;

ALTER TABLE public.depot_services
  ADD CONSTRAINT depot_services_natureza_check CHECK (natureza IN ('armazenagem', 'transporte', 'geral')),
  ADD CONSTRAINT depot_services_condition_check CHECK (condition IS NULL OR condition IN ('vazio', 'material'));

INSERT INTO public.depot_services (depot_id, name, natureza, rate_brl)
SELECT d.id, service.name, service.natureza, 0
FROM public.depots d
CROSS JOIN (VALUES
  ('armazenagem', 'armazenagem'), ('transporte', 'transporte'), ('handling in', 'geral'),
  ('handling out', 'geral'), ('overtime handling', 'geral'), ('overtime transporte', 'transporte'),
  ('bundle composition', 'geral'), ('bundle organization', 'geral'), ('visual check', 'geral'),
  ('remoção', 'geral')
) AS service(name, natureza)
WHERE NOT EXISTS (SELECT 1 FROM public.depot_services s WHERE s.depot_id = d.id AND lower(s.name) = lower(service.name));
