-- Fluxo de baixa da restituicao: listar restituicoes de uma fatura e marcar
-- uma restituicao pendente como efetuada (pending -> settled).
--
-- Rollback: DROP FUNCTION public.settle_invoice_refund(BIGINT, UUID);
--           DROP FUNCTION public.list_invoice_refunds(BIGINT);

-- Lista as restituicoes de uma fatura (pendentes e ja efetuadas).
-- SECURITY INVOKER: respeita a RLS admin de invoice_refunds.
CREATE OR REPLACE FUNCTION public.list_invoice_refunds(p_invoice_id BIGINT)
RETURNS TABLE (
  id BIGINT,
  amount_brl NUMERIC,
  status TEXT,
  created_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  notes TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT r.id, r.amount_brl, r.status, r.created_at, r.settled_at, r.notes
  FROM public.invoice_refunds r
  WHERE r.invoice_id = p_invoice_id
  ORDER BY r.created_at DESC, r.id DESC;
$$;

REVOKE ALL ON FUNCTION public.list_invoice_refunds(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_invoice_refunds(BIGINT) TO authenticated;

-- Marca uma restituicao pendente como efetuada (devolvida ao cliente).
CREATE OR REPLACE FUNCTION public.settle_invoice_refund(
  p_refund_id BIGINT,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_refund RECORD;
  v_actor UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT * INTO v_refund
  FROM public.invoice_refunds
  WHERE id = p_refund_id
  FOR UPDATE;

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

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES (
    'invoice_refund', p_refund_id::TEXT, 'status', 'pending', 'settled', v_actor, now(),
    'Restituicao marcada como efetuada'
  );

  RETURN jsonb_build_object('refund_id', p_refund_id, 'invoice_id', v_refund.invoice_id, 'status', 'settled');
END;
$$;

REVOKE ALL ON FUNCTION public.settle_invoice_refund(BIGINT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_invoice_refund(BIGINT, UUID) TO authenticated;
