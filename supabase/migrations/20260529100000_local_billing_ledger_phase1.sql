-- Phase 1: Local-charge billing ledger foundation.
-- Keeps existing invoice flows intact while adding receivable-level truth.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS invoice_type TEXT NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS obsolete_reason TEXT,
  ADD COLUMN IF NOT EXISTS covered_by_invoice_id BIGINT REFERENCES public.invoices(id),
  ADD COLUMN IF NOT EXISTS replaced_by_invoice_id BIGINT REFERENCES public.invoices(id);

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'covered', 'obsolete', 'overdue', 'cancelled'));

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_invoice_type_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_invoice_type_check
  CHECK (invoice_type IN ('individual', 'consolidated', 'granite'));

CREATE TABLE IF NOT EXISTS public.bl_receivables (
  id BIGSERIAL PRIMARY KEY,
  bl_id TEXT NOT NULL REFERENCES public.bls(id) ON DELETE RESTRICT,
  customer_id BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  source TEXT NOT NULL DEFAULT 'local_charges',
  original_amount_brl NUMERIC(14,2) NOT NULL DEFAULT 0,
  settled_amount_brl NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance_brl NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  voyage_id BIGINT REFERENCES public.voyages(id),
  cargo_mode TEXT,
  pol TEXT,
  pod TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, bl_id),
  CONSTRAINT bl_receivables_amounts_non_negative
    CHECK (original_amount_brl >= 0 AND settled_amount_brl >= 0 AND balance_brl >= 0),
  CONSTRAINT bl_receivables_status_check
    CHECK (status IN ('open', 'partially_settled', 'settled', 'void')),
  CONSTRAINT bl_receivables_source_check
    CHECK (source IN ('local_charges'))
);

CREATE INDEX IF NOT EXISTS idx_bl_receivables_customer_status
  ON public.bl_receivables(customer_id, status);

CREATE INDEX IF NOT EXISTS idx_bl_receivables_voyage
  ON public.bl_receivables(voyage_id);

CREATE INDEX IF NOT EXISTS idx_bl_receivables_bl
  ON public.bl_receivables(bl_id);

CREATE TABLE IF NOT EXISTS public.invoice_receivable_links (
  id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  receivable_id BIGINT NOT NULL REFERENCES public.bl_receivables(id) ON DELETE RESTRICT,
  bl_id TEXT NOT NULL REFERENCES public.bls(id) ON DELETE RESTRICT,
  subtotal_brl NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  bl_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, receivable_id),
  CONSTRAINT invoice_receivable_links_status_check
    CHECK (status IN ('active', 'settled_by_this_invoice', 'settled_elsewhere', 'obsolete'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_receivable_links_invoice
  ON public.invoice_receivable_links(invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_receivable_links_receivable_status
  ON public.invoice_receivable_links(receivable_id, status);

CREATE TABLE IF NOT EXISTS public.ledger_settlements (
  id BIGSERIAL PRIMARY KEY,
  payment_id BIGINT REFERENCES public.payments(id) ON DELETE SET NULL,
  receivable_id BIGINT NOT NULL REFERENCES public.bl_receivables(id) ON DELETE RESTRICT,
  invoice_id BIGINT REFERENCES public.invoices(id) ON DELETE SET NULL,
  amount_brl NUMERIC(14,2) NOT NULL,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  method TEXT,
  pix_txid TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ledger_settlements_amount_positive CHECK (amount_brl > 0),
  CONSTRAINT ledger_settlements_source_check CHECK (source IN ('manual', 'pix_extract', 'backfill'))
);

CREATE INDEX IF NOT EXISTS idx_ledger_settlements_receivable
  ON public.ledger_settlements(receivable_id);

CREATE INDEX IF NOT EXISTS idx_ledger_settlements_pix_txid
  ON public.ledger_settlements(pix_txid)
  WHERE pix_txid IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.invoice_lifecycle_events (
  id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  related_invoice_id BIGINT REFERENCES public.invoices(id),
  receivable_id BIGINT REFERENCES public.bl_receivables(id),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invoice_lifecycle_events_type_check
    CHECK (event_type IN ('issued', 'paid', 'partially_paid', 'covered', 'obsolete', 'cancelled', 'reconciled_by_txid', 'backfilled'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_lifecycle_events_invoice
  ON public.invoice_lifecycle_events(invoice_id, created_at DESC);

ALTER TABLE public.bl_receivables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_receivable_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lifecycle_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bl_receivables_select_admin ON public.bl_receivables;
DROP POLICY IF EXISTS bl_receivables_insert_admin ON public.bl_receivables;
DROP POLICY IF EXISTS bl_receivables_update_admin ON public.bl_receivables;
DROP POLICY IF EXISTS bl_receivables_delete_admin ON public.bl_receivables;

CREATE POLICY bl_receivables_select_admin
  ON public.bl_receivables FOR SELECT
  TO authenticated USING (public.is_admin());

CREATE POLICY bl_receivables_insert_admin
  ON public.bl_receivables FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY bl_receivables_update_admin
  ON public.bl_receivables FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY bl_receivables_delete_admin
  ON public.bl_receivables FOR DELETE
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS invoice_receivable_links_select_admin ON public.invoice_receivable_links;
DROP POLICY IF EXISTS invoice_receivable_links_insert_admin ON public.invoice_receivable_links;
DROP POLICY IF EXISTS invoice_receivable_links_update_admin ON public.invoice_receivable_links;
DROP POLICY IF EXISTS invoice_receivable_links_delete_admin ON public.invoice_receivable_links;

CREATE POLICY invoice_receivable_links_select_admin
  ON public.invoice_receivable_links FOR SELECT
  TO authenticated USING (public.is_admin());

CREATE POLICY invoice_receivable_links_insert_admin
  ON public.invoice_receivable_links FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY invoice_receivable_links_update_admin
  ON public.invoice_receivable_links FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY invoice_receivable_links_delete_admin
  ON public.invoice_receivable_links FOR DELETE
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS ledger_settlements_select_admin ON public.ledger_settlements;
DROP POLICY IF EXISTS ledger_settlements_insert_admin ON public.ledger_settlements;
DROP POLICY IF EXISTS ledger_settlements_update_admin ON public.ledger_settlements;
DROP POLICY IF EXISTS ledger_settlements_delete_admin ON public.ledger_settlements;

CREATE POLICY ledger_settlements_select_admin
  ON public.ledger_settlements FOR SELECT
  TO authenticated USING (public.is_admin());

CREATE POLICY ledger_settlements_insert_admin
  ON public.ledger_settlements FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY ledger_settlements_update_admin
  ON public.ledger_settlements FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY ledger_settlements_delete_admin
  ON public.ledger_settlements FOR DELETE
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS invoice_lifecycle_events_select_admin ON public.invoice_lifecycle_events;
DROP POLICY IF EXISTS invoice_lifecycle_events_insert_admin ON public.invoice_lifecycle_events;
DROP POLICY IF EXISTS invoice_lifecycle_events_update_admin ON public.invoice_lifecycle_events;
DROP POLICY IF EXISTS invoice_lifecycle_events_delete_admin ON public.invoice_lifecycle_events;

CREATE POLICY invoice_lifecycle_events_select_admin
  ON public.invoice_lifecycle_events FOR SELECT
  TO authenticated USING (public.is_admin());

CREATE POLICY invoice_lifecycle_events_insert_admin
  ON public.invoice_lifecycle_events FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY invoice_lifecycle_events_update_admin
  ON public.invoice_lifecycle_events FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY invoice_lifecycle_events_delete_admin
  ON public.invoice_lifecycle_events FOR DELETE
  TO authenticated USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bl_receivables TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_receivable_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ledger_settlements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_lifecycle_events TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.bl_receivables_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.invoice_receivable_links_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.ledger_settlements_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.invoice_lifecycle_events_id_seq TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_local_charge_receivable(p_bl_id TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bl RECORD;
  v_amount NUMERIC(14,2);
  v_paid_amount NUMERIC(14,2);
  v_receivable_id BIGINT;
  v_status TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT id, customer_id, voyage_id, cargo_mode, pol, pod
  INTO v_bl
  FROM public.bls
  WHERE id = UPPER(TRIM(p_bl_id));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.customer_id IS NULL THEN
    RAISE EXCEPTION 'B/L % sem cliente vinculado.', p_bl_id USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(COALESCE(total_value_brl, 0)), 0)
  INTO v_amount
  FROM public.charge_calculations
  WHERE bl_id = v_bl.id
    AND COALESCE(status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt');

  SELECT COALESCE(SUM(p.amount_brl), 0)
  INTO v_paid_amount
  FROM public.invoice_bls ib
  JOIN public.invoices i ON i.id = ib.invoice_id
  JOIN public.payments p ON p.invoice_id = i.id
  WHERE ib.bl_id = v_bl.id
    AND COALESCE(i.status, 'issued') = 'paid';

  v_paid_amount := LEAST(v_paid_amount, v_amount);
  v_status := CASE
    WHEN v_amount <= 0 THEN 'void'
    WHEN v_paid_amount >= v_amount THEN 'settled'
    WHEN v_paid_amount > 0 THEN 'partially_settled'
    ELSE 'open'
  END;

  INSERT INTO public.bl_receivables (
    bl_id,
    customer_id,
    source,
    original_amount_brl,
    settled_amount_brl,
    balance_brl,
    status,
    voyage_id,
    cargo_mode,
    pol,
    pod,
    updated_at
  )
  VALUES (
    v_bl.id,
    v_bl.customer_id,
    'local_charges',
    v_amount,
    v_paid_amount,
    GREATEST(v_amount - v_paid_amount, 0),
    v_status,
    v_bl.voyage_id,
    v_bl.cargo_mode,
    v_bl.pol,
    v_bl.pod,
    now()
  )
  ON CONFLICT (source, bl_id)
  DO UPDATE SET
    customer_id = EXCLUDED.customer_id,
    original_amount_brl = EXCLUDED.original_amount_brl,
    settled_amount_brl = EXCLUDED.settled_amount_brl,
    balance_brl = EXCLUDED.balance_brl,
    status = EXCLUDED.status,
    voyage_id = EXCLUDED.voyage_id,
    cargo_mode = EXCLUDED.cargo_mode,
    pol = EXCLUDED.pol,
    pod = EXCLUDED.pod,
    updated_at = now()
  RETURNING id INTO v_receivable_id;

  RETURN v_receivable_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_local_charge_receivable(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_local_charge_receivable(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.backfill_local_charge_receivables(p_limit INTEGER DEFAULT 5000)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row RECORD;
  v_synced INTEGER := 0;
  v_skipped INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN
    SELECT b.id
    FROM public.bls b
    WHERE b.customer_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.charge_calculations cc
        WHERE cc.bl_id = b.id
          AND COALESCE(cc.total_value_brl, 0) > 0
          AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt')
      )
    ORDER BY b.created_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
  LOOP
    BEGIN
      PERFORM public.sync_local_charge_receivable(v_row.id);
      v_synced := v_synced + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('synced', v_synced, 'skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_local_charge_receivables(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_local_charge_receivables(INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.backfill_invoice_receivable_links(p_limit INTEGER DEFAULT 5000)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  WITH invoice_bl_counts AS (
    SELECT invoice_id, COUNT(*) AS bl_count
    FROM public.invoice_bls
    GROUP BY invoice_id
  )
  UPDATE public.invoices i
  SET invoice_type = CASE WHEN COALESCE(c.bl_count, 1) > 1 THEN 'consolidated' ELSE 'individual' END
  FROM invoice_bl_counts c
  WHERE c.invoice_id = i.id
    AND i.invoice_type = 'individual';

  WITH inserted AS (
    INSERT INTO public.invoice_receivable_links (
      invoice_id,
      receivable_id,
      bl_id,
      subtotal_brl,
      status,
      bl_snapshot
    )
    SELECT
      ib.invoice_id,
      br.id,
      ib.bl_id,
      COALESCE(ib.subtotal_brl, br.original_amount_brl, 0),
      CASE
        WHEN COALESCE(i.status, 'issued') = 'paid' THEN 'settled_by_this_invoice'
        WHEN COALESCE(i.status, 'issued') = 'cancelled' THEN 'obsolete'
        ELSE 'active'
      END,
      jsonb_build_object(
        'bl_id', b.id,
        'voyage_id', b.voyage_id,
        'cargo_mode', b.cargo_mode,
        'pol', b.pol,
        'pod', b.pod
      )
    FROM public.invoice_bls ib
    JOIN public.invoices i ON i.id = ib.invoice_id
    JOIN public.bl_receivables br ON br.source = 'local_charges' AND br.bl_id = ib.bl_id
    JOIN public.bls b ON b.id = ib.bl_id
    ORDER BY ib.id DESC
    LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
    ON CONFLICT (invoice_id, receivable_id)
    DO UPDATE SET
      subtotal_brl = EXCLUDED.subtotal_brl,
      status = EXCLUDED.status,
      bl_snapshot = EXCLUDED.bl_snapshot
    RETURNING id
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  RETURN jsonb_build_object('links_upserted', v_inserted);
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_invoice_receivable_links(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_invoice_receivable_links(INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_consolidatable_receivables(
  p_customer_id BIGINT,
  p_voyage_id BIGINT DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
  receivable_id BIGINT,
  bl_id TEXT,
  customer_id BIGINT,
  customer_name TEXT,
  customer_cnpj_cpf TEXT,
  voyage_id BIGINT,
  vessel_name TEXT,
  voyage_number TEXT,
  individual_invoice_id BIGINT,
  individual_invoice_number TEXT,
  balance_brl NUMERIC,
  original_amount_brl NUMERIC,
  receivable_status TEXT,
  eligibility_status TEXT,
  eligibility_reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      br.id AS receivable_id,
      br.bl_id,
      br.customer_id,
      c.name AS customer_name,
      c.cnpj_cpf AS customer_cnpj_cpf,
      br.voyage_id,
      v.voyage_number,
      ve.name AS vessel_name,
      br.balance_brl,
      br.original_amount_brl,
      br.status AS receivable_status,
      indiv.invoice_id AS individual_invoice_id,
      inv_ind.invoice_number AS individual_invoice_number,
      EXISTS (
        SELECT 1
        FROM public.invoice_receivable_links irl
        JOIN public.invoices inv ON inv.id = irl.invoice_id
        WHERE irl.receivable_id = br.id
          AND inv.invoice_type = 'consolidated'
          AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
      ) AS has_open_consolidated
    FROM public.bl_receivables br
    JOIN public.customers c ON c.id = br.customer_id
    LEFT JOIN public.voyages v ON v.id = br.voyage_id
    LEFT JOIN public.vessels ve ON ve.id = v.vessel_id
    LEFT JOIN LATERAL (
      SELECT irl.invoice_id
      FROM public.invoice_receivable_links irl
      JOIN public.invoices inv ON inv.id = irl.invoice_id
      WHERE irl.receivable_id = br.id
        AND inv.invoice_type = 'individual'
      ORDER BY inv.id DESC
      LIMIT 1
    ) indiv ON TRUE
    LEFT JOIN public.invoices inv_ind ON inv_ind.id = indiv.invoice_id
    WHERE br.customer_id = p_customer_id
      AND (p_voyage_id IS NULL OR br.voyage_id = p_voyage_id)
      AND (
        NULLIF(TRIM(COALESCE(p_search, '')), '') IS NULL
        OR br.bl_id ILIKE '%' || TRIM(p_search) || '%'
      )
  )
  SELECT
    base.receivable_id,
    base.bl_id,
    base.customer_id,
    base.customer_name,
    base.customer_cnpj_cpf,
    base.voyage_id,
    base.vessel_name,
    base.voyage_number,
    base.individual_invoice_id,
    base.individual_invoice_number,
    base.balance_brl,
    base.original_amount_brl,
    base.receivable_status,
    CASE
      WHEN base.receivable_status = 'settled' THEN 'paid'
      WHEN base.receivable_status = 'void' THEN 'no_balance'
      WHEN base.has_open_consolidated THEN 'open_consolidated'
      WHEN base.balance_brl <= 0 THEN 'no_balance'
      ELSE 'eligible'
    END AS eligibility_status,
    CASE
      WHEN base.receivable_status = 'settled' THEN 'B/L ja liquidado.'
      WHEN base.receivable_status = 'void' THEN 'B/L sem saldo de taxas locais.'
      WHEN base.has_open_consolidated THEN 'B/L ja esta em consolidada aberta.'
      WHEN base.balance_brl <= 0 THEN 'B/L sem saldo aberto.'
      ELSE 'Elegivel para consolidacao.'
    END AS eligibility_reason
  FROM base
  ORDER BY base.voyage_id DESC NULLS LAST, base.bl_id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_consolidatable_receivables(BIGINT, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_consolidatable_receivables(BIGINT, BIGINT, TEXT) TO authenticated;
