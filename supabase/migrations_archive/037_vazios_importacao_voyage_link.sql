-- Vincula manifesto de vazios importacao a uma viagem

ALTER TABLE public.vazios_importacao_manifests
  ADD COLUMN IF NOT EXISTS voyage_id BIGINT REFERENCES public.voyages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vazios_imp_manifests_voyage_id
  ON public.vazios_importacao_manifests(voyage_id);
