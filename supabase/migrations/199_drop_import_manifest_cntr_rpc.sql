-- ADR 0025: Manifesto CNTR deixa de ser fonte de ingestao. A RPC transacional
-- do importador e removida; migrations historicas permanecem preservadas.
-- A migration 165 substituiu a assinatura historica de 13 argumentos pela
-- assinatura ativa de 14 argumentos, por isso ambas sao removidas explicitamente.
DROP FUNCTION IF EXISTS public.import_manifest_with_postprocess_transactional(
  TEXT,
  BIGINT,
  UUID,
  TEXT,
  TEXT,
  INTEGER,
  INTEGER,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB
);

DROP FUNCTION IF EXISTS public.import_manifest_with_postprocess_transactional(
  TEXT,
  BIGINT,
  UUID,
  TEXT,
  TEXT,
  INTEGER,
  INTEGER,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  JSONB,
  BOOLEAN
);

-- Rollback/recovery:
--   Recrie a assinatura ativa de 14 argumentos e seus privilegios a partir da
--   migration 165_manifest_overwrite_opt_in.sql somente se a ADR 0025 for revertida.
--   A assinatura historica de 13 argumentos nao deve ser recriada. Nenhum dado
--   precisa de rollback porque esta migration remove apenas funcoes.
