-- Compatibilidade: alguns ambientes estavam sem campos BB em public.bls.
-- Este patch garante as colunas usadas por manifestos BB e motor de taxas locais.

ALTER TABLE public.bls
  ADD COLUMN IF NOT EXISTS bb_machine_qty NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS bb_packages_qty NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS bb_packages_total NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS bb_weight_ton NUMERIC(12,3);

UPDATE public.bls AS bl
SET
  bb_packages_qty = COALESCE(bl.bb_packages_qty, items.total_packages),
  bb_packages_total = COALESCE(bl.bb_packages_total, items.total_packages),
  bb_weight_ton = COALESCE(bl.bb_weight_ton, items.total_weight_kg / 1000.0)
FROM (
  SELECT
    bl_id,
    SUM(COALESCE(package_qty, 0)) AS total_packages,
    SUM(COALESCE(gross_weight_kg, 0)) AS total_weight_kg
  FROM public.bl_breakbulk_items
  GROUP BY bl_id
) AS items
WHERE bl.id = items.bl_id
  AND COALESCE(bl.cargo_mode, 'container') = 'carga_solta';

