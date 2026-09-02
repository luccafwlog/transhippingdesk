-- Corrige inferencia de ON CONFLICT (bl_id, calculation_key) usada na RPC
-- calculate_bl_local_charges.
-- O indice parcial nao permite essa inferencia; precisamos de indice unico pleno.

DROP INDEX IF EXISTS public.uq_charge_calculations_bl_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_charge_calculations_bl_key
ON public.charge_calculations (bl_id, calculation_key);

