-- Cadastro das tarifas de demurrage do Brasil conforme tabela operacional.
-- Cada tipo do grupo é uma tarifa independente, embora compartilhe os mesmos valores.

INSERT INTO public.demurrage_rates
  (container_type, free_days, p1_day_from, p1_day_to, p1_usd, p2_day_from, p2_usd, notes)
SELECT v.container_type, v.free_days, v.p1_day_from, v.p1_day_to, v.p1_usd, v.p2_day_from, v.p2_usd,
       'Brasil — dias corridos'
FROM (VALUES
  ('20GP', 21, 22, 30, 30::numeric, 31,  50::numeric),
  ('20HC', 21, 22, 30, 30::numeric, 31,  50::numeric),
  ('40GP', 21, 22, 30, 60::numeric, 31,  80::numeric),
  ('40HC', 21, 22, 30, 60::numeric, 31,  80::numeric),
  ('20FR', 21, 22, 30, 50::numeric, 31,  80::numeric),
  ('20OT', 21, 22, 30, 50::numeric, 31,  80::numeric),
  ('40FR', 21, 22, 30, 100::numeric, 31, 140::numeric),
  ('40OT', 21, 22, 30, 100::numeric, 31, 140::numeric),
  ('20RF', 10, 11, 19, 95::numeric, 20, 110::numeric),
  ('20RQ', 10, 11, 19, 95::numeric, 20, 110::numeric),
  ('40RF', 10, 11, 19, 190::numeric, 20, 220::numeric),
  ('40RQ', 10, 11, 19, 190::numeric, 20, 220::numeric)
) AS v(container_type, free_days, p1_day_from, p1_day_to, p1_usd, p2_day_from, p2_usd)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.demurrage_rates existing
  WHERE upper(trim(existing.container_type)) = v.container_type
    AND existing.valid_to IS NULL
);
