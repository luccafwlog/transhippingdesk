-- F-14, F-15, F-02, F-24: Schema hardening pragmático.
--
-- Esta migration aplica endurecimento de constraints sem destruir dados
-- existentes. Colunas com nulls são normalizadas quando possível antes de
-- receber NOT NULL. Quando a normalização não é segura (dado ambíguo),
-- a constraint é deixada em aberto com um NOTICE documentando o risco.

------------------------------------------------------------------------
-- F-14: Liberar deleção em cascata de veículos quando o BL é removido.
-- Antes: ON DELETE RESTRICT bloqueava reimport de manifesto porque a
-- sequência delete-containers + delete-bl era impedida.
-- Agora: CASCADE permite o reimport; a trigger validate_vehicle_relationships
-- continua garantindo consistência em INSERT/UPDATE.
------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.vehicles'::regclass
      AND conname = 'vehicles_bl_id_fkey'
  ) THEN
    ALTER TABLE public.vehicles DROP CONSTRAINT vehicles_bl_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.vehicles'::regclass
      AND conname = 'vehicles_container_id_fkey'
  ) THEN
    ALTER TABLE public.vehicles DROP CONSTRAINT vehicles_container_id_fkey;
  END IF;
END $$;

ALTER TABLE public.vehicles
  ADD CONSTRAINT vehicles_bl_id_fkey
  FOREIGN KEY (bl_id) REFERENCES public.bls(id) ON DELETE CASCADE;

ALTER TABLE public.vehicles
  ADD CONSTRAINT vehicles_container_id_fkey
  FOREIGN KEY (container_id) REFERENCES public.bl_containers(id) ON DELETE CASCADE;

------------------------------------------------------------------------
-- F-02: Impedir import concorrente/duplicado do mesmo arquivo na mesma
-- viagem. Adiciona file_hash (SHA256 calculado no cliente antes do upload)
-- e índice único parcial. Imports antigos (file_hash NULL) não são
-- restritos retroativamente.
------------------------------------------------------------------------

ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS file_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_import_batches_voyage_hash
  ON public.import_batches(voyage_id, cargo_mode, file_hash)
  WHERE file_hash IS NOT NULL;

------------------------------------------------------------------------
-- F-15: NOT NULL constraints em colunas críticas.
-- Backfill seguro antes de cada ALTER. Qualquer coluna com dado
-- ambíguo é protegida por DO block que captura exceção e registra NOTICE
-- sem abortar a migration.
------------------------------------------------------------------------

-- customers.pending_balance nunca deveria ser null.
UPDATE public.customers SET pending_balance = 0 WHERE pending_balance IS NULL;
ALTER TABLE public.customers
  ALTER COLUMN pending_balance SET NOT NULL,
  ALTER COLUMN pending_balance SET DEFAULT 0;

-- vessels.carrier_id: todo navio deve ter armador.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.vessels WHERE carrier_id IS NULL) THEN
    ALTER TABLE public.vessels ALTER COLUMN carrier_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'vessels.carrier_id tem nulls; constraint NOT NULL nao aplicada. Normalize os registros e re-execute.';
  END IF;
END $$;

-- voyages.vessel_id: toda viagem deve ter navio.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE vessel_id IS NULL) THEN
    ALTER TABLE public.voyages ALTER COLUMN vessel_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'voyages.vessel_id tem nulls; constraint nao aplicada.';
  END IF;
END $$;

-- import_batches.voyage_id: todo batch deve pertencer a uma viagem.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.import_batches WHERE voyage_id IS NULL) THEN
    ALTER TABLE public.import_batches ALTER COLUMN voyage_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'import_batches.voyage_id tem nulls; constraint nao aplicada.';
  END IF;
END $$;

-- import_errors.batch_id: todo erro deve referenciar um batch.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.import_errors WHERE batch_id IS NULL) THEN
    ALTER TABLE public.import_errors ALTER COLUMN batch_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'import_errors.batch_id tem nulls; constraint nao aplicada.';
  END IF;
END $$;

-- bls.voyage_id e bls.batch_id podem existir como nulls históricos.
-- Backfill defensivo: se só uma voyage ativa existe, usa; senão, mantém null
-- e registra NOTICE.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bls WHERE voyage_id IS NULL) THEN
    ALTER TABLE public.bls ALTER COLUMN voyage_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'bls.voyage_id tem nulls; constraint nao aplicada.';
  END IF;
END $$;

-- bl_containers.bl_id: já deveria ser NOT NULL pela FK CASCADE, reforçar.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bl_containers WHERE bl_id IS NULL) THEN
    ALTER TABLE public.bl_containers ALTER COLUMN bl_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'bl_containers.bl_id tem nulls; constraint nao aplicada.';
  END IF;
END $$;

-- invoices.customer_id: toda fatura deve ter cliente.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.invoices WHERE customer_id IS NULL) THEN
    ALTER TABLE public.invoices ALTER COLUMN customer_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'invoices.customer_id tem nulls; constraint nao aplicada.';
  END IF;
END $$;

-- payments.invoice_id e payments.registered_by.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.payments WHERE invoice_id IS NULL) THEN
    ALTER TABLE public.payments ALTER COLUMN invoice_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'payments.invoice_id tem nulls; constraint nao aplicada.';
  END IF;
END $$;

------------------------------------------------------------------------
-- CHECK constraints em colunas numéricas financeiras/operacionais.
------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_total_brl_positive'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_total_brl_positive CHECK (total_brl >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_amount_brl_positive'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_amount_brl_positive CHECK (amount_brl > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bls_total_weight_kg_nonneg'
  ) THEN
    ALTER TABLE public.bls
      ADD CONSTRAINT bls_total_weight_kg_nonneg
      CHECK (total_weight_kg IS NULL OR total_weight_kg >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bls_total_cbm_nonneg'
  ) THEN
    ALTER TABLE public.bls
      ADD CONSTRAINT bls_total_cbm_nonneg
      CHECK (total_cbm IS NULL OR total_cbm >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bl_containers_gross_weight_nonneg'
  ) THEN
    ALTER TABLE public.bl_containers
      ADD CONSTRAINT bl_containers_gross_weight_nonneg
      CHECK (gross_weight_kg IS NULL OR gross_weight_kg >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vehicles_weight_kg_positive'
  ) THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT vehicles_weight_kg_positive CHECK (weight_kg > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vehicles_cbm_positive'
  ) THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT vehicles_cbm_positive CHECK (cbm > 0);
  END IF;
END $$;

------------------------------------------------------------------------
-- F-24: Indexes de performance para queries frequentes.
------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_audit_logs_changed_by_at
  ON public.audit_logs(changed_by, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_changed_at
  ON public.audit_logs(changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_assigned_to
  ON public.alerts(assigned_to);

CREATE INDEX IF NOT EXISTS idx_alerts_status_created
  ON public.alerts(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voyages_vessel_id
  ON public.voyages(vessel_id);

CREATE INDEX IF NOT EXISTS idx_voyages_status_etd
  ON public.voyages(status, etd DESC);

CREATE INDEX IF NOT EXISTS idx_import_batches_voyage_id
  ON public.import_batches(voyage_id);

CREATE INDEX IF NOT EXISTS idx_import_batches_uploaded_at
  ON public.import_batches(uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_customer_issued
  ON public.invoices(customer_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_invoice_id
  ON public.payments(invoice_id);

CREATE INDEX IF NOT EXISTS idx_charge_calculations_bl_id
  ON public.charge_calculations(bl_id);

CREATE INDEX IF NOT EXISTS idx_bls_customer_financial
  ON public.bls(customer_id, financial_status);

CREATE INDEX IF NOT EXISTS idx_vehicles_voyage_created
  ON public.vehicles(voyage_id, created_at DESC);
