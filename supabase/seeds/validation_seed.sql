INSERT INTO public.carriers (name, scac)
VALUES ('Armador Validação', 'VALD')
ON CONFLICT DO NOTHING;

INSERT INTO public.vessels (name, imo, carrier_id)
SELECT 'MV VALIDACAO', '9999999', carriers.id
FROM public.carriers
WHERE carriers.scac = 'VALD'
ON CONFLICT DO NOTHING;

INSERT INTO public.ports (name, locode, country)
VALUES
  ('Shanghai', 'CNSHA', 'China'),
  ('Santos', 'BRSSZ', 'Brasil')
ON CONFLICT DO NOTHING;

INSERT INTO public.voyages (vessel_id, voyage_number, pol_id, pod_id, etd, eta, status)
SELECT
  vessels.id,
  '001W',
  pol.id,
  pod.id,
  now() - interval '15 days',
  now() + interval '5 days',
  'active'
FROM public.vessels vessels
CROSS JOIN public.ports pol
CROSS JOIN public.ports pod
WHERE vessels.name = 'MV VALIDACAO'
  AND pol.locode = 'CNSHA'
  AND pod.locode = 'BRSSZ'
  AND NOT EXISTS (
    SELECT 1
    FROM public.voyages existing
    WHERE existing.vessel_id = vessels.id
      AND existing.voyage_number = '001W'
  );
