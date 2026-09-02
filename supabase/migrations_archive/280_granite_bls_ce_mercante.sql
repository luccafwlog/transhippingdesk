-- CE Mercante is the billing confirmation document for Granite B/Ls.
-- Rollback: ALTER TABLE public.granite_bls DROP COLUMN IF EXISTS ce_mercante;

ALTER TABLE public.granite_bls
  ADD COLUMN IF NOT EXISTS ce_mercante TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_granite_bls_ce_mercante
  ON public.granite_bls (btrim(ce_mercante))
  WHERE ce_mercante IS NOT NULL AND btrim(ce_mercante) <> '';
