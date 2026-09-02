-- Renumbered from 20260615000004 (original timestamped migration: 20260615000004_portal_fase3_rate_limiting.sql).
-- FASE 3D: Rate limiting para ações do portal do cliente
--
-- Limita requisições do cliente em ações sensíveis:
--   - Criação de fatura consolidada
--   - Undo de consolidação
--   - Abertura de disputa
--
-- Cada customer_id + action_name tem um limite de tentativas por janela.

-- ============================================================================
-- 1. Tabela portal_rate_limits
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.portal_rate_limits (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  action_name TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_rate_limits_lookup
  ON public.portal_rate_limits (customer_id, action_name, attempted_at DESC);

-- ============================================================================
-- 2. Helper: check_portal_rate_limit
--    Retorna true se dentro do limite, raise exception se excedido.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_portal_rate_limit(
  p_action_name TEXT,
  p_max_attempts INT DEFAULT 5,
  p_window_minutes INT DEFAULT 5
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_cutoff TIMESTAMPTZ := now() - (p_window_minutes * INTERVAL '1 minute');
  v_count INT;
BEGIN
  -- Limpa entradas antigas
  DELETE FROM public.portal_rate_limits
  WHERE customer_id = v_customer_id
    AND action_name = p_action_name
    AND attempted_at < v_cutoff;

  -- Conta tentativas na janela
  SELECT COUNT(*) INTO v_count
  FROM public.portal_rate_limits
  WHERE customer_id = v_customer_id
    AND action_name = p_action_name
    AND attempted_at >= v_cutoff;

  IF v_count >= p_max_attempts THEN
    RAISE EXCEPTION 'Limite de tentativas excedido para esta acao. Aguarde % minuto(s) antes de tentar novamente.', p_window_minutes
      USING ERRCODE = 'P0429';
  END IF;

  -- Registra tentativa
  INSERT INTO public.portal_rate_limits (customer_id, action_name)
  VALUES (v_customer_id, p_action_name);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.check_portal_rate_limit(TEXT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_portal_rate_limit(TEXT, INT, INT) TO authenticated;

-- ============================================================================
-- 3. Atualizar portal_create_consolidation com rate limit
--    Limite: 3 consolidações a cada 10 minutos
-- ============================================================================

CREATE OR REPLACE FUNCTION public.portal_create_consolidation(p_receivable_ids BIGINT[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_invoice_id BIGINT;
BEGIN
  PERFORM public.check_portal_rate_limit('create_consolidation', 3, 10);

  SELECT public.create_local_consolidated_invoice_core(
    v_customer_id,
    p_receivable_ids,
    auth.uid(),
    'portal'
  ) INTO v_invoice_id;

  INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
  VALUES (
    'portal_invoice_created',
    'invoice',
    v_invoice_id::text,
    'Cliente gerou fatura consolidada #' || v_invoice_id || ' com ' || array_length(p_receivable_ids, 1) || ' B/L(s).',
    'open'
  );

  INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
  VALUES (
    v_customer_id,
    'system',
    'Fatura consolidada criada',
    'Sua fatura consolidada foi gerada com ' || array_length(p_receivable_ids, 1) || ' B/L(s).',
    '/portal/billing'
  );

  RETURN jsonb_build_object('invoice_id', v_invoice_id);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_create_consolidation(BIGINT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_create_consolidation(BIGINT[]) TO authenticated;

-- ============================================================================
-- 4. Atualizar portal_obsolete_consolidation com rate limit
--    Limite: 3 undo a cada 15 minutos
-- ============================================================================

CREATE OR REPLACE FUNCTION public.portal_obsolete_consolidation(p_invoice_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_invoice RECORD;
BEGIN
  PERFORM public.check_portal_rate_limit('obsolete_consolidation', 3, 15);

  SELECT i.id, i.status, i.invoice_type, i.customer_id, i.invoice_number
  INTO v_invoice
  FROM public.invoices AS i
  WHERE i.id = p_invoice_id
    AND i.customer_id = v_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fatura nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice.invoice_type != 'consolidated' THEN
    RAISE EXCEPTION 'Esta fatura nao e uma consolidada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice.status IN ('paid', 'covered', 'cancelled', 'obsolete') THEN
    RAISE EXCEPTION 'Esta fatura ja foi paga ou cancelada e nao pode ser desfeita.' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'Fatura com pagamento registrado nao pode ser desfeita.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event, payload)
  VALUES (p_invoice_id, 'obsoleted_by_customer', jsonb_build_object('customer_id', v_customer_id));

  UPDATE public.invoices
  SET status = 'obsolete',
      obsolete_reason = 'Desfeita pelo cliente pelo portal.',
      updated_at = now()
  WHERE id = p_invoice_id;

  UPDATE public.invoice_receivable_links
  SET status = 'cancelled'
  WHERE invoice_id = p_invoice_id;

  INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
  VALUES (
    'portal_consolidation_obsoleted',
    'invoice',
    p_invoice_id::text,
    'Cliente desfez a fatura consolidada ' || COALESCE(v_invoice.invoice_number, '#' || p_invoice_id) || '. B/Ls liberados para nova consolidacao.',
    'open'
  );

  INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
  VALUES (
    v_customer_id,
    'system',
    'Consolidacao desfeita',
    'A fatura ' || COALESCE(v_invoice.invoice_number, '#' || p_invoice_id) || ' foi desfeita. Os B/Ls estao disponiveis para nova consolidacao.',
    '/portal/billing'
  );

  RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_obsolete_consolidation(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_obsolete_consolidation(BIGINT) TO authenticated;

-- ============================================================================
-- 5. Atualizar portal_open_demurrage_dispute com rate limit
--    Limite: 3 disputas a cada 30 minutos
-- ============================================================================

CREATE OR REPLACE FUNCTION public.portal_open_demurrage_dispute(
  p_demurrage_invoice_id BIGINT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_invoice RECORD;
BEGIN
  PERFORM public.check_portal_rate_limit('open_dispute', 3, 30);

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Informe o motivo da disputa.' USING ERRCODE = '22023';
  END IF;

  SELECT id, doc_number, customer_id, dispute_open, dispute_status
  INTO v_invoice
  FROM public.demurrage_invoices
  WHERE id = p_demurrage_invoice_id
    AND customer_id = v_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fatura de demurrage nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice.dispute_open THEN
    RAISE EXCEPTION 'Esta fatura ja possui uma disputa em aberto.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.demurrage_invoices
  SET
    dispute_open = true,
    dispute_reason = trim(p_reason),
    dispute_status = 'aberto',
    dispute_notes = COALESCE(dispute_notes, '') || CASE WHEN dispute_notes IS NOT NULL THEN E'\n' ELSE '' END || '[Portal] ' || trim(p_reason)
  WHERE id = p_demurrage_invoice_id;

  INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
  VALUES (
    v_customer_id,
    'dispute_opened',
    'Disputa registrada',
    'Sua disputa para a fatura ' || v_invoice.doc_number || ' foi registrada. Acompanhe o retorno.',
    '/portal/billing'
  );

  INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
  VALUES (
    'portal_dispute_opened',
    'demurrage_invoice',
    p_demurrage_invoice_id::text,
    'Cliente abriu disputa na fatura de demurrage ' || v_invoice.doc_number || '. Motivo: ' || trim(p_reason),
    'open'
  );

  RETURN jsonb_build_object('success', true, 'demurrage_invoice_id', p_demurrage_invoice_id);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_open_demurrage_dispute(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_open_demurrage_dispute(BIGINT, TEXT) TO authenticated;
