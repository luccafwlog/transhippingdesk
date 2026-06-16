-- Adiciona o número do CE Master (Sistema Mercante) por manifesto.
--
-- Contexto: cada manifesto (import_batch) tem um CE Mercante master que
-- agrupa a carga daquele manifesto, acompanhado para fins de Mercante.
-- É distinto dos CEs por B/L (bls.ce_mercante). Preenchido inline na página
-- Viagens, depois da importação.
--
-- RLS: import_batches já é tabela operacional (010_rls_by_role.sql) —
-- operador ativo pode UPDATE; DELETE só admin. Nenhuma policy nova é
-- necessária para editar esta coluna.
--
-- Rollback: ALTER TABLE public.import_batches DROP COLUMN IF EXISTS ce_master;

ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS ce_master TEXT;

COMMENT ON COLUMN public.import_batches.ce_master IS
  'Número do CE Mercante master do manifesto (Sistema Mercante). Distinto dos CEs por B/L em bls.ce_mercante.';
