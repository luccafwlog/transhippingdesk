-- Billing hybrid workflow
-- 1) invoice <-> BL N:N link table
-- 2) invoice lifecycle fields/statuses
-- 3) financial RPCs for create, payment, cancel and details

CREATE TABLE IF NOT EXISTS public.invoice_bls (
  id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  bl_id TEXT NOT NULL REFERENCES public.bls(id) ON DELETE RESTRICT,
  charge_status_snapshot TEXT,
  financial_status_snapshot TEXT,
  subtotal_brl NUMERIC(14,2) NOT NULL DEFAULT 0,
  subtotal_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, bl_id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_bls_invoice_id ON public.invoice_bls (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_bls_bl_id ON public.invoice_bls (bl_id);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS total_paid_brl NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS balance_brl NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS issued_by UUID REFERENCES auth.users(id);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE public.invoices
SET
  status = COALESCE(status, 'issued'),
  total_paid_brl = COALESCE(total_paid_brl, CASE WHEN status = 'paid' THEN total_brl ELSE 0 END),
  balance_brl = COALESCE(balance_brl, GREATEST(COALESCE(total_brl, 0) - COALESCE(total_paid_brl, 0), 0));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoices_status_check'
  ) THEN
    ALTER TABLE public.invoices DROP CONSTRAINT invoices_status_check;
  END IF;

  ALTER TABLE public.invoices
    ADD CONSTRAINT invoices_status_check
    CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled'));
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoices_total_paid_nonneg'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_total_paid_nonneg
      CHECK (total_paid_brl >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoices_balance_nonneg'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_balance_nonneg
      CHECK (balance_brl >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_status_due_date ON public.invoices (status, due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_issued_at ON public.invoices (customer_id, issued_at DESC);

DROP TRIGGER IF EXISTS set_invoices_updated_at ON public.invoices;
CREATE TRIGGER set_invoices_updated_at
BEFORE UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.invoice_bls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_bls_select_admin ON public.invoice_bls;
DROP POLICY IF EXISTS invoice_bls_insert_admin ON public.invoice_bls;
DROP POLICY IF EXISTS invoice_bls_update_admin ON public.invoice_bls;
DROP POLICY IF EXISTS invoice_bls_delete_admin ON public.invoice_bls;

CREATE POLICY invoice_bls_select_admin
ON public.invoice_bls
FOR SELECT
TO authenticated
USING (public.is_admin());

CREATE POLICY invoice_bls_insert_admin
ON public.invoice_bls
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY invoice_bls_update_admin
ON public.invoice_bls
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY invoice_bls_delete_admin
ON public.invoice_bls
FOR DELETE
TO authenticated
USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_bls TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.invoice_bls_id_seq TO authenticated;

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
DECLARE
  v_actor UUID;
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
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());
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
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_create_conflict',
      NULL,
      'B/L sem status ready_for_billing',
      auth.uid(),
      now(),
      'Tentativa de emissao bloqueada por elegibilidade'
    );
    RAISE EXCEPTION 'Todos os B/Ls devem estar como ready_for_billing.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = ANY(v_requested_bls)
      AND COALESCE(b.financial_status, 'pending') <> 'pending'
  ) THEN
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_create_conflict',
      NULL,
      'B/L ja possui status financeiro diferente de pending',
      auth.uid(),
      now(),
      'Tentativa de emissao bloqueada por conflito financeiro'
    );
    RAISE EXCEPTION 'Existe B/L ja faturado/pago/cancelado na selecao.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = ANY(v_requested_bls)
      AND b.customer_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Todos os B/Ls precisam de cliente vinculado para faturar.' USING ERRCODE = '22023';
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
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_create_conflict',
      NULL,
      CONCAT(v_conflict_count, ' B/L(s) ja vinculado(s) a invoice ativa'),
      auth.uid(),
      now(),
      'Tentativa de emissao bloqueada por conflito de vinculo'
    );
    RAISE EXCEPTION 'Existe B/L vinculado a invoice ativa.' USING ERRCODE = '23505';
  END IF;

  SELECT COUNT(*)
  INTO v_usd_count
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = ANY(v_requested_bls)
    AND COALESCE(cc.total_value_usd, 0) > 0
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_usd_count > 0 THEN
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_create_conflict',
      NULL,
      CONCAT(v_usd_count, ' linha(s) USD encontrada(s)'),
      auth.uid(),
      now(),
      'Faturamento v1 em BRL'
    );
    RAISE EXCEPTION 'Existem linhas em USD. Ajuste manualmente antes de faturar.' USING ERRCODE = '22023';
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
    v_actor
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
    total_value_brl
  )
  SELECT
    v_invoice_id,
    cc.id,
    CONCAT('BL ', cc.bl_id, ' - ', COALESCE(cti.name, cc.calculation_key, 'Linha de taxa')),
    COALESCE(cc.quantity, 1),
    COALESCE(cc.unit_value_brl, 0),
    COALESCE(cc.total_value_brl, 0)
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

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
  )
  VALUES (
    'invoice',
    v_invoice_id::TEXT,
    'create_invoice',
    NULL,
    CONCAT('invoice=', v_invoice_number, ' | bl_count=', ARRAY_LENGTH(v_requested_bls, 1), ' | total=', v_total_brl),
    auth.uid(),
    now(),
    'Emissao de invoice hibrida por B/L'
  );

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'status', v_status,
    'customer_id', v_customer_id,
    'bl_count', ARRAY_LENGTH(v_requested_bls, 1),
    'total_brl', v_total_brl,
    'balance_brl', v_total_brl
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice_from_bls(TEXT[], BIGINT, DATE, TEXT, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_bls(TEXT[], BIGINT, DATE, TEXT, BOOLEAN, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_invoice_payment(
  p_invoice_id BIGINT,
  p_amount_brl NUMERIC,
  p_payment_method TEXT DEFAULT 'pix',
  p_paid_at TIMESTAMPTZ DEFAULT now(),
  p_notes TEXT DEFAULT NULL,
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
  v_total_paid NUMERIC(14,2);
  v_balance NUMERIC(14,2);
  v_remaining NUMERIC(14,2);
  v_next_status TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  IF COALESCE(p_amount_brl, 0) <= 0 THEN
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_payment_invalid',
      NULL,
      CONCAT('invoice=', p_invoice_id, ' | amount=', COALESCE(p_amount_brl, 0)),
      auth.uid(),
      now(),
      'Valor de pagamento menor ou igual a zero'
    );
    RAISE EXCEPTION 'Valor de pagamento deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') = 'cancelled' THEN
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_payment_invalid',
      NULL,
      CONCAT('invoice=', p_invoice_id, ' cancelada'),
      auth.uid(),
      now(),
      'Tentativa de pagamento em invoice cancelada'
    );
    RAISE EXCEPTION 'Invoice cancelada nao aceita pagamento.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') = 'paid' THEN
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_payment_invalid',
      NULL,
      CONCAT('invoice=', p_invoice_id, ' ja paga'),
      auth.uid(),
      now(),
      'Tentativa de pagamento em invoice ja quitada'
    );
    RAISE EXCEPTION 'Invoice ja esta paga.' USING ERRCODE = '22023';
  END IF;

  v_remaining := GREATEST(COALESCE(v_invoice.balance_brl, COALESCE(v_invoice.total_brl, 0)), 0);
  IF p_amount_brl > v_remaining THEN
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_payment_invalid',
      NULL,
      CONCAT('invoice=', p_invoice_id, ' | amount=', p_amount_brl, ' | remaining=', v_remaining),
      auth.uid(),
      now(),
      'Tentativa de pagamento acima do saldo da invoice'
    );
    RAISE EXCEPTION 'Pagamento acima do saldo em aberto da invoice.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payments (
    invoice_id,
    amount_brl,
    payment_method,
    paid_at,
    registered_by,
    notes
  )
  VALUES (
    p_invoice_id,
    p_amount_brl,
    COALESCE(NULLIF(TRIM(COALESCE(p_payment_method, '')), ''), 'pix'),
    COALESCE(p_paid_at, now()),
    v_actor,
    NULLIF(TRIM(COALESCE(p_notes, '')), '')
  );

  SELECT COALESCE(SUM(amount_brl), 0)
  INTO v_total_paid
  FROM public.payments
  WHERE invoice_id = p_invoice_id;

  v_balance := GREATEST(COALESCE(v_invoice.total_brl, 0) - v_total_paid, 0);

  IF v_balance = 0 THEN
    v_next_status := 'paid';
  ELSIF v_total_paid > 0 THEN
    v_next_status := 'partially_paid';
  ELSE
    v_next_status := 'issued';
  END IF;

  IF v_next_status IN ('issued', 'partially_paid')
    AND v_invoice.due_date IS NOT NULL
    AND v_invoice.due_date < CURRENT_DATE THEN
    v_next_status := 'overdue';
  END IF;

  UPDATE public.invoices
  SET
    total_paid_brl = v_total_paid,
    balance_brl = v_balance,
    status = v_next_status
  WHERE id = p_invoice_id;

  IF v_next_status = 'paid' THEN
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
      ELSE 'paid'
    END
    WHERE b.id IN (
      SELECT ib.bl_id
      FROM public.invoice_bls AS ib
      WHERE ib.invoice_id = p_invoice_id
    );
  ELSE
    UPDATE public.bls
    SET financial_status = 'invoiced'
    WHERE id IN (
      SELECT ib.bl_id
      FROM public.invoice_bls AS ib
      WHERE ib.invoice_id = p_invoice_id
    );
  END IF;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
  )
  VALUES (
    'invoice',
    p_invoice_id::TEXT,
    'register_payment',
    COALESCE(v_invoice.total_paid_brl::TEXT, '0'),
    v_total_paid::TEXT,
    auth.uid(),
    now(),
    'Registro de pagamento'
  );

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'status', v_next_status,
    'total_paid_brl', v_total_paid,
    'balance_brl', v_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_invoice_payment(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_invoice_payment(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, UUID) TO authenticated;

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
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_cancel_blocked',
      NULL,
      CONCAT('invoice=', p_invoice_id, ' com pagamentos vinculados'),
      auth.uid(),
      now(),
      'Cancelamento bloqueado por pagamentos existentes'
    );
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

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
  )
  VALUES (
    'invoice',
    p_invoice_id::TEXT,
    'cancel_invoice',
    COALESCE(v_invoice.status, 'issued'),
    'cancelled',
    auth.uid(),
    now(),
    COALESCE(NULLIF(TRIM(COALESCE(p_reason, '')), ''), 'Cancelamento manual')
  );

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'cancelled', 'changed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_invoice(BIGINT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_invoice(BIGINT, TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_invoice_details(p_invoice_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice JSONB;
  v_bls JSONB;
  v_items JSONB;
  v_payments JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT TO_JSONB(i.*) || jsonb_build_object(
    'customer_name', c.name,
    'customer_cnpj_cpf', c.cnpj_cpf
  )
  INTO v_invoice
  FROM public.invoices AS i
  LEFT JOIN public.customers AS c ON c.id = i.customer_id
  WHERE i.id = p_invoice_id;

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

REVOKE ALL ON FUNCTION public.list_invoice_details(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_invoice_details(BIGINT) TO authenticated;
