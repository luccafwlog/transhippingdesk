-- FIX: Reemissao de invoices de Granito apos cancelamento e protecao contra corrida.

-- FIX: Bloqueia vinculo ativo duplicado mesmo se alguem inserir fora das RPCs.
CREATE OR REPLACE FUNCTION public.prevent_duplicate_active_invoice_bl_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.invoices inv
    WHERE inv.id = NEW.invoice_id
      AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue', 'paid')
  ) AND EXISTS (
    SELECT 1
    FROM public.invoice_bls ib
    JOIN public.invoices inv ON inv.id = ib.invoice_id
    WHERE ib.bl_id = NEW.bl_id
      AND ib.id IS DISTINCT FROM NEW.id
      AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue', 'paid')
  ) THEN
    RAISE EXCEPTION 'PT409: B/L ja vinculado a uma invoice ativa.' USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_active_invoice_bl_link ON public.invoice_bls;
CREATE TRIGGER trg_prevent_duplicate_active_invoice_bl_link
BEFORE INSERT OR UPDATE OF invoice_id, bl_id ON public.invoice_bls
FOR EACH ROW
EXECUTE FUNCTION public.prevent_duplicate_active_invoice_bl_link();

CREATE OR REPLACE FUNCTION public.prevent_duplicate_active_invoice_granite_bl_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.invoices inv
    WHERE inv.id = NEW.invoice_id
      AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue', 'paid')
  ) AND EXISTS (
    SELECT 1
    FROM public.invoice_granite_bls igb
    JOIN public.invoices inv ON inv.id = igb.invoice_id
    WHERE igb.granite_bl_id = NEW.granite_bl_id
      AND igb.id IS DISTINCT FROM NEW.id
      AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue', 'paid')
  ) THEN
    RAISE EXCEPTION 'PT409: B/L Granito ja vinculado a uma invoice ativa.' USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_active_invoice_granite_bl_link ON public.invoice_granite_bls;
CREATE TRIGGER trg_prevent_duplicate_active_invoice_granite_bl_link
BEFORE INSERT OR UPDATE OF invoice_id, granite_bl_id ON public.invoice_granite_bls
FOR EACH ROW
EXECUTE FUNCTION public.prevent_duplicate_active_invoice_granite_bl_link();

-- FIX: B/L container sem container vinculado deve ir para Pendencias, nunca seguir como pronto.
CREATE OR REPLACE FUNCTION public.guard_container_bl_without_containers()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason TEXT := 'B/L container sem container vinculado para calculo de taxas locais';
BEGIN
  IF COALESCE(NEW.cargo_mode, 'container') = 'container'
     AND COALESCE(NEW.charge_status, 'not_calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
     AND NOT EXISTS (
       SELECT 1
       FROM public.bl_containers bc
       WHERE bc.bl_id = NEW.id
         AND TRIM(COALESCE(bc.container_number, '')) <> ''
     ) THEN
    INSERT INTO public.charge_calculations (
      bl_id,
      source,
      status,
      calculation_key,
      quantity,
      total_value_brl,
      review_reason,
      notes,
      created_by,
      calculated_at
    )
    VALUES (
      NEW.id,
      'auto',
      'review_required',
      'review:no_container',
      1,
      0,
      v_reason,
      'Revisao manual obrigatoria',
      auth.uid(),
      NOW()
    )
    ON CONFLICT (bl_id, calculation_key) DO UPDATE
      SET status = EXCLUDED.status,
          quantity = EXCLUDED.quantity,
          total_value_brl = EXCLUDED.total_value_brl,
          review_reason = EXCLUDED.review_reason,
          notes = EXCLUDED.notes,
          created_by = EXCLUDED.created_by,
          calculated_at = NOW();

    UPDATE public.bls
    SET
      charge_status = 'review_required',
      billing_hold_reason = v_reason
    WHERE id = NEW.id
      AND COALESCE(charge_status, 'not_calculated') <> 'review_required';
  END IF;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_container_bl_without_containers ON public.bls;
CREATE TRIGGER trg_guard_container_bl_without_containers
AFTER INSERT OR UPDATE OF charge_status, cargo_mode ON public.bls
FOR EACH ROW
EXECUTE FUNCTION public.guard_container_bl_without_containers();

CREATE OR REPLACE FUNCTION public.create_invoice_from_granite_bls(
  p_granite_bl_ids UUID[],
  p_customer_id BIGINT DEFAULT NULL,
  p_due_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id             BIGINT;
  v_invoice_id              BIGINT;
  v_invoice_number          TEXT;
  v_total_brl               NUMERIC(14,2);
  v_bl_count                INT;
  v_distinct_customer_count INT;
  v_missing_customer_count  INT;
  v_actor                   UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  IF p_granite_bl_ids IS NULL OR COALESCE(array_length(p_granite_bl_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'PT409: Nenhum B/L Granito selecionado.';
  END IF;

  PERFORM 1
  FROM public.granite_bls
  WHERE id = ANY(p_granite_bl_ids)
  FOR UPDATE;

  IF (SELECT COUNT(*) FROM public.granite_bls WHERE id = ANY(p_granite_bl_ids)) <> array_length(p_granite_bl_ids, 1) THEN
    RAISE EXCEPTION 'PT409: Um ou mais B/Ls Granito nao foram encontrados.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.granite_bls
    WHERE id = ANY(p_granite_bl_ids)
      AND charge_status <> 'ready_for_billing'
  ) THEN
    RAISE EXCEPTION 'PT409: Um ou mais B/Ls Granito nao estao prontos para faturar (charge_status != ready_for_billing).';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_granite_bls igb
    JOIN public.invoices inv ON inv.id = igb.invoice_id
    WHERE igb.granite_bl_id = ANY(p_granite_bl_ids)
      AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue', 'paid')
  ) THEN
    RAISE EXCEPTION 'PT409: Um ou mais B/Ls Granito ja estao vinculados a uma invoice ativa.';
  END IF;

  SELECT
    COUNT(DISTINCT client_id) FILTER (WHERE client_id IS NOT NULL),
    COUNT(*) FILTER (WHERE client_id IS NULL)
  INTO v_distinct_customer_count, v_missing_customer_count
  FROM public.granite_bls
  WHERE id = ANY(p_granite_bl_ids);

  IF p_customer_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.granite_bls
      WHERE id = ANY(p_granite_bl_ids)
        AND client_id IS DISTINCT FROM p_customer_id
    ) THEN
      RAISE EXCEPTION 'PT409: Existem B/Ls de clientes diferentes no lote selecionado.';
    END IF;
    v_customer_id := p_customer_id;
  ELSE
    IF v_missing_customer_count > 0 THEN
      RAISE EXCEPTION 'PT409: Um ou mais B/Ls Granito nao possuem cliente vinculado.';
    END IF;

    IF v_distinct_customer_count <> 1 THEN
      RAISE EXCEPTION 'PT409: Os B/Ls selecionados precisam pertencer a um unico cliente.';
    END IF;

    SELECT DISTINCT client_id
    INTO v_customer_id
    FROM public.granite_bls
    WHERE id = ANY(p_granite_bl_ids)
    LIMIT 1;
  END IF;

  SELECT COALESCE(SUM(c.subtotal), 0)
  INTO v_total_brl
  FROM public.granite_bl_charges c
  WHERE c.bl_id = ANY(p_granite_bl_ids);

  IF COALESCE(v_total_brl, 0) <= 0 THEN
    RAISE EXCEPTION 'PT409: Nenhuma linha BRL elegivel para faturamento de Granito.';
  END IF;

  v_bl_count := array_length(p_granite_bl_ids, 1);

  INSERT INTO public.invoices (
    customer_id, issued_at, due_date, total_brl, status,
    notes, total_paid_brl, balance_brl, issued_by
  )
  VALUES (
    v_customer_id,
    now(),
    p_due_date,
    v_total_brl,
    'issued',
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    0,
    v_total_brl,
    v_actor
  )
  RETURNING id, invoice_number
  INTO v_invoice_id, v_invoice_number;

  INSERT INTO public.invoice_granite_bls (invoice_id, granite_bl_id, subtotal_brl)
  SELECT
    v_invoice_id,
    gb.id,
    COALESCE(charges.total, 0)
  FROM public.granite_bls gb
  LEFT JOIN (
    SELECT bl_id, SUM(subtotal) AS total
    FROM public.granite_bl_charges
    WHERE bl_id = ANY(p_granite_bl_ids)
    GROUP BY bl_id
  ) charges ON charges.bl_id = gb.id
  WHERE gb.id = ANY(p_granite_bl_ids);

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_value_brl, total_value_brl)
  SELECT
    v_invoice_id,
    CONCAT('Granito BL ', gb.bl_number, ' - ', COALESCE(c.description, 'Taxa')),
    COALESCE(c.quantity, 1),
    COALESCE(c.unit_value, 0),
    COALESCE(c.subtotal, 0)
  FROM public.granite_bl_charges c
  JOIN public.granite_bls gb ON gb.id = c.bl_id
  WHERE c.bl_id = ANY(p_granite_bl_ids)
    AND COALESCE(c.subtotal, 0) > 0;

  UPDATE public.granite_bls
  SET charge_status = 'invoiced'
  WHERE id = ANY(p_granite_bl_ids);

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
  )
  VALUES (
    'invoice',
    v_invoice_id::TEXT,
    'create_granite_invoice',
    NULL,
    CONCAT('invoice=', v_invoice_number, ' | granite_bl_count=', v_bl_count, ' | total=', v_total_brl),
    v_actor,
    now(),
    'Emissao de invoice de Granito'
  );

  RETURN jsonb_build_object(
    'invoice_id',     v_invoice_id,
    'invoice_number', v_invoice_number,
    'total_brl',      v_total_brl::TEXT,
    'bl_count',       v_bl_count
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_invoice(
  p_invoice_id BIGINT,
  p_reason TEXT,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
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

  UPDATE public.granite_bls AS gb
  SET charge_status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.invoice_granite_bls AS igb2
      JOIN public.invoices AS inv2 ON inv2.id = igb2.invoice_id
      WHERE igb2.granite_bl_id = gb.id
        AND inv2.id <> p_invoice_id
        AND COALESCE(inv2.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue', 'paid')
    ) THEN 'invoiced'
    ELSE 'ready_for_billing'
  END
  WHERE gb.id IN (
    SELECT igb.granite_bl_id
    FROM public.invoice_granite_bls AS igb
    WHERE igb.invoice_id = p_invoice_id
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
    v_actor,
    now(),
    COALESCE(NULLIF(TRIM(COALESCE(p_reason, '')), ''), 'Cancelamento de invoice')
  );

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'cancelled', 'changed', true);
END;
$function$;
