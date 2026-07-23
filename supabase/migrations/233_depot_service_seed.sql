-- Migra tarifas de reorganizacao para servicos por depot quando ha origem.
-- Sem depots ou bookings legados, a migration e um no-op seguro.

INSERT INTO public.depots (code, name, active)
SELECT DISTINCT btrim(depot), btrim(depot), TRUE
FROM public.vazios_bookings
WHERE NULLIF(btrim(depot), '') IS NOT NULL
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.depot_services (depot_id, name, charge_basis, rate_brl, active, valid_from, valid_to)
SELECT d.id, r.service, CASE WHEN r.service = 'visual_check' THEN 'per_container_flag' ELSE 'per_operation_qty' END,
  r.rate_brl, r.active, r.valid_from, r.valid_to
FROM public.depots d
CROSS JOIN public.vazios_reorg_rates r
WHERE NOT EXISTS (
  SELECT 1 FROM public.depot_services existing
  WHERE existing.depot_id = d.id AND existing.name = r.service
);
