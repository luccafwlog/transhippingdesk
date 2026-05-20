ALTER TABLE public.vazios_importacao_manifests
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
  CONSTRAINT vazios_imp_manifests_source_check CHECK (source IN ('manual', 'baplie'));
