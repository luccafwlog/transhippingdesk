-- Renumbered from 20260520142818 (original timestamped migration: 20260520142818_add_pod_to_vazios_importacao_containers.sql).
ALTER TABLE public.vazios_importacao_containers
  ADD COLUMN IF NOT EXISTS pod TEXT;
