-- Billing orchestration, customer reconciliation and portal access
-- Phase 1

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------

ALTER TABLE public.bls
  ADD COLUMN IF NOT EXISTS manifest_customer_cnpj_cpf TEXT,
  ADD COLUMN IF NOT EXISTS manifest_customer_name TEXT,
  ADD COLUMN IF NOT EXISTS manifest_customer_email TEXT,
  ADD COLUMN IF NOT EXISTS customer_reconciliation_status TEXT,
  ADD COLUMN IF NOT EXISTS customer_reconciliation_notes TEXT,
  ADD COLUMN IF NOT EXISTS billing_hold_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_billing_run_id BIGINT;

UPDATE public.bls
SET
  manifest_customer_cnpj_cpf = COALESCE(manifest_customer_cnpj_cpf, NULLIF(regexp_replace(COALESCE(consignee, ''), '\D', '', 'g'), '')),
  manifest_customer_name = COALESCE(manifest_customer_name, consignee),
  customer_reconciliation_status = COALESCE(
    customer_reconciliation_status,
    CASE
      WHEN customer_id IS NOT NULL THEN 'reconciled'
      ELSE 'missing_customer'
    END
  ),
  customer_reconciliation_notes = COALESCE(
    customer_reconciliation_notes,
    CASE
      WHEN customer_id IS NOT NULL THEN 'Vinculo legado preservado na migracao.'
      ELSE 'Cliente ainda nao reconciliado.'
    END
  )
WHERE customer_reconciliation_status IS NULL
   OR manifest_customer_name IS NULL
   OR customer_reconciliation_notes IS NULL;

ALTER TABLE public.bls
  ALTER COLUMN customer_reconciliation_status SET DEFAULT 'missing_customer';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bls_customer_reconciliation_status_check'
  ) THEN
    ALTER TABLE public.bls
      ADD CONSTRAINT bls_customer_reconciliation_status_check
      CHECK (
        customer_reconciliation_status IN (
          'matched_document',
          'matched_name',
          'missing_customer',
          'reconciled',
          'rejected'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bls_customer_reconciliation_status
  ON public.bls (customer_reconciliation_status);

CREATE TABLE IF NOT EXISTS public.pricing_rule_versions (
  id BIGSERIAL PRIMARY KEY,
  version_key TEXT NOT NULL UNIQUE,
  charge_table_id BIGINT REFERENCES public.charge_tables(id) ON DELETE SET NULL,
  charge_item_id BIGINT REFERENCES public.charge_table_items(id) ON DELETE SET NULL,
  customer_id BIGINT REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_rate_override_id BIGINT REFERENCES public.customer_rate_overrides(id) ON DELETE SET NULL,
  reference_date DATE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_rule_versions_item_customer
  ON public.pricing_rule_versions (charge_item_id, customer_id, reference_date);

CREATE TABLE IF NOT EXISTS public.billing_runs (
  id BIGSERIAL PRIMARY KEY,
  manifest_id BIGINT NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  trigger_source TEXT NOT NULL DEFAULT 'manifest_import',
  status TEXT NOT NULL DEFAULT 'running',
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  input_hash TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  total_bls INTEGER NOT NULL DEFAULT 0,
  eligible_bls INTEGER NOT NULL DEFAULT 0,
  blocked_bls INTEGER NOT NULL DEFAULT 0,
  calculated_bls INTEGER NOT NULL DEFAULT 0,
  total_brl NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'billing_runs_trigger_source_check'
  ) THEN
    ALTER TABLE public.billing_runs
      ADD CONSTRAINT billing_runs_trigger_source_check
      CHECK (trigger_source IN ('manifest_import', 'manual_reprocess', 'manual_reconciliation'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'billing_runs_status_check'
  ) THEN
    ALTER TABLE public.billing_runs
      ADD CONSTRAINT billing_runs_status_check
      CHECK (status IN ('running', 'completed', 'completed_with_blocks', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_billing_runs_manifest_id
  ON public.billing_runs (manifest_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.billing_run_logs (
  id BIGSERIAL PRIMARY KEY,
  billing_run_id BIGINT NOT NULL REFERENCES public.billing_runs(id) ON DELETE CASCADE,
  manifest_id BIGINT NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  bl_id TEXT REFERENCES public.bls(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info',
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'billing_run_logs_level_check'
  ) THEN
    ALTER TABLE public.billing_run_logs
      ADD CONSTRAINT billing_run_logs_level_check
      CHECK (level IN ('info', 'warning', 'error'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_billing_run_logs_run_id
  ON public.billing_run_logs (billing_run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.customer_reconciliation_queue (
  id BIGSERIAL PRIMARY KEY,
  manifest_id BIGINT REFERENCES public.import_batches(id) ON DELETE CASCADE,
  bl_id TEXT NOT NULL REFERENCES public.bls(id) ON DELETE CASCADE,
  customer_id BIGINT REFERENCES public.customers(id) ON DELETE SET NULL,
  cnpj_cpf TEXT,
  manifest_customer_name TEXT,
  manifest_customer_email TEXT,
  detection_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  resolution_notes TEXT,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bl_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customer_reconciliation_queue_detection_type_check'
  ) THEN
    ALTER TABLE public.customer_reconciliation_queue
      ADD CONSTRAINT customer_reconciliation_queue_detection_type_check
      CHECK (detection_type IN ('document', 'name', 'missing', 'manual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customer_reconciliation_queue_status_check'
  ) THEN
    ALTER TABLE public.customer_reconciliation_queue
      ADD CONSTRAINT customer_reconciliation_queue_status_check
      CHECK (status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

DROP TRIGGER IF EXISTS set_customer_reconciliation_queue_updated_at ON public.customer_reconciliation_queue;
CREATE TRIGGER set_customer_reconciliation_queue_updated_at
BEFORE UPDATE ON public.customer_reconciliation_queue
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_customer_reconciliation_queue_status
  ON public.customer_reconciliation_queue (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.customer_portal_accounts (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL UNIQUE REFERENCES public.customers(id) ON DELETE CASCADE,
  contact_email TEXT,
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_customer_portal_accounts_updated_at ON public.customer_portal_accounts;
CREATE TRIGGER set_customer_portal_accounts_updated_at
BEFORE UPDATE ON public.customer_portal_accounts
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.customer_portal_sessions (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES public.customer_portal_accounts(id) ON DELETE CASCADE,
  customer_id BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_portal_sessions_active
  ON public.customer_portal_sessions (customer_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.billing_batches (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  origin TEXT NOT NULL DEFAULT 'internal',
  status TEXT NOT NULL DEFAULT 'requested',
  notes TEXT,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  portal_account_id BIGINT REFERENCES public.customer_portal_accounts(id) ON DELETE SET NULL,
  invoice_id BIGINT REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'billing_batches_origin_check'
  ) THEN
    ALTER TABLE public.billing_batches
      ADD CONSTRAINT billing_batches_origin_check
      CHECK (origin IN ('internal', 'portal'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'billing_batches_status_check'
  ) THEN
    ALTER TABLE public.billing_batches
      ADD CONSTRAINT billing_batches_status_check
      CHECK (status IN ('requested', 'issued', 'cancelled', 'failed'));
  END IF;
END $$;

DROP TRIGGER IF EXISTS set_billing_batches_updated_at ON public.billing_batches;
CREATE TRIGGER set_billing_batches_updated_at
BEFORE UPDATE ON public.billing_batches
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.charge_calculations
  ADD COLUMN IF NOT EXISTS manifest_id BIGINT REFERENCES public.import_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS billing_run_id BIGINT REFERENCES public.billing_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pricing_rule_version_id BIGINT REFERENCES public.pricing_rule_versions(id) ON DELETE SET NULL;

UPDATE public.charge_calculations AS cc
SET manifest_id = b.batch_id
FROM public.bls AS b
WHERE b.id = cc.bl_id
  AND cc.manifest_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_charge_calculations_manifest_id
  ON public.charge_calculations (manifest_id, bl_id);

CREATE INDEX IF NOT EXISTS idx_charge_calculations_billing_run_id
  ON public.charge_calculations (billing_run_id, bl_id);

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS bl_id TEXT,
  ADD COLUMN IF NOT EXISTS manifest_id BIGINT REFERENCES public.import_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS charge_table_id BIGINT REFERENCES public.charge_tables(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS charge_item_id BIGINT REFERENCES public.charge_table_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS unit_value_usd NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS total_value_usd NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS pricing_rule_version_id BIGINT REFERENCES public.pricing_rule_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS billing_run_id BIGINT REFERENCES public.billing_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS calculation_key TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_payload JSONB NOT NULL DEFAULT '{}'::JSONB;

UPDATE public.invoice_items AS ii
SET
  bl_id = COALESCE(ii.bl_id, cc.bl_id),
  manifest_id = COALESCE(ii.manifest_id, cc.manifest_id),
  charge_table_id = COALESCE(ii.charge_table_id, cc.charge_table_id),
  charge_item_id = COALESCE(ii.charge_item_id, cc.charge_item_id),
  source = COALESCE(ii.source, cc.source),
  currency = COALESCE(
    ii.currency,
    CASE
      WHEN COALESCE(cc.total_value_usd, 0) > 0 OR COALESCE(cc.unit_value_usd, 0) > 0 THEN 'USD'
      ELSE 'BRL'
    END
  ),
  unit_value_usd = COALESCE(ii.unit_value_usd, cc.unit_value_usd),
  total_value_usd = COALESCE(ii.total_value_usd, cc.total_value_usd),
  pricing_rule_version_id = COALESCE(ii.pricing_rule_version_id, cc.pricing_rule_version_id),
  billing_run_id = COALESCE(ii.billing_run_id, cc.billing_run_id),
  calculation_key = COALESCE(ii.calculation_key, cc.calculation_key),
  snapshot_payload = COALESCE(ii.snapshot_payload, '{}'::JSONB) || jsonb_build_object(
    'charge_calculation_id', ii.charge_calculation_id,
    'bl_id', cc.bl_id,
    'manifest_id', cc.manifest_id,
    'charge_table_id', cc.charge_table_id,
    'charge_item_id', cc.charge_item_id,
    'source', cc.source,
    'currency', CASE
      WHEN COALESCE(cc.total_value_usd, 0) > 0 OR COALESCE(cc.unit_value_usd, 0) > 0 THEN 'USD'
      ELSE 'BRL'
    END,
    'calculation_key', cc.calculation_key
  )
FROM public.charge_calculations AS cc
WHERE cc.id = ii.charge_calculation_id;

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id_bl_id
  ON public.invoice_items (invoice_id, bl_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bls_last_billing_run_id_fkey'
  ) THEN
    ALTER TABLE public.bls
      ADD CONSTRAINT bls_last_billing_run_id_fkey
      FOREIGN KEY (last_billing_run_id)
      REFERENCES public.billing_runs(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalize_document_text(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(COALESCE(p_value, ''), '\D', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION public.ensure_pricing_rule_version(
  p_charge_table_id BIGINT,
  p_charge_item_id BIGINT,
  p_customer_id BIGINT,
  p_reference_date DATE,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_override_id BIGINT;
  v_version_key TEXT;
  v_id BIGINT;
BEGIN
  IF p_charge_item_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT cro.id
    INTO v_override_id
    FROM public.customer_rate_overrides AS cro
    WHERE cro.customer_id = p_customer_id
      AND cro.charge_item_id = p_charge_item_id
      AND (cro.valid_from IS NULL OR cro.valid_from <= p_reference_date)
      AND (cro.valid_to IS NULL OR cro.valid_to >= p_reference_date)
    ORDER BY cro.created_at DESC
    LIMIT 1;
  END IF;

  v_version_key := CONCAT_WS(
    '|',
    'table:' || COALESCE(p_charge_table_id::TEXT, 'none'),
    'item:' || p_charge_item_id::TEXT,
    'customer:' || COALESCE(p_customer_id::TEXT, 'none'),
    'override:' || COALESCE(v_override_id::TEXT, 'none'),
    'ref:' || COALESCE(p_reference_date::TEXT, 'none')
  );

  INSERT INTO public.pricing_rule_versions (
    version_key,
    charge_table_id,
    charge_item_id,
    customer_id,
    customer_rate_override_id,
    reference_date,
    metadata
  )
  VALUES (
    v_version_key,
    p_charge_table_id,
    p_charge_item_id,
    p_customer_id,
    v_override_id,
    p_reference_date,
    COALESCE(p_metadata, '{}'::JSONB)
  )
  ON CONFLICT (version_key) DO UPDATE
  SET metadata = public.pricing_rule_versions.metadata || EXCLUDED.metadata
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_pricing_rule_version(BIGINT, BIGINT, BIGINT, DATE, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_pricing_rule_version(BIGINT, BIGINT, BIGINT, DATE, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.populate_charge_calculation_billing_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_id BIGINT;
  v_manifest_id BIGINT;
  v_reference_date DATE;
BEGIN
  IF NEW.bl_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    b.customer_id,
    b.batch_id,
    COALESCE(ib.uploaded_at::DATE, b.created_at::DATE, CURRENT_DATE)
  INTO
    v_customer_id,
    v_manifest_id,
    v_reference_date
  FROM public.bls AS b
  LEFT JOIN public.import_batches AS ib ON ib.id = b.batch_id
  WHERE b.id = NEW.bl_id;

  IF NEW.manifest_id IS NULL THEN
    NEW.manifest_id := v_manifest_id;
  END IF;

  IF NEW.pricing_rule_version_id IS NULL AND NEW.charge_item_id IS NOT NULL THEN
    NEW.pricing_rule_version_id := public.ensure_pricing_rule_version(
      NEW.charge_table_id,
      NEW.charge_item_id,
      v_customer_id,
      v_reference_date,
      jsonb_build_object(
        'source', COALESCE(NEW.source, 'auto'),
        'calculation_key', NEW.calculation_key,
        'currency', CASE
          WHEN COALESCE(NEW.total_value_usd, 0) > 0 OR COALESCE(NEW.unit_value_usd, 0) > 0 THEN 'USD'
          ELSE 'BRL'
        END
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS populate_charge_calculation_billing_metadata ON public.charge_calculations;
CREATE TRIGGER populate_charge_calculation_billing_metadata
BEFORE INSERT OR UPDATE ON public.charge_calculations
FOR EACH ROW
EXECUTE FUNCTION public.populate_charge_calculation_billing_metadata();

CREATE OR REPLACE FUNCTION public.sync_customer_reconciliation_queue_for_bl(p_bl_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bl RECORD;
  v_detection_type TEXT;
  v_status TEXT;
BEGIN
  SELECT
    b.id,
    b.batch_id,
    b.customer_id,
    b.manifest_customer_cnpj_cpf,
    b.manifest_customer_name,
    b.manifest_customer_email,
    b.customer_reconciliation_status,
    b.customer_reconciliation_notes
  INTO v_bl
  FROM public.bls AS b
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_status := COALESCE(v_bl.customer_reconciliation_status, 'missing_customer');
  v_detection_type := CASE v_status
    WHEN 'matched_name' THEN 'name'
    WHEN 'matched_document' THEN 'document'
    WHEN 'reconciled' THEN 'manual'
    WHEN 'rejected' THEN 'manual'
    ELSE 'missing'
  END;

  INSERT INTO public.customer_reconciliation_queue (
    manifest_id,
    bl_id,
    customer_id,
    cnpj_cpf,
    manifest_customer_name,
    manifest_customer_email,
    detection_type,
    status,
    notes,
    resolution_notes,
    approved_at,
    rejected_at
  )
  VALUES (
    v_bl.batch_id,
    v_bl.id,
    v_bl.customer_id,
    v_bl.manifest_customer_cnpj_cpf,
    v_bl.manifest_customer_name,
    v_bl.manifest_customer_email,
    v_detection_type,
    CASE
      WHEN v_status IN ('matched_document', 'reconciled') THEN 'approved'
      WHEN v_status = 'rejected' THEN 'rejected'
      ELSE 'pending'
    END,
    v_bl.customer_reconciliation_notes,
    CASE
      WHEN v_status IN ('matched_document', 'reconciled') THEN COALESCE(v_bl.customer_reconciliation_notes, 'Cliente reconciliado.')
      WHEN v_status = 'rejected' THEN COALESCE(v_bl.customer_reconciliation_notes, 'Reconciliacao rejeitada.')
      ELSE NULL
    END,
    CASE WHEN v_status IN ('matched_document', 'reconciled') THEN now() ELSE NULL END,
    CASE WHEN v_status = 'rejected' THEN now() ELSE NULL END
  )
  ON CONFLICT (bl_id) DO UPDATE
  SET
    manifest_id = EXCLUDED.manifest_id,
    customer_id = EXCLUDED.customer_id,
    cnpj_cpf = EXCLUDED.cnpj_cpf,
    manifest_customer_name = EXCLUDED.manifest_customer_name,
    manifest_customer_email = EXCLUDED.manifest_customer_email,
    detection_type = EXCLUDED.detection_type,
    status = EXCLUDED.status,
    notes = EXCLUDED.notes,
    resolution_notes = CASE
      WHEN EXCLUDED.status = 'pending' THEN NULL
      ELSE EXCLUDED.resolution_notes
    END,
    approved_at = CASE
      WHEN EXCLUDED.status = 'approved' THEN COALESCE(public.customer_reconciliation_queue.approved_at, now())
      ELSE NULL
    END,
    rejected_at = CASE
      WHEN EXCLUDED.status = 'rejected' THEN COALESCE(public.customer_reconciliation_queue.rejected_at, now())
      ELSE NULL
    END,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.sync_customer_reconciliation_queue_for_bl(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_customer_reconciliation_queue_for_bl(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.insert_billing_run_log(
  p_billing_run_id BIGINT,
  p_manifest_id BIGINT,
  p_bl_id TEXT,
  p_level TEXT,
  p_code TEXT,
  p_message TEXT,
  p_details JSONB DEFAULT '{}'::JSONB
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.billing_run_logs (
    billing_run_id,
    manifest_id,
    bl_id,
    level,
    code,
    message,
    details
  )
  VALUES (
    p_billing_run_id,
    p_manifest_id,
    p_bl_id,
    COALESCE(p_level, 'info'),
    p_code,
    p_message,
    COALESCE(p_details, '{}'::JSONB)
  );
$$;

REVOKE ALL ON FUNCTION public.insert_billing_run_log(BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_billing_run_log(BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- Updated import and review RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.import_manifest_transactional(
  p_filename TEXT,
  p_voyage_id BIGINT,
  p_uploaded_by UUID,
  p_cargo_mode TEXT,
  p_file_hash TEXT,
  p_total_bls INT,
  p_total_containers INT,
  p_bls JSONB,
  p_containers JSONB,
  p_errors JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch_id BIGINT;
  v_bl_ids TEXT[];
  v_error_count INT;
  v_missing_container_refs INT;
  v_ambiguous_container_refs INT;
  v_recent_imports INT;
BEGIN
  SELECT COUNT(*) INTO v_recent_imports
  FROM public.import_batches
  WHERE uploaded_by = p_uploaded_by
    AND created_at > NOW() - INTERVAL '60 seconds';

  IF COALESCE(v_recent_imports, 0) >= 5 THEN
    RAISE EXCEPTION 'Limite de importacoes atingido. Aguarde 60 segundos antes de importar novamente.'
      USING ERRCODE = 'P0429';
  END IF;

  IF p_voyage_id IS NULL THEN
    RAISE EXCEPTION 'voyage_id obrigatorio' USING ERRCODE = '22004';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem % nao encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;

  v_error_count := COALESCE(jsonb_array_length(p_errors), 0);

  INSERT INTO public.import_batches(
    filename, voyage_id, cargo_mode, uploaded_by, status,
    total_bls, total_containers, error_count, file_hash
  )
  VALUES (
    p_filename,
    p_voyage_id,
    COALESCE(p_cargo_mode, 'container'),
    p_uploaded_by,
    'processing',
    p_total_bls,
    p_total_containers,
    v_error_count,
    p_file_hash
  )
  RETURNING id INTO v_batch_id;

  CREATE TEMP TABLE pg_temp.tmp_old_containers (
    old_container_id BIGINT PRIMARY KEY,
    bl_id TEXT NOT NULL,
    container_number TEXT NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE pg_temp.tmp_new_containers (
    new_container_id BIGINT PRIMARY KEY,
    bl_id TEXT NOT NULL,
    container_number TEXT NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE pg_temp.tmp_container_rebind (
    old_container_id BIGINT PRIMARY KEY,
    new_container_id BIGINT NOT NULL
  ) ON COMMIT DROP;

  IF p_bls IS NOT NULL AND jsonb_array_length(p_bls) > 0 THEN
    INSERT INTO public.bls (
      id,
      voyage_id,
      batch_id,
      cargo_mode,
      shipper,
      consignee,
      cargo_description,
      customer_id,
      pol,
      pod,
      total_weight_kg,
      total_cbm,
      review_status,
      financial_status,
      notes,
      manifest_customer_cnpj_cpf,
      manifest_customer_name,
      manifest_customer_email,
      customer_reconciliation_status,
      customer_reconciliation_notes,
      billing_hold_reason
    )
    SELECT
      bl->>'id',
      p_voyage_id,
      v_batch_id,
      COALESCE(p_cargo_mode, 'container'),
      bl->>'shipper',
      bl->>'consignee',
      bl->>'cargo_description',
      NULLIF(bl->>'customer_id', '')::BIGINT,
      bl->>'pol',
      bl->>'pod',
      NULLIF(bl->>'total_weight_kg', '')::NUMERIC,
      NULLIF(bl->>'total_cbm', '')::NUMERIC,
      COALESCE(bl->>'review_status', 'ok'),
      COALESCE(bl->>'financial_status', 'pending'),
      bl->>'notes',
      public.normalize_document_text(bl->>'manifest_customer_cnpj_cpf'),
      COALESCE(NULLIF(bl->>'manifest_customer_name', ''), bl->>'consignee'),
      NULLIF(bl->>'manifest_customer_email', ''),
      COALESCE(
        NULLIF(bl->>'customer_reconciliation_status', ''),
        CASE
          WHEN NULLIF(bl->>'customer_id', '') IS NOT NULL THEN 'reconciled'
          ELSE 'missing_customer'
        END
      ),
      NULLIF(bl->>'customer_reconciliation_notes', ''),
      NULLIF(bl->>'billing_hold_reason', '')
    FROM jsonb_array_elements(p_bls) AS bl
    ON CONFLICT (id) DO UPDATE SET
      voyage_id = EXCLUDED.voyage_id,
      batch_id = EXCLUDED.batch_id,
      cargo_mode = EXCLUDED.cargo_mode,
      shipper = EXCLUDED.shipper,
      consignee = EXCLUDED.consignee,
      cargo_description = EXCLUDED.cargo_description,
      customer_id = EXCLUDED.customer_id,
      pol = EXCLUDED.pol,
      pod = EXCLUDED.pod,
      total_weight_kg = EXCLUDED.total_weight_kg,
      total_cbm = EXCLUDED.total_cbm,
      review_status = EXCLUDED.review_status,
      financial_status = EXCLUDED.financial_status,
      notes = EXCLUDED.notes,
      manifest_customer_cnpj_cpf = EXCLUDED.manifest_customer_cnpj_cpf,
      manifest_customer_name = EXCLUDED.manifest_customer_name,
      manifest_customer_email = EXCLUDED.manifest_customer_email,
      customer_reconciliation_status = EXCLUDED.customer_reconciliation_status,
      customer_reconciliation_notes = EXCLUDED.customer_reconciliation_notes,
      billing_hold_reason = EXCLUDED.billing_hold_reason;

    SELECT array_agg(DISTINCT bl->>'id')
    INTO v_bl_ids
    FROM jsonb_array_elements(p_bls) AS bl;

    IF v_bl_ids IS NOT NULL AND array_length(v_bl_ids, 1) > 0 THEN
      INSERT INTO pg_temp.tmp_old_containers (old_container_id, bl_id, container_number)
      SELECT id, bl_id, container_number
      FROM public.bl_containers
      WHERE bl_id = ANY(v_bl_ids);

      PERFORM 1
      FROM public.vehicles
      WHERE container_id IN (SELECT old_container_id FROM pg_temp.tmp_old_containers)
      FOR UPDATE;

      PERFORM 1
      FROM public.charge_calculations
      WHERE container_id IN (SELECT old_container_id FROM pg_temp.tmp_old_containers)
      FOR UPDATE;
    END IF;
  END IF;

  IF p_containers IS NOT NULL AND jsonb_array_length(p_containers) > 0 THEN
    WITH inserted AS (
      INSERT INTO public.bl_containers (
        bl_id, container_number, seal_number, type, tare_weight_kg,
        gross_weight_kg, cbm, is_oog, is_imo, imo_class, un_number
      )
      SELECT
        c->>'bl_id',
        c->>'container_number',
        c->>'seal_number',
        c->>'type',
        NULLIF(c->>'tare_weight_kg', '')::NUMERIC,
        NULLIF(c->>'gross_weight_kg', '')::NUMERIC,
        NULLIF(c->>'cbm', '')::NUMERIC,
        COALESCE((c->>'is_oog')::BOOLEAN, false),
        COALESCE((c->>'is_imo')::BOOLEAN, false),
        c->>'imo_class',
        c->>'un_number'
      FROM jsonb_array_elements(p_containers) AS c
      RETURNING id, bl_id, container_number
    )
    INSERT INTO pg_temp.tmp_new_containers (new_container_id, bl_id, container_number)
    SELECT id, bl_id, container_number
    FROM inserted;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_temp.tmp_old_containers) THEN
    INSERT INTO pg_temp.tmp_container_rebind (old_container_id, new_container_id)
    SELECT old_ref.old_container_id, MIN(matched.new_container_id) AS new_container_id
    FROM pg_temp.tmp_old_containers AS old_ref
    JOIN LATERAL (
      SELECT new_ref.new_container_id
      FROM pg_temp.tmp_new_containers AS new_ref
      WHERE new_ref.bl_id = old_ref.bl_id
        AND new_ref.container_number = old_ref.container_number
    ) AS matched ON TRUE
    GROUP BY old_ref.old_container_id
    HAVING COUNT(*) = 1;

    SELECT COUNT(*)
    INTO v_missing_container_refs
    FROM (
      SELECT old_ref.old_container_id
      FROM pg_temp.tmp_old_containers AS old_ref
      WHERE EXISTS (
        SELECT 1
        FROM public.vehicles AS v
        WHERE v.container_id = old_ref.old_container_id
      )
         OR EXISTS (
        SELECT 1
        FROM public.charge_calculations AS cc
        WHERE cc.container_id = old_ref.old_container_id
      )
      EXCEPT
      SELECT old_container_id
      FROM pg_temp.tmp_container_rebind
    ) AS missing_refs;

    IF COALESCE(v_missing_container_refs, 0) > 0 THEN
      RAISE EXCEPTION
        'Reimport abortado: % vinculo(s) de container referenciados por veiculos/calculos nao puderam ser remapeados.',
        v_missing_container_refs
        USING ERRCODE = '23503';
    END IF;

    SELECT COUNT(*)
    INTO v_ambiguous_container_refs
    FROM (
      SELECT old_ref.old_container_id
      FROM pg_temp.tmp_old_containers AS old_ref
      JOIN pg_temp.tmp_new_containers AS new_ref
        ON new_ref.bl_id = old_ref.bl_id
       AND new_ref.container_number = old_ref.container_number
      WHERE EXISTS (
        SELECT 1
        FROM public.vehicles AS v
        WHERE v.container_id = old_ref.old_container_id
      )
         OR EXISTS (
        SELECT 1
        FROM public.charge_calculations AS cc
        WHERE cc.container_id = old_ref.old_container_id
      )
      GROUP BY old_ref.old_container_id
      HAVING COUNT(*) > 1
    ) AS ambiguous_refs;

    IF COALESCE(v_ambiguous_container_refs, 0) > 0 THEN
      RAISE EXCEPTION
        'Reimport abortado: % container(s) remapeados de forma ambigua por numero dentro do mesmo B/L.',
        v_ambiguous_container_refs
        USING ERRCODE = '23505';
    END IF;

    UPDATE public.vehicles AS v
    SET container_id = rebind.new_container_id
    FROM pg_temp.tmp_container_rebind AS rebind
    WHERE v.container_id = rebind.old_container_id;

    UPDATE public.charge_calculations AS cc
    SET container_id = rebind.new_container_id
    FROM pg_temp.tmp_container_rebind AS rebind
    WHERE cc.container_id = rebind.old_container_id;

    DELETE FROM public.bl_containers
    WHERE id IN (SELECT old_container_id FROM pg_temp.tmp_old_containers);
  END IF;

  IF v_error_count > 0 THEN
    INSERT INTO public.import_errors(batch_id, row_number, error_type, error_message, raw_data)
    SELECT
      v_batch_id,
      NULLIF(e->>'row_number', '')::INT,
      COALESCE(e->>'error_type', 'parser'),
      e->>'error_message',
      CASE WHEN e ? 'raw_data' THEN e->'raw_data' ELSE NULL END
    FROM jsonb_array_elements(p_errors) AS e;
  END IF;

  UPDATE public.import_batches
  SET status = CASE WHEN v_error_count > 0 THEN 'partial' ELSE 'completed' END
  WHERE id = v_batch_id;

  IF v_bl_ids IS NOT NULL THEN
    UPDATE public.charge_calculations AS cc
    SET manifest_id = v_batch_id
    WHERE cc.bl_id = ANY(v_bl_ids);
  END IF;

  RETURN v_batch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.import_manifest_transactional(
  TEXT, BIGINT, UUID, TEXT, TEXT, INT, INT, JSONB, JSONB, JSONB
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_manifest_transactional(
  TEXT, BIGINT, UUID, TEXT, TEXT, INT, INT, JSONB, JSONB, JSONB
) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_bl_review(
  p_bl_id TEXT,
  p_expected_updated_at TIMESTAMPTZ,
  p_update_payload JSONB,
  p_audit_rows JSONB,
  p_changed_by UUID
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_updated_at TIMESTAMPTZ;
  v_rowcount INT;
  v_next_customer_id BIGINT;
BEGIN
  IF p_bl_id IS NULL OR p_bl_id = '' THEN
    RAISE EXCEPTION 'bl_id obrigatorio' USING ERRCODE = '22004';
  END IF;

  v_next_customer_id := CASE
    WHEN p_update_payload ? 'customer_id' THEN NULLIF(p_update_payload->>'customer_id', '')::BIGINT
    ELSE NULL
  END;

  UPDATE public.bls AS b
  SET
    shipper = CASE WHEN p_update_payload ? 'shipper' THEN p_update_payload->>'shipper' ELSE b.shipper END,
    consignee = CASE WHEN p_update_payload ? 'consignee' THEN p_update_payload->>'consignee' ELSE b.consignee END,
    notify_party = CASE WHEN p_update_payload ? 'notify_party' THEN p_update_payload->>'notify_party' ELSE b.notify_party END,
    ce_mercante = CASE WHEN p_update_payload ? 'ce_mercante' THEN p_update_payload->>'ce_mercante' ELSE b.ce_mercante END,
    pol = CASE WHEN p_update_payload ? 'pol' THEN p_update_payload->>'pol' ELSE b.pol END,
    pod = CASE WHEN p_update_payload ? 'pod' THEN p_update_payload->>'pod' ELSE b.pod END,
    place_of_delivery = CASE WHEN p_update_payload ? 'place_of_delivery' THEN p_update_payload->>'place_of_delivery' ELSE b.place_of_delivery END,
    cargo_description = CASE WHEN p_update_payload ? 'cargo_description' THEN p_update_payload->>'cargo_description' ELSE b.cargo_description END,
    total_weight_kg = CASE WHEN p_update_payload ? 'total_weight_kg' THEN NULLIF(p_update_payload->>'total_weight_kg','')::NUMERIC ELSE b.total_weight_kg END,
    total_cbm = CASE WHEN p_update_payload ? 'total_cbm' THEN NULLIF(p_update_payload->>'total_cbm','')::NUMERIC ELSE b.total_cbm END,
    bb_machine_qty = CASE WHEN p_update_payload ? 'bb_machine_qty' THEN NULLIF(p_update_payload->>'bb_machine_qty','')::NUMERIC ELSE b.bb_machine_qty END,
    bb_packages_qty = CASE WHEN p_update_payload ? 'bb_packages_qty' THEN NULLIF(p_update_payload->>'bb_packages_qty','')::NUMERIC ELSE b.bb_packages_qty END,
    bb_packages_total = CASE WHEN p_update_payload ? 'bb_packages_total' THEN NULLIF(p_update_payload->>'bb_packages_total','')::NUMERIC ELSE b.bb_packages_total END,
    bb_weight_ton = CASE WHEN p_update_payload ? 'bb_weight_ton' THEN NULLIF(p_update_payload->>'bb_weight_ton','')::NUMERIC ELSE b.bb_weight_ton END,
    incoterm = CASE WHEN p_update_payload ? 'incoterm' THEN p_update_payload->>'incoterm' ELSE b.incoterm END,
    payment_type = CASE WHEN p_update_payload ? 'payment_type' THEN NULLIF(p_update_payload->>'payment_type','') ELSE b.payment_type END,
    free_time_override = CASE WHEN p_update_payload ? 'free_time_override' THEN NULLIF(p_update_payload->>'free_time_override','')::INT ELSE b.free_time_override END,
    notes = CASE WHEN p_update_payload ? 'notes' THEN p_update_payload->>'notes' ELSE b.notes END,
    review_status = CASE WHEN p_update_payload ? 'review_status' THEN p_update_payload->>'review_status' ELSE b.review_status END,
    customer_id = CASE WHEN p_update_payload ? 'customer_id' THEN NULLIF(p_update_payload->>'customer_id','')::BIGINT ELSE b.customer_id END,
    customer_reconciliation_status = CASE
      WHEN p_update_payload ? 'customer_reconciliation_status' THEN p_update_payload->>'customer_reconciliation_status'
      WHEN p_update_payload ? 'customer_id' THEN CASE WHEN v_next_customer_id IS NULL THEN 'missing_customer' ELSE 'reconciled' END
      ELSE b.customer_reconciliation_status
    END,
    customer_reconciliation_notes = CASE
      WHEN p_update_payload ? 'customer_reconciliation_notes' THEN NULLIF(p_update_payload->>'customer_reconciliation_notes', '')
      WHEN p_update_payload ? 'customer_id' THEN CASE
        WHEN v_next_customer_id IS NULL THEN 'Cliente removido manualmente do B/L.'
        ELSE 'Cliente reconciliado manualmente na revisao do B/L.'
      END
      ELSE b.customer_reconciliation_notes
    END,
    billing_hold_reason = CASE
      WHEN p_update_payload ? 'billing_hold_reason' THEN NULLIF(p_update_payload->>'billing_hold_reason', '')
      WHEN p_update_payload ? 'customer_id' THEN CASE
        WHEN v_next_customer_id IS NULL THEN COALESCE(b.billing_hold_reason, 'Cliente sem reconciliacao aprovada.')
        ELSE NULL
      END
      ELSE b.billing_hold_reason
    END
  WHERE b.id = p_bl_id
    AND (p_expected_updated_at IS NULL OR b.updated_at = p_expected_updated_at)
  RETURNING b.updated_at INTO v_new_updated_at;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;

  IF v_rowcount = 0 THEN
    IF NOT EXISTS (SELECT 1 FROM public.bls WHERE id = p_bl_id) THEN
      RAISE EXCEPTION 'BL % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
    ELSE
      RAISE EXCEPTION 'BL % foi alterado por outro usuario; recarregue antes de salvar', p_bl_id
        USING ERRCODE = '40001';
    END IF;
  END IF;

  IF p_audit_rows IS NOT NULL AND jsonb_array_length(p_audit_rows) > 0 THEN
    INSERT INTO public.audit_logs(
      entity_type, entity_id, field_name, old_value, new_value, changed_by, justification
    )
    SELECT
      COALESCE(a->>'entity_type', 'bl'),
      COALESCE(a->>'entity_id', p_bl_id),
      a->>'field_name',
      a->>'old_value',
      a->>'new_value',
      p_changed_by,
      a->>'justification'
    FROM jsonb_array_elements(p_audit_rows) AS a;
  END IF;

  PERFORM public.sync_customer_reconciliation_queue_for_bl(p_bl_id);

  RETURN v_new_updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.save_bl_review(TEXT, TIMESTAMPTZ, JSONB, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_bl_review(TEXT, TIMESTAMPTZ, JSONB, JSONB, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Billing orchestration and reconciliation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_bl_ready_for_billing(
  p_bl_id TEXT,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bl RECORD;
  v_pending_count INTEGER := 0;
  v_usd_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  SELECT
    id,
    charge_status,
    customer_id,
    customer_reconciliation_status
  INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.customer_id IS NULL THEN
    UPDATE public.bls
    SET billing_hold_reason = 'Cliente nao reconciliado para faturamento.'
    WHERE id = p_bl_id;
    RAISE EXCEPTION 'B/L sem cliente reconciliado para faturar.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_bl.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled') THEN
    UPDATE public.bls
    SET billing_hold_reason = 'Cliente exige reconciliacao manual antes do faturamento.'
    WHERE id = p_bl_id;
    RAISE EXCEPTION 'B/L exige reconciliacao manual antes do faturamento.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO v_pending_count
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id
    AND status = 'review_required';

  IF v_pending_count > 0 THEN
    UPDATE public.bls
    SET billing_hold_reason = 'Ainda existem linhas com pendencia de revisao.'
    WHERE id = p_bl_id;
    RAISE EXCEPTION 'Ainda existem linhas com pendencia de revisao' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO v_usd_count
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id
    AND COALESCE(total_value_usd, 0) > 0
    AND COALESCE(status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_usd_count > 0 THEN
    UPDATE public.bls
    SET billing_hold_reason = 'Linhas em USD exigem ajuste manual antes do faturamento.'
    WHERE id = p_bl_id;
    RAISE EXCEPTION 'Existem linhas em USD que bloqueiam o ready_for_billing.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.charge_calculations
  SET status = 'ready_for_billing'
  WHERE bl_id = p_bl_id
    AND status IN ('calculated', 'reviewed');

  UPDATE public.bls
  SET
    charge_status = 'ready_for_billing',
    billing_hold_reason = NULL
  WHERE id = p_bl_id;

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    changed_at,
    justification
  )
  VALUES (
    'bl',
    p_bl_id,
    'charge_status',
    COALESCE(v_bl.charge_status, 'null'),
    'ready_for_billing',
    auth.uid(),
    NOW(),
    'Marcado como pronto para faturar com gate de reconciliacao'
  );

  RETURN jsonb_build_object('bl_id', p_bl_id, 'status', 'ready_for_billing', 'changed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_bl_ready_for_billing(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_bl_ready_for_billing(TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.run_billing_for_import_batch(
  p_batch_id BIGINT,
  p_actor UUID DEFAULT NULL,
  p_recalculate BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch RECORD;
  v_run_id BIGINT;
  v_actor UUID;
  v_bl RECORD;
  v_result JSONB;
  v_hold_reason TEXT;
  v_total_bls INTEGER := 0;
  v_eligible_bls INTEGER := 0;
  v_blocked_bls INTEGER := 0;
  v_calculated_bls INTEGER := 0;
  v_total_brl NUMERIC(14,2) := 0;
  v_total_usd NUMERIC(14,2) := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT *
  INTO v_batch
  FROM public.import_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manifesto/lote % nao encontrado.', p_batch_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_batch.status, 'processing') NOT IN ('completed', 'partial') THEN
    RAISE EXCEPTION 'Manifesto % ainda nao esta pronto para faturamento automatico.', p_batch_id USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.billing_runs (
    manifest_id,
    trigger_source,
    status,
    requested_by,
    input_hash,
    total_bls,
    summary
  )
  VALUES (
    p_batch_id,
    CASE WHEN COALESCE(p_recalculate, true) THEN 'manifest_import' ELSE 'manual_reprocess' END,
    'running',
    v_actor,
    v_batch.file_hash,
    COALESCE(v_batch.total_bls, 0),
    jsonb_build_object('filename', v_batch.filename, 'cargo_mode', v_batch.cargo_mode)
  )
  RETURNING id INTO v_run_id;

  FOR v_bl IN
    SELECT
      b.id,
      b.customer_id,
      b.customer_reconciliation_status,
      b.manifest_customer_cnpj_cpf,
      b.manifest_customer_name,
      b.manifest_customer_email
    FROM public.bls AS b
    WHERE b.batch_id = p_batch_id
    ORDER BY b.id
  LOOP
    v_total_bls := v_total_bls + 1;

    UPDATE public.bls
    SET last_billing_run_id = v_run_id
    WHERE id = v_bl.id;

    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl.id);

    IF v_bl.customer_id IS NULL OR COALESCE(v_bl.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled') THEN
      v_blocked_bls := v_blocked_bls + 1;
      v_hold_reason := CASE COALESCE(v_bl.customer_reconciliation_status, 'missing_customer')
        WHEN 'matched_name' THEN 'Cliente vinculado apenas por nome; requer reconciliacao manual.'
        WHEN 'rejected' THEN 'Reconciliacao de cliente rejeitada; revisar cadastro.'
        ELSE 'Cliente inexistente ou nao reconciliado.'
      END;

      UPDATE public.bls
      SET
        billing_hold_reason = v_hold_reason,
        charge_status = CASE
          WHEN financial_status = 'pending' THEN 'not_calculated'
          ELSE charge_status
        END
      WHERE id = v_bl.id;

      PERFORM public.insert_billing_run_log(
        v_run_id,
        p_batch_id,
        v_bl.id,
        'warning',
        'customer_reconciliation_blocked',
        v_hold_reason,
        jsonb_build_object(
          'customer_id', v_bl.customer_id,
          'customer_reconciliation_status', v_bl.customer_reconciliation_status,
          'manifest_customer_cnpj_cpf', v_bl.manifest_customer_cnpj_cpf,
          'manifest_customer_name', v_bl.manifest_customer_name,
          'manifest_customer_email', v_bl.manifest_customer_email
        )
      );

      CONTINUE;
    END IF;

    v_eligible_bls := v_eligible_bls + 1;
    v_result := public.calculate_bl_local_charges(v_bl.id, v_actor, COALESCE(p_recalculate, true));

    UPDATE public.charge_calculations
    SET
      billing_run_id = v_run_id,
      manifest_id = COALESCE(manifest_id, p_batch_id)
    WHERE bl_id = v_bl.id
      AND COALESCE(source, 'auto') = 'auto';

    v_hold_reason := CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.charge_calculations
        WHERE bl_id = v_bl.id
          AND COALESCE(total_value_usd, 0) > 0
      ) THEN 'Linhas em USD exigem ajuste manual antes do faturamento.'
      WHEN COALESCE(v_result->>'status', '') = 'review_required' THEN 'Pendencia de revisao nas taxas locais.'
      ELSE NULL
    END;

    UPDATE public.bls
    SET billing_hold_reason = v_hold_reason
    WHERE id = v_bl.id;

    v_calculated_bls := v_calculated_bls + 1;

    PERFORM public.insert_billing_run_log(
      v_run_id,
      p_batch_id,
      v_bl.id,
      CASE WHEN v_hold_reason IS NULL THEN 'info' ELSE 'warning' END,
      'charges_calculated',
      COALESCE(v_result->>'reason', 'Calculo executado com sucesso.'),
      jsonb_build_object(
        'status', v_result->>'status',
        'line_count', COALESCE((v_result->>'line_count')::INT, 0),
        'total_brl', COALESCE((v_result->>'total_brl')::NUMERIC, 0),
        'total_usd', COALESCE((v_result->>'total_usd')::NUMERIC, 0),
        'billing_hold_reason', v_hold_reason
      )
    );
  END LOOP;

  SELECT
    COALESCE(SUM(total_value_brl), 0),
    COALESCE(SUM(total_value_usd), 0)
  INTO
    v_total_brl,
    v_total_usd
  FROM public.charge_calculations
  WHERE billing_run_id = v_run_id;

  UPDATE public.billing_runs
  SET
    completed_at = now(),
    status = CASE
      WHEN v_blocked_bls > 0 THEN 'completed_with_blocks'
      ELSE 'completed'
    END,
    total_bls = v_total_bls,
    eligible_bls = v_eligible_bls,
    blocked_bls = v_blocked_bls,
    calculated_bls = v_calculated_bls,
    total_brl = v_total_brl,
    total_usd = v_total_usd,
    summary = jsonb_build_object(
      'filename', v_batch.filename,
      'cargo_mode', v_batch.cargo_mode,
      'eligible_bls', v_eligible_bls,
      'blocked_bls', v_blocked_bls,
      'calculated_bls', v_calculated_bls
    )
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'billing_run_id', v_run_id,
    'manifest_id', p_batch_id,
    'status', CASE WHEN v_blocked_bls > 0 THEN 'completed_with_blocks' ELSE 'completed' END,
    'total_bls', v_total_bls,
    'eligible_bls', v_eligible_bls,
    'blocked_bls', v_blocked_bls,
    'calculated_bls', v_calculated_bls,
    'total_brl', v_total_brl,
    'total_usd', v_total_usd
  );
EXCEPTION
  WHEN OTHERS THEN
    IF v_run_id IS NOT NULL THEN
      UPDATE public.billing_runs
      SET
        completed_at = now(),
        status = 'failed',
        summary = COALESCE(summary, '{}'::JSONB) || jsonb_build_object(
          'error', SQLERRM,
          'failed_at', now()
        )
      WHERE id = v_run_id;

      PERFORM public.insert_billing_run_log(
        v_run_id,
        p_batch_id,
        NULL,
        'error',
        'billing_run_failed',
        SQLERRM,
        jsonb_build_object('sqlstate', SQLSTATE)
      );
    END IF;
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.run_billing_for_import_batch(BIGINT, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_billing_for_import_batch(BIGINT, UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_billing_runs(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  id BIGINT,
  manifest_id BIGINT,
  filename TEXT,
  trigger_source TEXT,
  status TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  total_bls INTEGER,
  eligible_bls INTEGER,
  blocked_bls INTEGER,
  calculated_bls INTEGER,
  total_brl NUMERIC,
  total_usd NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    br.id,
    br.manifest_id,
    ib.filename,
    br.trigger_source,
    br.status,
    br.started_at,
    br.completed_at,
    br.total_bls,
    br.eligible_bls,
    br.blocked_bls,
    br.calculated_bls,
    br.total_brl,
    br.total_usd
  FROM public.billing_runs AS br
  JOIN public.import_batches AS ib ON ib.id = br.manifest_id
  ORDER BY br.started_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 50), 1);
$$;

REVOKE ALL ON FUNCTION public.list_billing_runs(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_billing_runs(INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_billing_run_details(p_billing_run_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run JSONB;
  v_logs JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(br.*) || jsonb_build_object('filename', ib.filename)
  INTO v_run
  FROM public.billing_runs AS br
  JOIN public.import_batches AS ib ON ib.id = br.manifest_id
  WHERE br.id = p_billing_run_id;

  IF v_run IS NULL THEN
    RAISE EXCEPTION 'Billing run % nao encontrado.', p_billing_run_id USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(log_row) ORDER BY log_row.created_at DESC), '[]'::JSONB)
  INTO v_logs
  FROM (
    SELECT *
    FROM public.billing_run_logs
    WHERE billing_run_id = p_billing_run_id
    ORDER BY created_at DESC
    LIMIT 300
  ) AS log_row;

  RETURN jsonb_build_object('run', v_run, 'logs', v_logs);
END;
$$;

REVOKE ALL ON FUNCTION public.get_billing_run_details(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_billing_run_details(BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_customer_reconciliation_queue(
  p_status TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 200
)
RETURNS TABLE (
  id BIGINT,
  manifest_id BIGINT,
  bl_id TEXT,
  customer_id BIGINT,
  current_customer_name TEXT,
  cnpj_cpf TEXT,
  manifest_customer_name TEXT,
  manifest_customer_email TEXT,
  detection_type TEXT,
  status TEXT,
  notes TEXT,
  resolution_notes TEXT,
  charge_status TEXT,
  financial_status TEXT,
  billing_hold_reason TEXT,
  created_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    q.id,
    q.manifest_id,
    q.bl_id,
    q.customer_id,
    c.name AS current_customer_name,
    q.cnpj_cpf,
    q.manifest_customer_name,
    q.manifest_customer_email,
    q.detection_type,
    q.status,
    q.notes,
    q.resolution_notes,
    b.charge_status,
    b.financial_status,
    b.billing_hold_reason,
    q.created_at,
    q.approved_at,
    q.rejected_at
  FROM public.customer_reconciliation_queue AS q
  LEFT JOIN public.customers AS c ON c.id = q.customer_id
  JOIN public.bls AS b ON b.id = q.bl_id
  WHERE p_status IS NULL OR q.status = p_status
  ORDER BY q.created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 200), 1);
$$;

REVOKE ALL ON FUNCTION public.list_customer_reconciliation_queue(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_customer_reconciliation_queue(TEXT, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_customer_reconciliation(
  p_queue_id BIGINT,
  p_customer_id BIGINT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_queue RECORD;
  v_actor UUID;
  v_target_customer_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT *
  INTO v_queue
  FROM public.customer_reconciliation_queue
  WHERE id = p_queue_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de reconciliacao % nao encontrado.', p_queue_id USING ERRCODE = 'P0002';
  END IF;

  v_target_customer_id := COALESCE(p_customer_id, v_queue.customer_id);
  IF v_target_customer_id IS NULL THEN
    RAISE EXCEPTION 'Informe um cliente para aprovar a reconciliacao.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bls
  SET
    customer_id = v_target_customer_id,
    customer_reconciliation_status = 'reconciled',
    customer_reconciliation_notes = COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.'),
    billing_hold_reason = NULL
  WHERE id = v_queue.bl_id;

  UPDATE public.customer_reconciliation_queue
  SET
    customer_id = v_target_customer_id,
    status = 'approved',
    resolution_notes = COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.'),
    approved_by = v_actor,
    approved_at = now(),
    rejected_by = NULL,
    rejected_at = NULL
  WHERE id = p_queue_id;

  PERFORM public.sync_customer_reconciliation_queue_for_bl(v_queue.bl_id);

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    changed_at,
    justification
  )
  VALUES (
    'bl',
    v_queue.bl_id,
    'customer_reconciliation_status',
    COALESCE(v_queue.status, 'pending'),
    'reconciled',
    v_actor,
    now(),
    COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.')
  );

  RETURN jsonb_build_object(
    'queue_id', p_queue_id,
    'bl_id', v_queue.bl_id,
    'customer_id', v_target_customer_id,
    'status', 'approved'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_customer_reconciliation(BIGINT, BIGINT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_customer_reconciliation(BIGINT, BIGINT, TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_customer_reconciliation(
  p_queue_id BIGINT,
  p_notes TEXT DEFAULT NULL,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_queue RECORD;
  v_actor UUID;
  v_reason TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());
  v_reason := COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Reconciliacao rejeitada; revisar cliente/manualmente.');

  SELECT *
  INTO v_queue
  FROM public.customer_reconciliation_queue
  WHERE id = p_queue_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de reconciliacao % nao encontrado.', p_queue_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.bls
  SET
    customer_reconciliation_status = 'rejected',
    customer_reconciliation_notes = v_reason,
    billing_hold_reason = v_reason,
    charge_status = CASE
      WHEN financial_status = 'pending' THEN 'not_calculated'
      ELSE charge_status
    END
  WHERE id = v_queue.bl_id;

  UPDATE public.customer_reconciliation_queue
  SET
    status = 'rejected',
    resolution_notes = v_reason,
    rejected_by = v_actor,
    rejected_at = now(),
    approved_by = NULL,
    approved_at = NULL
  WHERE id = p_queue_id;

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    changed_at,
    justification
  )
  VALUES (
    'bl',
    v_queue.bl_id,
    'customer_reconciliation_status',
    COALESCE(v_queue.status, 'pending'),
    'rejected',
    v_actor,
    now(),
    v_reason
  );

  RETURN jsonb_build_object(
    'queue_id', p_queue_id,
    'bl_id', v_queue.bl_id,
    'status', 'rejected'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reject_customer_reconciliation(BIGINT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_customer_reconciliation(BIGINT, TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Portal access and shared invoice core
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_customer_portal_account(p_customer_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payload JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao administrativa.' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(a.*) - 'password_hash'
  INTO v_payload
  FROM public.customer_portal_accounts AS a
  WHERE a.customer_id = p_customer_id;

  RETURN COALESCE(v_payload, '{}'::JSONB);
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_portal_account(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_portal_account(BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_customer_portal_account(
  p_customer_id BIGINT,
  p_password TEXT,
  p_contact_email TEXT DEFAULT NULL,
  p_active BOOLEAN DEFAULT true,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_account_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao administrativa.' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(length(trim(COALESCE(p_password, ''))), 0) < 8 THEN
    RAISE EXCEPTION 'Senha do portal deve ter no minimo 8 caracteres.' USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  INSERT INTO public.customer_portal_accounts (
    customer_id,
    contact_email,
    password_hash,
    active,
    created_by
  )
  VALUES (
    p_customer_id,
    NULLIF(trim(COALESCE(p_contact_email, '')), ''),
    crypt(p_password, gen_salt('bf')),
    COALESCE(p_active, true),
    v_actor
  )
  ON CONFLICT (customer_id) DO UPDATE
  SET
    contact_email = EXCLUDED.contact_email,
    password_hash = EXCLUDED.password_hash,
    active = EXCLUDED.active,
    updated_at = now()
  RETURNING id INTO v_account_id;

  RETURN public.get_customer_portal_account(p_customer_id);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_customer_portal_account(BIGINT, TEXT, TEXT, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_customer_portal_account(BIGINT, TEXT, TEXT, BOOLEAN, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_customer_portal_account_active(
  p_customer_id BIGINT,
  p_active BOOLEAN,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao administrativa.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.customer_portal_accounts
  SET
    active = COALESCE(p_active, true),
    updated_at = now()
  WHERE customer_id = p_customer_id;

  RETURN public.get_customer_portal_account(p_customer_id);
END;
$$;

REVOKE ALL ON FUNCTION public.set_customer_portal_account_active(BIGINT, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_customer_portal_account_active(BIGINT, BOOLEAN, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_customer_portal_session(p_session_token TEXT)
RETURNS TABLE (
  session_id BIGINT,
  account_id BIGINT,
  customer_id BIGINT,
  contact_email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token_hash TEXT;
BEGIN
  v_token_hash := encode(digest(COALESCE(p_session_token, ''), 'sha256'), 'hex');

  RETURN QUERY
  WITH session_row AS (
    SELECT
      s.id AS session_id,
      s.account_id,
      s.customer_id,
      a.contact_email
    FROM public.customer_portal_sessions AS s
    JOIN public.customer_portal_accounts AS a ON a.id = s.account_id
    WHERE s.token_hash = v_token_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND a.active = true
    LIMIT 1
  )
  UPDATE public.customer_portal_sessions AS s
  SET last_seen_at = now()
  FROM session_row
  WHERE s.id = session_row.session_id
  RETURNING s.id, s.account_id, s.customer_id, session_row.contact_email;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_customer_portal_session(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_customer_portal_session(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_login(
  p_cnpj_cpf TEXT,
  p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account RECORD;
  v_token TEXT;
  v_token_hash TEXT;
BEGIN
  SELECT
    a.id,
    a.customer_id,
    a.password_hash,
    a.contact_email,
    c.name,
    c.cnpj_cpf
  INTO v_account
  FROM public.customer_portal_accounts AS a
  JOIN public.customers AS c ON c.id = a.customer_id
  WHERE public.normalize_document_text(c.cnpj_cpf) = public.normalize_document_text(p_cnpj_cpf)
    AND a.active = true;

  IF NOT FOUND OR v_account.password_hash <> crypt(COALESCE(p_password, ''), v_account.password_hash) THEN
    RAISE EXCEPTION 'Credenciais invalidas para o portal.' USING ERRCODE = '28000';
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

  INSERT INTO public.customer_portal_sessions (
    account_id,
    customer_id,
    token_hash,
    expires_at,
    last_seen_at
  )
  VALUES (
    v_account.id,
    v_account.customer_id,
    v_token_hash,
    now() + INTERVAL '12 hours',
    now()
  );

  UPDATE public.customer_portal_accounts
  SET last_login_at = now()
  WHERE id = v_account.id;

  RETURN jsonb_build_object(
    'token', v_token,
    'customer_id', v_account.customer_id,
    'customer_name', v_account.name,
    'customer_cnpj_cpf', v_account.cnpj_cpf,
    'contact_email', v_account.contact_email,
    'expires_at', now() + INTERVAL '12 hours'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.portal_login(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_login(TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_logout(p_session_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session RECORD;
BEGIN
  SELECT *
  INTO v_session
  FROM public.resolve_customer_portal_session(p_session_token)
  LIMIT 1;

  UPDATE public.customer_portal_sessions
  SET revoked_at = now()
  WHERE id = v_session.session_id;

  RETURN jsonb_build_object('revoked', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('revoked', false);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_logout(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_logout(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_get_session_overview(p_session_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session RECORD;
  v_customer RECORD;
BEGIN
  SELECT *
  INTO v_session
  FROM public.resolve_customer_portal_session(p_session_token)
  LIMIT 1;

  SELECT id, name, cnpj_cpf, pending_balance
  INTO v_customer
  FROM public.customers
  WHERE id = v_session.customer_id;

  RETURN jsonb_build_object(
    'customer_id', v_customer.id,
    'customer_name', v_customer.name,
    'customer_cnpj_cpf', v_customer.cnpj_cpf,
    'pending_balance', v_customer.pending_balance,
    'contact_email', v_session.contact_email
  );
END;
$$;

REVOKE ALL ON FUNCTION public.portal_get_session_overview(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_get_session_overview(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_invoice_from_bls_core(
  p_bl_ids TEXT[],
  p_customer_id BIGINT,
  p_due_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_issue_now BOOLEAN DEFAULT true,
  p_actor UUID DEFAULT NULL,
  p_origin TEXT DEFAULT 'internal',
  p_portal_account_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requested_bls TEXT[];
  v_bl_count INTEGER;
  v_missing_bls TEXT;
  v_customer_id BIGINT;
  v_max_customer_id BIGINT;
  v_conflict_count INTEGER;
  v_usd_count INTEGER;
  v_invoice_id BIGINT;
  v_invoice_number TEXT;
  v_total_brl NUMERIC(14,2);
  v_item_count INTEGER;
  v_status TEXT;
  v_batch_id BIGINT;
BEGIN
  v_status := CASE WHEN COALESCE(p_issue_now, true) THEN 'issued' ELSE 'draft' END;

  SELECT ARRAY_AGG(DISTINCT UPPER(TRIM(bl_id)) ORDER BY UPPER(TRIM(bl_id)))
  INTO v_requested_bls
  FROM UNNEST(COALESCE(p_bl_ids, ARRAY[]::TEXT[])) AS input(bl_id)
  WHERE TRIM(COALESCE(bl_id, '')) <> '';

  IF COALESCE(ARRAY_LENGTH(v_requested_bls, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado para emissao.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.bls
  WHERE id = ANY(v_requested_bls)
  FOR UPDATE;

  SELECT COUNT(*) INTO v_bl_count
  FROM public.bls
  WHERE id = ANY(v_requested_bls);

  IF v_bl_count <> ARRAY_LENGTH(v_requested_bls, 1) THEN
    SELECT STRING_AGG(req.bl_id, ', ' ORDER BY req.bl_id)
    INTO v_missing_bls
    FROM UNNEST(v_requested_bls) AS req(bl_id)
    LEFT JOIN public.bls AS b ON b.id = req.bl_id
    WHERE b.id IS NULL;

    RAISE EXCEPTION 'B/L(s) nao encontrado(s): %', COALESCE(v_missing_bls, '-')
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = ANY(v_requested_bls)
      AND COALESCE(b.charge_status, 'not_calculated') <> 'ready_for_billing'
  ) THEN
    RAISE EXCEPTION 'Todos os B/Ls devem estar como ready_for_billing.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = ANY(v_requested_bls)
      AND COALESCE(b.financial_status, 'pending') <> 'pending'
  ) THEN
    RAISE EXCEPTION 'Existe B/L ja faturado/pago/cancelado na selecao.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = ANY(v_requested_bls)
      AND (b.customer_id IS NULL OR COALESCE(b.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled'))
  ) THEN
    RAISE EXCEPTION 'Todos os B/Ls precisam de cliente reconciliado para faturar.' USING ERRCODE = '22023';
  END IF;

  SELECT MIN(b.customer_id), MAX(b.customer_id)
  INTO v_customer_id, v_max_customer_id
  FROM public.bls AS b
  WHERE b.id = ANY(v_requested_bls);

  IF v_customer_id IS NULL OR v_customer_id <> v_max_customer_id THEN
    RAISE EXCEPTION 'Selecao contem B/Ls de clientes diferentes.' USING ERRCODE = '22023';
  END IF;

  IF p_customer_id IS NOT NULL AND p_customer_id <> v_customer_id THEN
    RAISE EXCEPTION 'Cliente informado nao corresponde aos B/Ls selecionados.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO v_conflict_count
  FROM public.invoice_bls AS ib
  JOIN public.invoices AS inv ON inv.id = ib.invoice_id
  WHERE ib.bl_id = ANY(v_requested_bls)
    AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue');

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Existe B/L vinculado a invoice ativa.' USING ERRCODE = '23505';
  END IF;

  SELECT COUNT(*)
  INTO v_usd_count
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = ANY(v_requested_bls)
    AND COALESCE(cc.total_value_usd, 0) > 0
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_usd_count > 0 THEN
    RAISE EXCEPTION 'Existem linhas em USD. Ajuste manualmente antes de faturar.' USING ERRCODE = '22023';
  END IF;

  IF ARRAY_LENGTH(v_requested_bls, 1) > 1 THEN
    INSERT INTO public.billing_batches (
      customer_id,
      origin,
      status,
      notes,
      requested_by,
      portal_account_id
    )
    VALUES (
      v_customer_id,
      COALESCE(p_origin, 'internal'),
      'requested',
      NULLIF(TRIM(COALESCE(p_notes, '')), ''),
      p_actor,
      p_portal_account_id
    )
    RETURNING id INTO v_batch_id;
  END IF;

  INSERT INTO public.invoices (
    customer_id,
    bl_id,
    issued_at,
    due_date,
    total_brl,
    status,
    notes,
    total_paid_brl,
    balance_brl,
    issued_by
  )
  VALUES (
    v_customer_id,
    CASE WHEN ARRAY_LENGTH(v_requested_bls, 1) = 1 THEN v_requested_bls[1] ELSE NULL END,
    CASE WHEN v_status = 'issued' THEN now() ELSE NULL END,
    p_due_date,
    0,
    v_status,
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    0,
    0,
    p_actor
  )
  RETURNING id, invoice_number
  INTO v_invoice_id, v_invoice_number;

  INSERT INTO public.invoice_bls (
    invoice_id,
    bl_id,
    charge_status_snapshot,
    financial_status_snapshot,
    subtotal_brl,
    subtotal_usd
  )
  SELECT
    v_invoice_id,
    b.id,
    b.charge_status,
    b.financial_status,
    COALESCE(calc.total_brl, 0),
    COALESCE(calc.total_usd, 0)
  FROM public.bls AS b
  LEFT JOIN (
    SELECT
      cc.bl_id,
      SUM(COALESCE(cc.total_value_brl, 0)) AS total_brl,
      SUM(COALESCE(cc.total_value_usd, 0)) AS total_usd
    FROM public.charge_calculations AS cc
    WHERE cc.bl_id = ANY(v_requested_bls)
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt')
    GROUP BY cc.bl_id
  ) AS calc ON calc.bl_id = b.id
  WHERE b.id = ANY(v_requested_bls);

  INSERT INTO public.invoice_items (
    invoice_id,
    charge_calculation_id,
    description,
    quantity,
    unit_value_brl,
    total_value_brl,
    bl_id,
    manifest_id,
    charge_table_id,
    charge_item_id,
    source,
    currency,
    unit_value_usd,
    total_value_usd,
    pricing_rule_version_id,
    billing_run_id,
    calculation_key,
    snapshot_payload
  )
  SELECT
    v_invoice_id,
    cc.id,
    CONCAT('BL ', cc.bl_id, ' - ', COALESCE(cti.name, cc.calculation_key, 'Linha de taxa')),
    COALESCE(cc.quantity, 1),
    COALESCE(cc.unit_value_brl, 0),
    COALESCE(cc.total_value_brl, 0),
    cc.bl_id,
    cc.manifest_id,
    cc.charge_table_id,
    cc.charge_item_id,
    cc.source,
    COALESCE(cti.currency, CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN 'USD' ELSE 'BRL' END),
    cc.unit_value_usd,
    cc.total_value_usd,
    cc.pricing_rule_version_id,
    cc.billing_run_id,
    cc.calculation_key,
    jsonb_build_object(
      'manifest_id', cc.manifest_id,
      'bl_id', cc.bl_id,
      'charge_table_id', cc.charge_table_id,
      'charge_item_id', cc.charge_item_id,
      'source', cc.source,
      'currency', COALESCE(cti.currency, CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN 'USD' ELSE 'BRL' END),
      'pricing_rule_version_id', cc.pricing_rule_version_id,
      'calculation_key', cc.calculation_key,
      'charge_name', cti.name
    )
  FROM public.charge_calculations AS cc
  LEFT JOIN public.charge_table_items AS cti ON cti.id = cc.charge_item_id
  WHERE cc.bl_id = ANY(v_requested_bls)
    AND COALESCE(cc.total_value_brl, 0) > 0
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt');

  GET DIAGNOSTICS v_item_count = ROW_COUNT;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Nenhuma linha BRL elegivel para faturamento.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(total_value_brl), 0)
  INTO v_total_brl
  FROM public.invoice_items
  WHERE invoice_id = v_invoice_id;

  UPDATE public.invoices
  SET
    total_brl = v_total_brl,
    total_paid_brl = 0,
    balance_brl = v_total_brl
  WHERE id = v_invoice_id;

  IF v_status = 'issued' THEN
    UPDATE public.bls
    SET financial_status = 'invoiced'
    WHERE id = ANY(v_requested_bls);
  END IF;

  IF v_batch_id IS NOT NULL THEN
    UPDATE public.billing_batches
    SET
      status = CASE WHEN v_status = 'issued' THEN 'issued' ELSE 'requested' END,
      invoice_id = v_invoice_id,
      notes = NULLIF(TRIM(COALESCE(p_notes, '')), '')
    WHERE id = v_batch_id;
  END IF;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
  )
  VALUES (
    'invoice',
    v_invoice_id::TEXT,
    'create_invoice',
    NULL,
    CONCAT('invoice=', v_invoice_number, ' | bl_count=', ARRAY_LENGTH(v_requested_bls, 1), ' | total=', v_total_brl),
    p_actor,
    now(),
    CASE WHEN COALESCE(p_origin, 'internal') = 'portal' THEN 'Emissao consolidada via portal do cliente' ELSE 'Emissao de invoice por B/L' END
  );

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'status', v_status,
    'customer_id', v_customer_id,
    'bl_count', ARRAY_LENGTH(v_requested_bls, 1),
    'total_brl', v_total_brl,
    'balance_brl', v_total_brl,
    'billing_batch_id', v_batch_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice_from_bls_core(TEXT[], BIGINT, DATE, TEXT, BOOLEAN, UUID, TEXT, BIGINT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.create_invoice_from_bls(
  p_bl_ids TEXT[],
  p_customer_id BIGINT DEFAULT NULL,
  p_due_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_issue_now BOOLEAN DEFAULT true,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  RETURN public.create_invoice_from_bls_core(
    p_bl_ids,
    p_customer_id,
    p_due_date,
    p_notes,
    p_issue_now,
    COALESCE(p_actor, auth.uid()),
    'internal',
    NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice_from_bls(TEXT[], BIGINT, DATE, TEXT, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_bls(TEXT[], BIGINT, DATE, TEXT, BOOLEAN, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.portal_list_pending_bls(p_session_token TEXT)
RETURNS TABLE (
  bl_id TEXT,
  pol TEXT,
  pod TEXT,
  charge_status TEXT,
  financial_status TEXT,
  billing_hold_reason TEXT,
  subtotal_brl NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH session_row AS (
    SELECT *
    FROM public.resolve_customer_portal_session(p_session_token)
    LIMIT 1
  )
  SELECT
    b.id AS bl_id,
    b.pol,
    b.pod,
    b.charge_status,
    b.financial_status,
    b.billing_hold_reason,
    COALESCE(SUM(COALESCE(cc.total_value_brl, 0)), 0) AS subtotal_brl
  FROM session_row
  JOIN public.bls AS b
    ON b.customer_id = session_row.customer_id
   AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('matched_document', 'reconciled')
  LEFT JOIN public.charge_calculations AS cc
    ON cc.bl_id = b.id
   AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt')
  WHERE COALESCE(b.charge_status, 'not_calculated') = 'ready_for_billing'
    AND COALESCE(b.financial_status, 'pending') = 'pending'
    AND NOT EXISTS (
      SELECT 1
      FROM public.invoice_bls AS ib
      JOIN public.invoices AS inv ON inv.id = ib.invoice_id
      WHERE ib.bl_id = b.id
        AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
    )
  GROUP BY b.id, b.pol, b.pod, b.charge_status, b.financial_status, b.billing_hold_reason
  ORDER BY b.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.portal_list_pending_bls(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_list_pending_bls(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_list_invoices(p_session_token TEXT)
RETURNS TABLE (
  id BIGINT,
  invoice_number TEXT,
  issued_at TIMESTAMPTZ,
  due_date DATE,
  total_brl NUMERIC,
  total_paid_brl NUMERIC,
  balance_brl NUMERIC,
  status TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH session_row AS (
    SELECT *
    FROM public.resolve_customer_portal_session(p_session_token)
    LIMIT 1
  )
  SELECT
    i.id,
    i.invoice_number,
    i.issued_at,
    i.due_date,
    i.total_brl,
    i.total_paid_brl,
    i.balance_brl,
    i.status
  FROM session_row
  JOIN public.invoices AS i ON i.customer_id = session_row.customer_id
  ORDER BY i.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.portal_list_invoices(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_list_invoices(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_invoice_details(
  p_session_token TEXT,
  p_invoice_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session RECORD;
  v_invoice JSONB;
  v_bls JSONB;
  v_items JSONB;
  v_payments JSONB;
BEGIN
  SELECT *
  INTO v_session
  FROM public.resolve_customer_portal_session(p_session_token)
  LIMIT 1;

  SELECT TO_JSONB(i.*) || jsonb_build_object(
    'customer_name', c.name,
    'customer_cnpj_cpf', c.cnpj_cpf
  )
  INTO v_invoice
  FROM public.invoices AS i
  LEFT JOIN public.customers AS c ON c.id = i.customer_id
  WHERE i.id = p_invoice_id
    AND i.customer_id = v_session.customer_id;

  IF v_invoice IS NULL THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(JSONB_AGG(
    TO_JSONB(ib.*) || jsonb_build_object(
      'charge_status', b.charge_status,
      'financial_status', b.financial_status,
      'pol', b.pol,
      'pod', b.pod,
      'voyage_number', v.voyage_number,
      'vessel_name', vs.name
    )
    ORDER BY ib.id
  ), '[]'::JSONB)
  INTO v_bls
  FROM public.invoice_bls AS ib
  JOIN public.bls AS b ON b.id = ib.bl_id
  LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
  LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
  WHERE ib.invoice_id = p_invoice_id;

  SELECT COALESCE(JSONB_AGG(TO_JSONB(ii.*) ORDER BY ii.id), '[]'::JSONB)
  INTO v_items
  FROM public.invoice_items AS ii
  WHERE ii.invoice_id = p_invoice_id;

  SELECT COALESCE(JSONB_AGG(TO_JSONB(p.*) ORDER BY p.paid_at DESC, p.id DESC), '[]'::JSONB)
  INTO v_payments
  FROM public.payments AS p
  WHERE p.invoice_id = p_invoice_id;

  RETURN jsonb_build_object(
    'invoice', v_invoice,
    'bls', v_bls,
    'items', v_items,
    'payments', v_payments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.portal_invoice_details(TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_invoice_details(TEXT, BIGINT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_create_consolidation(
  p_session_token TEXT,
  p_bl_ids TEXT[],
  p_due_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session RECORD;
BEGIN
  SELECT *
  INTO v_session
  FROM public.resolve_customer_portal_session(p_session_token)
  LIMIT 1;

  RETURN public.create_invoice_from_bls_core(
    p_bl_ids,
    v_session.customer_id,
    p_due_date,
    p_notes,
    true,
    NULL,
    'portal',
    v_session.account_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.portal_create_consolidation(TEXT, TEXT[], DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_create_consolidation(TEXT, TEXT[], DATE, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.cancel_invoice(
  p_invoice_id BIGINT,
  p_reason TEXT,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice RECORD;
  v_actor UUID;
  v_payment_count INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT *
  INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') = 'cancelled' THEN
    RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'cancelled', 'changed', false);
  END IF;

  SELECT COUNT(*)
  INTO v_payment_count
  FROM public.payments
  WHERE invoice_id = p_invoice_id;

  IF v_payment_count > 0 THEN
    RAISE EXCEPTION 'Nao e permitido cancelar invoice com pagamentos registrados.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices
  SET
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = v_actor,
    cancel_reason = NULLIF(TRIM(COALESCE(p_reason, '')), ''),
    balance_brl = GREATEST(COALESCE(total_brl, 0) - COALESCE(total_paid_brl, 0), 0)
  WHERE id = p_invoice_id;

  UPDATE public.billing_batches
  SET status = 'cancelled'
  WHERE invoice_id = p_invoice_id;

  UPDATE public.bls AS b
  SET financial_status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.invoice_bls AS ib2
      JOIN public.invoices AS inv2 ON inv2.id = ib2.invoice_id
      WHERE ib2.bl_id = b.id
        AND inv2.id <> p_invoice_id
        AND COALESCE(inv2.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
    ) THEN 'invoiced'
    WHEN EXISTS (
      SELECT 1
      FROM public.invoice_bls AS ib3
      JOIN public.invoices AS inv3 ON inv3.id = ib3.invoice_id
      WHERE ib3.bl_id = b.id
        AND inv3.id <> p_invoice_id
        AND COALESCE(inv3.status, 'issued') = 'paid'
    ) THEN 'paid'
    ELSE 'pending'
  END
  WHERE b.id IN (
    SELECT ib.bl_id
    FROM public.invoice_bls AS ib
    WHERE ib.invoice_id = p_invoice_id
  );

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'cancelled', 'changed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_invoice(BIGINT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_invoice(BIGINT, TEXT, UUID) TO authenticated;
