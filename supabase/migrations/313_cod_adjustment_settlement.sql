-- 313: liquidação deliberada dos ajustes de COD.
--
-- O COD (312) só calcula e registra a pendência. Esta migration abre a fila
-- para Financeiro/Admin/Administrativo e reaproveita invoice_refunds para o
-- crédito ao cliente. Nenhum documento complementar, cancelamento ou
-- restituição é emitido automaticamente pelo COD.

ALTER TABLE public.invoice_refunds
  ALTER COLUMN payment_id DROP NOT NULL;

ALTER TABLE public.invoice_refunds
  ADD COLUMN IF NOT EXISTS cod_adjustment_id BIGINT
    REFERENCES public.cod_adjustments(id) ON DELETE RESTRICT;

ALTER TABLE public.invoice_refunds
  DROP CONSTRAINT IF EXISTS invoice_refunds_origin_check;

ALTER TABLE public.invoice_refunds
  ADD CONSTRAINT invoice_refunds_origin_check
  CHECK ((payment_id IS NULL) <> (cod_adjustment_id IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS invoice_refunds_cod_adjustment_key
  ON public.invoice_refunds(cod_adjustment_id)
  WHERE cod_adjustment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.is_financeiro_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE id = auth.uid()
      AND active = true
      AND role IN ('admin', 'administrativo', 'financeiro')
  );
$$;

REVOKE ALL ON FUNCTION public.is_financeiro_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_financeiro_user() TO authenticated;

-- A leitura precisa acompanhar o gate: Financeiro deve enxergar a fila que
-- pode liquidar. Exclusão continua sendo uma operação administrativa de
-- manutenção e não é aberta ao papel Financeiro.
DROP POLICY IF EXISTS invoice_refunds_select_admin ON public.invoice_refunds;
DROP POLICY IF EXISTS invoice_refunds_insert_admin ON public.invoice_refunds;
DROP POLICY IF EXISTS invoice_refunds_update_admin ON public.invoice_refunds;
DROP POLICY IF EXISTS invoice_refunds_select_financeiro ON public.invoice_refunds;
DROP POLICY IF EXISTS invoice_refunds_insert_financeiro ON public.invoice_refunds;
DROP POLICY IF EXISTS invoice_refunds_update_financeiro ON public.invoice_refunds;

CREATE POLICY invoice_refunds_select_financeiro
  ON public.invoice_refunds FOR SELECT
  TO authenticated USING (public.is_financeiro_user());

CREATE POLICY invoice_refunds_insert_financeiro
  ON public.invoice_refunds FOR INSERT
  TO authenticated WITH CHECK (public.is_financeiro_user());

CREATE POLICY invoice_refunds_update_financeiro
  ON public.invoice_refunds FOR UPDATE
  TO authenticated USING (public.is_financeiro_user())
  WITH CHECK (public.is_financeiro_user());

-- Lista também a origem para que a UI diferencie excedente de pagamento de
-- crédito produzido por COD, sem criar uma segunda fila de restituições.
DROP FUNCTION IF EXISTS public.list_invoice_refunds(BIGINT);
CREATE OR REPLACE FUNCTION public.list_invoice_refunds(p_invoice_id BIGINT)
RETURNS TABLE (
  id BIGINT,
  amount_brl NUMERIC,
  status TEXT,
  created_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  notes TEXT,
  payment_id BIGINT,
  cod_adjustment_id BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT r.id, r.amount_brl, r.status, r.created_at, r.settled_at,
    r.notes, r.payment_id, r.cod_adjustment_id
  FROM public.invoice_refunds AS r
  WHERE r.invoice_id = p_invoice_id
  ORDER BY r.created_at DESC, r.id DESC;
$$;

REVOKE ALL ON FUNCTION public.list_invoice_refunds(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_invoice_refunds(BIGINT) TO authenticated;

-- Abate o saldo do recebível sem registrar dinheiro recebido. Em faturas
-- antigas sem ledger, o fallback mantém os totais compatíveis com a UI.
CREATE OR REPLACE FUNCTION public.apply_cod_open_balance_offset(
  p_invoice_id BIGINT,
  p_bl_id TEXT,
  p_amount NUMERIC,
  p_actor UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_remaining NUMERIC(14,2) := ROUND(GREATEST(COALESCE(p_amount, 0), 0), 2);
  v_applied NUMERIC(14,2) := 0;
  v_amount NUMERIC(14,2);
  v_link RECORD;
BEGIN
  IF v_remaining <= 0 THEN
    RETURN 0;
  END IF;

  FOR v_link IN
    SELECT br.id, br.balance_brl, br.original_amount_brl, br.settled_amount_brl
    FROM public.invoice_receivable_links AS irl
    JOIN public.bl_receivables AS br ON br.id = irl.receivable_id
    WHERE irl.invoice_id = p_invoice_id
      AND irl.bl_id = p_bl_id
      AND irl.status IN ('active', 'settled_by_this_invoice')
      AND br.balance_brl > 0
    ORDER BY br.id
    FOR UPDATE OF br
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_amount := ROUND(LEAST(v_remaining, COALESCE(v_link.balance_brl, 0)), 2);
    IF v_amount <= 0 THEN CONTINUE; END IF;

    UPDATE public.bl_receivables
    SET balance_brl = GREATEST(balance_brl - v_amount, 0),
        status = CASE WHEN GREATEST(balance_brl - v_amount, 0) <= 0.01
          THEN 'settled' ELSE 'partially_settled' END,
        updated_at = now()
    WHERE id = v_link.id;

    v_remaining := ROUND(v_remaining - v_amount, 2);
    v_applied := ROUND(v_applied + v_amount, 2);
  END LOOP;

  -- Faturas legadas podem não ter receivable vinculado; ainda assim a
  -- liquidação deve reduzir o saldo visível do documento.
  IF v_remaining > 0 THEN
    v_applied := ROUND(v_applied + v_remaining, 2);
  END IF;

  UPDATE public.invoices AS i
  -- O total bruto continua sendo o documento emitido; o crédito de COD só
  -- reduz o saldo a cobrar. A diferença fica auditada em cod_adjustments.
  SET balance_brl = GREATEST(COALESCE(i.balance_brl, i.total_brl) - v_applied, 0),
      status = CASE
        WHEN GREATEST(COALESCE(i.balance_brl, i.total_brl) - v_applied, 0) <= 0.01
          THEN 'paid'
        WHEN i.status = 'paid' THEN 'partially_paid'
        ELSE i.status
      END
  WHERE i.id = p_invoice_id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by,
    changed_at, justification
  ) VALUES (
    'invoice', p_invoice_id::TEXT, 'cod_offset', NULL, v_applied::TEXT,
    p_actor, now(), 'Abatimento de saldo aberto por ajuste de COD'
  );

  RETURN v_applied;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_cod_open_balance_offset(BIGINT, TEXT, NUMERIC, UUID)
  FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.settle_cod_adjustment(BIGINT, UUID);

CREATE OR REPLACE FUNCTION public.settle_cod_adjustment(
  p_adjustment_id BIGINT,
  p_actor UUID DEFAULT NULL,
  p_resulting_document_id BIGINT DEFAULT NULL,
  p_resulting_document_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_adjustment RECORD;
  v_actor UUID := COALESCE(p_actor, auth.uid());
  v_invoice_id BIGINT;
  v_offset NUMERIC(14,2) := 0;
  v_refund_id BIGINT;
  v_document_type TEXT := NULLIF(lower(btrim(COALESCE(p_resulting_document_type, ''))), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Apenas Financeiro, Administrativo ou Admin pode liquidar ajustes de COD.'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NOT NULL AND p_actor <> auth.uid() THEN
    RAISE EXCEPTION 'O ator da liquidação deve ser o usuário autenticado.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_adjustment
  FROM public.cod_adjustments
  WHERE id = p_adjustment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ajuste de COD % nao encontrado.', p_adjustment_id USING ERRCODE = 'P0002';
  END IF;
  IF v_adjustment.status <> 'pending' THEN
    RAISE EXCEPTION 'Ajuste de COD % nao esta pendente (status=%).', p_adjustment_id, v_adjustment.status
      USING ERRCODE = '22023';
  END IF;
  IF v_adjustment.action IN ('complementary_invoice', 'cancel_and_reissue', 'manual_charge_review') THEN
    IF p_resulting_document_id IS NULL OR v_document_type IS DISTINCT FROM 'invoice' THEN
      RAISE EXCEPTION 'A ação % exige o ID de uma invoice emitida para concluir o ajuste.', v_adjustment.action
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_resulting_document_id IS NOT NULL OR v_document_type IS NOT NULL THEN
    RAISE EXCEPTION 'A ação % não aceita vínculo manual de documento.', v_adjustment.action
      USING ERRCODE = '22023';
  END IF;

  SELECT i.id INTO v_invoice_id
  FROM public.invoices AS i
  WHERE i.bl_id = v_adjustment.bl_id
    AND i.status NOT IN ('cancelled', 'obsolete', 'covered')
  ORDER BY i.issued_at DESC NULLS LAST, i.id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_invoice_id IS NULL THEN
    SELECT i.id INTO v_invoice_id
    FROM public.invoices AS i
    JOIN public.invoice_bls AS ib ON ib.invoice_id = i.id
    WHERE ib.bl_id = v_adjustment.bl_id
      AND i.status NOT IN ('cancelled', 'obsolete', 'covered')
    ORDER BY i.issued_at DESC NULLS LAST, i.id DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF p_resulting_document_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.invoices AS resulting
      WHERE resulting.id = p_resulting_document_id
        AND COALESCE(resulting.status, 'issued') NOT IN ('cancelled', 'obsolete', 'covered')
        AND (resulting.bl_id = v_adjustment.bl_id OR EXISTS (
          SELECT 1
          FROM public.invoice_bls AS resulting_link
          WHERE resulting_link.invoice_id = resulting.id
            AND resulting_link.bl_id = v_adjustment.bl_id
        ))
    ) THEN
      RAISE EXCEPTION 'O documento % não pertence ao B/L % ou não está ativo.',
        p_resulting_document_id, v_adjustment.bl_id USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.cod_adjustments AS linked
      WHERE linked.id <> p_adjustment_id
        AND linked.resulting_document_id = p_resulting_document_id
    ) THEN
      RAISE EXCEPTION 'O documento % já está vinculado a outro ajuste de COD.', p_resulting_document_id
        USING ERRCODE = '23505';
    END IF;
  END IF;

  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Nao foi encontrada fatura ativa para o B/L %.', v_adjustment.bl_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_adjustment.offset_amount_brl > 0 THEN
    v_offset := public.apply_cod_open_balance_offset(
      v_invoice_id, v_adjustment.bl_id, v_adjustment.offset_amount_brl, v_actor
    );
  END IF;

  IF v_adjustment.action = 'refund_overpayment' THEN
    IF v_adjustment.refund_amount_brl <= 0 THEN
      RAISE EXCEPTION 'Ajuste de COD sem excedente para restituir.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.invoice_refunds (
      invoice_id, payment_id, cod_adjustment_id, amount_brl, status,
      registered_by, notes
    ) VALUES (
      v_invoice_id, NULL, p_adjustment_id, v_adjustment.refund_amount_brl,
      'pending', v_actor, 'Crédito de COD; abatimento aplicado antes da restituição.'
    )
    RETURNING id INTO v_refund_id;
  END IF;

  UPDATE public.cod_adjustments
  SET status = 'settled',
      resulting_document_id = CASE
        WHEN v_refund_id IS NOT NULL THEN v_refund_id
        WHEN p_resulting_document_id IS NOT NULL THEN p_resulting_document_id
        ELSE v_invoice_id
      END,
      resulting_document_type = CASE
        WHEN v_refund_id IS NOT NULL THEN 'refund'
        WHEN p_resulting_document_type IS NOT NULL THEN v_document_type
        ELSE 'invoice'
      END
  WHERE id = p_adjustment_id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by,
    changed_at, justification
  ) VALUES (
    'cod_adjustment', p_adjustment_id::TEXT, 'status', 'pending', 'settled',
    v_actor, now(), 'Liquidação financeira de ajuste de COD'
  );

  RETURN jsonb_build_object(
    'adjustment_id', p_adjustment_id,
    'invoice_id', v_invoice_id,
    'refund_id', v_refund_id,
    'offset_amount_brl', v_offset,
    'status', 'settled'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_cod_adjustment(BIGINT, UUID, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_cod_adjustment(BIGINT, UUID, BIGINT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.settle_invoice_refund(
  p_refund_id BIGINT,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_refund RECORD;
  v_actor UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Apenas Financeiro, Administrativo ou Admin pode liquidar restituições.'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NOT NULL AND p_actor <> auth.uid() THEN
    RAISE EXCEPTION 'O ator da liquidação deve ser o usuário autenticado.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());
  SELECT * INTO v_refund FROM public.invoice_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restituicao % nao encontrada.', p_refund_id USING ERRCODE = 'P0002';
  END IF;
  IF v_refund.status <> 'pending' THEN
    RAISE EXCEPTION 'Restituicao % nao esta pendente (status=%).', p_refund_id, v_refund.status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoice_refunds
  SET status = 'settled', settled_at = now()
  WHERE id = p_refund_id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by,
    changed_at, justification
  ) VALUES (
    'invoice_refund', p_refund_id::TEXT, 'status', 'pending', 'settled',
    v_actor, now(), 'Restituição marcada como efetuada'
  );

  RETURN jsonb_build_object(
    'refund_id', p_refund_id, 'invoice_id', v_refund.invoice_id, 'status', 'settled'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_invoice_refund(BIGINT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_invoice_refund(BIGINT, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_invoice_pending_refund(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invoice_pending_refund(BIGINT) TO authenticated;
