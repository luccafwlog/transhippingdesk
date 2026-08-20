-- 312: COD reprecifica a Taxa Local pelo destino final (ADR 0051).
--
-- O ledger registra a decisão financeira no grão B/L × omissão. A emissão de
-- documentos e a liberação de restituições pertencem à Task 7 e não ocorrem
-- nesta transação.
--
-- Rollback: em ambiente descartável, DROP FUNCTION
-- public.apply_cod_financial_effect(TEXT, BIGINT, TEXT) e DROP TABLE
-- public.cod_adjustments. Nenhum backfill é necessário: não havia CODs antes
-- desta migration.

CREATE TABLE public.cod_adjustments (
  id BIGSERIAL PRIMARY KEY,
  bl_id TEXT NOT NULL REFERENCES public.bls(id) ON DELETE RESTRICT,
  omission_id BIGINT NOT NULL REFERENCES public.voyage_omissions(id) ON DELETE RESTRICT,
  original_value_brl NUMERIC(14,2) NOT NULL DEFAULT 0,
  new_destination_value_brl NUMERIC(14,2) NOT NULL DEFAULT 0,
  difference_brl NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_amount_brl NUMERIC(14,2) NOT NULL DEFAULT 0,
  outstanding_balance_brl NUMERIC(14,2) NOT NULL DEFAULT 0,
  offset_amount_brl NUMERIC(14,2) NOT NULL DEFAULT 0,
  refund_amount_brl NUMERIC(14,2) NOT NULL DEFAULT 0,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  manual_review_required BOOLEAN NOT NULL DEFAULT false,
  resulting_document_id BIGINT REFERENCES public.invoices(id) ON DELETE SET NULL,
  resulting_document_type TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cod_adjustments_bl_omission_key UNIQUE (bl_id, omission_id),
  CONSTRAINT cod_adjustments_values_non_negative CHECK (
    original_value_brl >= 0
    AND new_destination_value_brl >= 0
    AND paid_amount_brl >= 0
    AND outstanding_balance_brl >= 0
    AND offset_amount_brl >= 0
    AND refund_amount_brl >= 0
  ),
  CONSTRAINT cod_adjustments_difference_check CHECK (
    difference_brl = ROUND(new_destination_value_brl - original_value_brl, 2)
  ),
  CONSTRAINT cod_adjustments_action_check CHECK (
    action IN (
      'complementary_invoice',
      'cancel_and_reissue',
      'manual_charge_review',
      'offset_open_balance',
      'refund_overpayment'
    )
  ),
  CONSTRAINT cod_adjustments_status_check CHECK (status IN ('pending', 'settled', 'cancelled')),
  CONSTRAINT cod_adjustments_document_type_check CHECK (
    resulting_document_type IS NULL OR resulting_document_type IN ('invoice', 'refund')
  )
);

CREATE INDEX cod_adjustments_bl_idx ON public.cod_adjustments(bl_id);
CREATE INDEX cod_adjustments_omission_idx ON public.cod_adjustments(omission_id);
CREATE INDEX cod_adjustments_pending_idx
  ON public.cod_adjustments(status, created_at DESC)
  WHERE status = 'pending';

ALTER TABLE public.cod_adjustments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cod_adjustments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.cod_adjustments TO authenticated;

DROP POLICY IF EXISTS cod_adjustments_select_active ON public.cod_adjustments;
CREATE POLICY cod_adjustments_select_active
  ON public.cod_adjustments
  FOR SELECT
  TO authenticated
  USING (public.is_active_user());

CREATE OR REPLACE FUNCTION public.apply_cod_financial_effect(
  p_bl_id TEXT,
  p_omission_id BIGINT,
  p_previous_pod TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_bl RECORD;
  v_original_total NUMERIC(14,2) := 0;
  v_new_total NUMERIC(14,2) := 0;
  v_manual_total NUMERIC(14,2) := 0;
  v_paid_amount NUMERIC(14,2) := 0;
  v_outstanding NUMERIC(14,2) := 0;
  v_difference NUMERIC(14,2) := 0;
  v_offset_amount NUMERIC(14,2) := 0;
  v_refund_amount NUMERIC(14,2) := 0;
  v_action TEXT;
  v_manual_review BOOLEAN := false;
  v_has_manual_lines BOOLEAN := false;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT b.id, b.pod, b.financial_status
  INTO v_bl
  FROM public.bls AS b
  WHERE b.id = p_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  SELECT
    COALESCE(SUM(COALESCE(cc.total_value_brl, 0)), 0),
    BOOL_OR(COALESCE(cc.source, 'auto') = 'manual')
  INTO v_original_total, v_has_manual_lines
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = p_bl_id;

  v_original_total := ROUND(COALESCE(v_original_total, 0), 2);
  v_has_manual_lines := COALESCE(v_has_manual_lines, false);

  SELECT COALESCE(SUM(COALESCE(cc.total_value_brl, 0)), 0)
  INTO v_manual_total
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = p_bl_id
    AND COALESCE(cc.source, 'auto') = 'manual';
  v_manual_total := ROUND(COALESCE(v_manual_total, 0), 2);

  -- Pending/non-invoiced B/Ls use the existing writing calculator. Manual
  -- rows are source = manual, so calculate_bl_local_charges deletes only auto
  -- rows and preserves their operator-entered intent.
  IF COALESCE(v_bl.financial_status, 'pending') NOT IN ('invoiced', 'partially_paid', 'paid') THEN
    PERFORM public.calculate_bl_local_charges(
      p_bl_id => p_bl_id,
      p_actor => v_actor,
      p_recalculate => true
    );

    IF v_has_manual_lines THEN
      SELECT COALESCE(SUM(COALESCE(cc.total_value_brl, 0)), 0)
      INTO v_new_total
      FROM public.charge_calculations AS cc
      WHERE cc.bl_id = p_bl_id;
      v_new_total := ROUND(COALESCE(v_new_total, 0), 2);
      v_difference := ROUND(v_new_total - v_original_total, 2);
      v_action := 'manual_charge_review';
      v_manual_review := true;
    ELSE
      RETURN;
    END IF;
  ELSE
    -- Billed states must never call the writing calculator: it intentionally
    -- rejects these states. The 311 helper is the single price-resolution
    -- source for both the previous and already-updated destination PODs.
    SELECT COALESCE(SUM(COALESCE(item.total_value_brl, 0)), 0)
    INTO v_original_total
    FROM public.resolve_bl_local_charge_items(p_bl_id, p_previous_pod) AS item;

    SELECT COALESCE(SUM(COALESCE(item.total_value_brl, 0)), 0)
    INTO v_new_total
    FROM public.resolve_bl_local_charge_items(p_bl_id, v_bl.pod) AS item;
    v_new_total := ROUND(COALESCE(v_new_total, 0) + v_manual_total, 2);
    v_original_total := ROUND(COALESCE(v_original_total, 0) + v_manual_total, 2);

    SELECT COALESCE(SUM(
      CASE
        WHEN ib.invoice_id IS NOT NULL
          AND COALESCE(i.total_brl, 0) > 0
          AND EXISTS (
            SELECT 1
            FROM public.invoice_bls AS ib_other
            WHERE ib_other.invoice_id = i.id
              AND ib_other.bl_id <> p_bl_id
          )
        THEN p.amount_brl * COALESCE(ib.subtotal_brl, 0) / i.total_brl
        ELSE p.amount_brl
      END
    ), 0)
    INTO v_paid_amount
    FROM public.payments AS p
    JOIN public.invoices AS i ON i.id = p.invoice_id
    LEFT JOIN public.invoice_bls AS ib
      ON ib.invoice_id = i.id AND ib.bl_id = p_bl_id
    WHERE COALESCE(i.status, 'issued') <> 'cancelled'
      AND (i.bl_id = p_bl_id OR ib.bl_id = p_bl_id);
    v_paid_amount := ROUND(GREATEST(COALESCE(v_paid_amount, 0), 0), 2);
    IF v_paid_amount = 0 THEN
      SELECT COALESCE(SUM(COALESCE(i.total_paid_brl, 0)), 0)
      INTO v_paid_amount
      FROM public.invoices AS i
      WHERE i.bl_id = p_bl_id
        AND COALESCE(i.status, 'issued') <> 'cancelled';
      v_paid_amount := ROUND(GREATEST(COALESCE(v_paid_amount, 0), 0), 2);
    END IF;
    v_outstanding := ROUND(GREATEST(v_original_total - v_paid_amount, 0), 2);
    v_difference := ROUND(v_new_total - v_original_total, 2);

    -- An unpaid invoice is the only cancel/reissue branch. A B/L remains
    -- financial_status = invoiced while its invoice is partially paid, so
    -- payment money—not only the coarse B/L status—selects the next branch.
    IF v_paid_amount = 0 THEN
      v_action := 'cancel_and_reissue';
      v_manual_review := true;
    ELSIF v_difference > 0 THEN
      v_action := 'complementary_invoice';
    ELSIF v_difference < 0 THEN
      v_offset_amount := ROUND(LEAST(ABS(v_difference), v_outstanding), 2);
      v_refund_amount := ROUND(GREATEST(ABS(v_difference) - v_outstanding, 0), 2);
      v_action := CASE
        WHEN v_refund_amount > 0 THEN 'refund_overpayment'
        ELSE 'offset_open_balance'
      END;
    ELSE
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.cod_adjustments (
    bl_id,
    omission_id,
    original_value_brl,
    new_destination_value_brl,
    difference_brl,
    paid_amount_brl,
    outstanding_balance_brl,
    offset_amount_brl,
    refund_amount_brl,
    action,
    status,
    manual_review_required,
    resulting_document_id,
    resulting_document_type,
    created_by
  )
  VALUES (
    p_bl_id,
    p_omission_id,
    ROUND(v_original_total, 2),
    ROUND(v_new_total, 2),
    ROUND(v_difference, 2),
    ROUND(v_paid_amount, 2),
    ROUND(v_outstanding, 2),
    ROUND(v_offset_amount, 2),
    ROUND(v_refund_amount, 2),
    v_action,
    'pending',
    v_manual_review,
    NULL,
    NULL,
    v_actor
  )
  ON CONFLICT (bl_id, omission_id)
  DO UPDATE SET
    original_value_brl = EXCLUDED.original_value_brl,
    new_destination_value_brl = EXCLUDED.new_destination_value_brl,
    difference_brl = EXCLUDED.difference_brl,
    paid_amount_brl = EXCLUDED.paid_amount_brl,
    outstanding_balance_brl = EXCLUDED.outstanding_balance_brl,
    offset_amount_brl = EXCLUDED.offset_amount_brl,
    refund_amount_brl = EXCLUDED.refund_amount_brl,
    action = EXCLUDED.action,
    status = 'pending',
    manual_review_required = EXCLUDED.manual_review_required,
    resulting_document_id = NULL,
    resulting_document_type = NULL,
    created_by = EXCLUDED.created_by,
    created_at = now();
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_cod_financial_effect(TEXT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
