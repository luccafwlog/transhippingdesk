-- Permite ao administrador ajustar o vencimento de uma invoice aberta.
-- O detector existente continua sendo a única rotina que transiciona o status
-- para overdue, mantendo a regra de vencimento centralizada.

CREATE OR REPLACE FUNCTION public.update_invoice_due_date(
  p_invoice_id BIGINT,
  p_due_date DATE,
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
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  IF p_due_date IS NULL THEN
    RAISE EXCEPTION 'Data de vencimento obrigatoria.' USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT id, status, due_date
  INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') NOT IN ('draft', 'issued', 'partially_paid', 'overdue') THEN
    RAISE EXCEPTION 'Somente invoices em aberto podem ter vencimento alterado.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices
  SET due_date = p_due_date,
      updated_at = now()
  WHERE id = p_invoice_id;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES (
    'invoice',
    p_invoice_id::text,
    'due_date',
    v_invoice.due_date::text,
    p_due_date::text,
    v_actor,
    now(),
    'Vencimento atualizado pela tela de faturamento'
  );

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'due_date', p_due_date);
END;
$$;

REVOKE ALL ON FUNCTION public.update_invoice_due_date(BIGINT, DATE, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_invoice_due_date(BIGINT, DATE, UUID) TO authenticated;
