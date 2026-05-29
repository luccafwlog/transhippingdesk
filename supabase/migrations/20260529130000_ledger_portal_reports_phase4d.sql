-- Phase 4d: portal local-charge balances from bl_receivables.
-- Invoices remain documents; the B/L receivable is the balance source of truth.

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

  SELECT COALESCE(SUM(COALESCE(br.balance_brl, 0)), 0)
  INTO v_pending_balance
  FROM public.bl_receivables AS br
  WHERE br.customer_id = v_session.customer_id
    AND br.source = 'local_charges'
    AND br.status IN ('open', 'partially_settled')
    AND br.balance_brl > 0;

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

CREATE OR REPLACE FUNCTION public.portal_get_session_overview_v2()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account RECORD;
  v_customer RECORD;
  v_pending_balance NUMERIC(14,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  SELECT a.id, a.customer_id, a.active, a.contact_email
  INTO v_account
  FROM public.customer_portal_accounts AS a
  WHERE a.auth_user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  IF NOT v_account.active THEN
    RAISE EXCEPTION 'Acesso ao portal desativado. Entre em contato com o suporte.' USING ERRCODE = '28000';
  END IF;

  SELECT c.id, c.name, c.cnpj_cpf, c.pending_balance
  INTO v_customer
  FROM public.customers AS c
  WHERE c.id = v_account.customer_id;

  SELECT COALESCE(SUM(COALESCE(br.balance_brl, 0)), 0)
  INTO v_pending_balance
  FROM public.bl_receivables AS br
  WHERE br.customer_id = v_account.customer_id
    AND br.source = 'local_charges'
    AND br.status IN ('open', 'partially_settled')
    AND br.balance_brl > 0;

  UPDATE public.customer_portal_accounts
  SET last_login_at = now()
  WHERE id = v_account.id;

  RETURN jsonb_build_object(
    'customer_id', v_customer.id,
    'customer_name', v_customer.name,
    'customer_cnpj_cpf', v_customer.cnpj_cpf,
    'cnpj_cpf', v_customer.cnpj_cpf,
    'pending_balance', v_pending_balance,
    'contact_email', v_account.contact_email,
    'account_id', v_account.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.portal_get_session_overview_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_get_session_overview_v2() TO authenticated;

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
    COALESCE(br.balance_brl, 0) AS subtotal_brl
  FROM session_row
  JOIN public.bl_receivables AS br
    ON br.customer_id = session_row.customer_id
   AND br.source = 'local_charges'
   AND br.status IN ('open', 'partially_settled')
   AND br.balance_brl > 0
  JOIN public.bls AS b
    ON b.id = br.bl_id
   AND b.customer_id = session_row.customer_id
   AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('matched_document', 'reconciled')
  WHERE COALESCE(b.charge_status, 'not_calculated') = 'ready_for_billing'
    AND COALESCE(b.financial_status, 'pending') = 'pending'
    AND NOT EXISTS (
      SELECT 1
      FROM public.invoice_bls AS ib
      JOIN public.invoices AS inv ON inv.id = ib.invoice_id
      WHERE ib.bl_id = b.id
        AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
    )
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
    CASE
      WHEN i.invoice_type IN ('individual', 'consolidated') AND ledger.link_count > 0
        THEN ledger.active_balance_brl
      ELSE i.balance_brl
    END AS balance_brl,
    i.status
  FROM session_row
  JOIN public.invoices AS i ON i.customer_id = session_row.customer_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS link_count,
      COALESCE(SUM(
        CASE
          WHEN irl.status = 'active'
           AND COALESCE(i.status, 'issued') IN ('issued', 'partially_paid', 'overdue')
            THEN COALESCE(br.balance_brl, 0)
          ELSE 0
        END
      ), 0) AS active_balance_brl
    FROM public.invoice_receivable_links AS irl
    JOIN public.bl_receivables AS br ON br.id = irl.receivable_id
    WHERE irl.invoice_id = i.id
  ) AS ledger ON true
  ORDER BY i.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.portal_list_invoices(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_list_invoices(TEXT) TO anon, authenticated;
