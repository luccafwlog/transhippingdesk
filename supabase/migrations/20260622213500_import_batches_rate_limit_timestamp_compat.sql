-- import_manifest_transactional historically counts recent batches by
-- import_batches.created_at, while the canonical timestamp is uploaded_at.
-- Keep deployed function versions working without duplicating mutable state.
ALTER TABLE public.import_batches
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ
GENERATED ALWAYS AS (uploaded_at) STORED;
