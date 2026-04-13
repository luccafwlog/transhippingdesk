ALTER TABLE public.bls
  ADD COLUMN IF NOT EXISTS ce_mercante TEXT;

UPDATE public.bls
SET ce_mercante = NULL
WHERE trim(coalesce(ce_mercante, '')) = '';

CREATE INDEX IF NOT EXISTS idx_bls_ce_mercante
  ON public.bls(ce_mercante);
