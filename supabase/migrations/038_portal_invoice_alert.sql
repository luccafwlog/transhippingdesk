-- Migration 038: Alerta automático quando cliente cria fatura via portal
-- Modifica portal_create_consolidation para inserir alerta na tabela alerts
-- após emissão bem-sucedida de fatura.

CREATE OR REPLACE FUNCTION public.portal_create_consolidation(
  p_session_token TEXT,
  p_bl_ids TEXT[],
  p_due_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session RECORD;
  v_result JSONB;
  v_customer_name TEXT;
  v_invoice_id TEXT;
  v_invoice_number TEXT;
  v_total_brl TEXT;
  v_bl_count INT;
BEGIN
  SELECT *
  INTO v_session
  FROM public.resolve_customer_portal_session(p_session_token)
  LIMIT 1;

  v_result := public.create_invoice_from_bls_core(
    p_bl_ids,
    v_session.customer_id,
    p_due_date,
    p_notes,
    true,
    NULL,
    'portal',
    v_session.account_id
  );

  -- Busca nome do cliente para a mensagem do alerta
  SELECT name INTO v_customer_name
  FROM public.customers
  WHERE id = v_session.customer_id
  LIMIT 1;

  v_invoice_id     := v_result->>'invoice_id';
  v_invoice_number := COALESCE(v_result->>'invoice_number', 'fatura');
  v_total_brl      := COALESCE(v_result->>'total_brl', '0');
  v_bl_count       := array_length(p_bl_ids, 1);

  -- Insere alerta para que operadores internos sejam notificados
  INSERT INTO public.alerts (type, entity_type, entity_id, message, status, created_at)
  VALUES (
    'portal_invoice_created',
    'invoices',
    v_invoice_id,
    'Cliente ' || COALESCE(v_customer_name, 'desconhecido') ||
    ' criou fatura ' || v_invoice_number ||
    ' com ' || v_bl_count::TEXT || ' B/L(s) via portal — R$ ' || v_total_brl,
    'open',
    now()
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_create_consolidation(TEXT, TEXT[], DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_create_consolidation(TEXT, TEXT[], DATE, TEXT) TO anon, authenticated;
