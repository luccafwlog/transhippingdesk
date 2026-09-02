-- Renumbered from 20260520172541 (original timestamped migration: 20260520172541_vazios_importacao_source.sql).
ALTER TABLE public.vazios_importacao_manifests
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
  CONSTRAINT vazios_imp_manifests_source_check CHECK (source IN ('manual', 'baplie'));
