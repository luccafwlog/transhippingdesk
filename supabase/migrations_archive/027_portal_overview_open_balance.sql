-- Make portal overview derive the pending balance from open invoices instead of
-- relying on customers.pending_balance, which may be stale.

CREATE OR REPLACE FUNCTION public.portal_get_session_overview(p_session_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session RECORD;
  v_customer RECORD;
  v_pending_balance NUMERIC(14,2);
BEGIN
  SELECT *
  INTO v_session
  FROM public.resolve_customer_portal_session(p_session_token)
  LIMIT 1;

  SELECT id, name, cnpj_cpf, pending_balance
  INTO v_customer
  FROM public.customers
  WHERE id = v_session.customer_id;

  SELECT COALESCE(SUM(COALESCE(i.balance_brl, 0)), 0)
  INTO v_pending_balance
  FROM public.invoices AS i
  WHERE i.customer_id = v_session.customer_id
    AND COALESCE(i.status, 'issued') IN ('issued', 'partially_paid', 'overdue');

  RETURN jsonb_build_object(
    'customer_id', v_customer.id,
    'customer_name', v_customer.name,
    'customer_cnpj_cpf', v_customer.cnpj_cpf,
    'pending_balance', v_pending_balance,
    'contact_email', v_session.contact_email
  );
END;
$$;

REVOKE ALL ON FUNCTION public.portal_get_session_overview(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_get_session_overview(TEXT) TO anon, authenticated;
