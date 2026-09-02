-- Renumbered from 20260615000003 (original timestamped migration: 20260615000003_portal_fase2_notifications_disputes_profile.sql).
-- FASE 2A/2B/2D: Notificações, Disputas e Autosserviço de Perfil
--
-- 1. portal_notifications: fila de notificações in-app do cliente
-- 2. Triggers para gerar notificações automaticamente
-- 3. RPCs para disputa de demurrage (cliente abre no portal)
-- 4. RPC para autosserviço de perfil (email, telefone, endereço)

-- ============================================================================
-- 1. Tabela portal_notifications
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.portal_notifications (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('invoice_issued','demurrage_issued','dispute_responded','dispute_opened','system')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_notifications_customer
  ON public.portal_notifications (customer_id, created_at DESC);

-- ============================================================================
-- 2. RPCs de notificações
-- ============================================================================

CREATE OR REPLACE FUNCTION public.portal_list_notifications(
  p_limit INT DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_result JSONB;
BEGIN
  SELECT COALESCE(JSONB_AGG(
    jsonb_build_object(
      'id', n.id,
      'type', n.type,
      'title', n.title,
      'message', n.message,
      'link', n.link,
      'read', n.read_at IS NOT NULL,
      'created_at', n.created_at
    ) ORDER BY n.created_at DESC
  ), '[]'::JSONB)
  INTO v_result
  FROM public.portal_notifications AS n
  WHERE n.customer_id = v_customer_id
  LIMIT p_limit;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_list_notifications(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_list_notifications(INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.portal_notification_unread_count()
RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.portal_notifications AS n
  WHERE n.customer_id = v_customer_id
    AND n.read_at IS NULL;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_notification_unread_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_notification_unread_count() TO authenticated;

CREATE OR REPLACE FUNCTION public.portal_mark_notification_read(p_notification_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
BEGIN
  UPDATE public.portal_notifications AS n
  SET read_at = now()
  WHERE n.id = p_notification_id
    AND n.customer_id = v_customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_mark_notification_read(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_mark_notification_read(BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.portal_mark_all_notifications_read()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
BEGIN
  UPDATE public.portal_notifications AS n
  SET read_at = now()
  WHERE n.customer_id = v_customer_id
    AND n.read_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_mark_all_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_mark_all_notifications_read() TO authenticated;

-- ============================================================================
-- 3. Triggers automáticos para notificações
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_invoice_issued()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.status = 'issued' AND (OLD IS NULL OR OLD.status <> 'issued') THEN
    INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
    VALUES (
      NEW.customer_id,
      'invoice_issued',
      'Nova fatura emitida',
      'Fatura ' || COALESCE(NEW.invoice_number, '#' || NEW.id) || ' no valor de R$ ' || COALESCE(round(NEW.total_brl, 2)::text, '0,00') || ' foi emitida.',
      '/portal/billing'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_demurrage_issued()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.status = 'issued' AND (OLD IS NULL OR OLD.status <> 'issued') THEN
    INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
    VALUES (
      NEW.customer_id,
      'demurrage_issued',
      'Nova fatura de demurrage',
      'Demurrage ' || NEW.doc_number || ' no valor de USD ' || COALESCE(round(NEW.total_usd, 2)::text, '0,00') || ' foi emitida.',
      '/portal/billing'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_dispute_responded()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.dispute_status = 'resolvido' AND (OLD IS NULL OR OLD.dispute_status IS DISTINCT FROM 'resolvido') THEN
    INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
    VALUES (
      NEW.customer_id,
      'dispute_responded',
      'Disputa respondida',
      'A disputa da fatura de demurrage ' || NEW.doc_number || ' foi respondida.',
      '/portal/billing'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_invoice_issued
  AFTER INSERT OR UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.notify_invoice_issued();

CREATE TRIGGER trg_notify_demurrage_issued
  AFTER INSERT OR UPDATE OF status ON public.demurrage_invoices
  FOR EACH ROW EXECUTE FUNCTION public.notify_demurrage_issued();

CREATE TRIGGER trg_notify_dispute_responded
  AFTER UPDATE OF dispute_status ON public.demurrage_invoices
  FOR EACH ROW EXECUTE FUNCTION public.notify_dispute_responded();

-- ============================================================================
-- 4. RPC: portal_open_demurrage_dispute
--    Cliente abre disputa em uma fatura de demurrage via portal.
--    Atualiza as colunas de disputa na demurrage_invoices + gera alerta interno.
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

-- ============================================================================
-- 5. RPC: portal_list_disputes
--    Lista as disputas do cliente (nas faturas de demurrage do cliente).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.portal_list_disputes()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_result JSONB;
BEGIN
  SELECT COALESCE(JSONB_AGG(
    jsonb_build_object(
      'id', d.id,
      'doc_number', d.doc_number,
      'dispute_subject', d.dispute_subject,
      'dispute_reason', d.dispute_reason,
      'dispute_status', d.dispute_status,
      'dispute_open', d.dispute_open,
      'dispute_notes', d.dispute_notes,
      'bl_id', d.bl_id,
      'total_usd', d.total_usd,
      'created_at', d.created_at
    ) ORDER BY d.created_at DESC
  ), '[]'::JSONB)
  INTO v_result
  FROM public.demurrage_invoices AS d
  WHERE d.customer_id = v_customer_id
    AND d.dispute_open = true;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_list_disputes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_list_disputes() TO authenticated;

-- ============================================================================
-- 6. RPC: portal_update_profile
--    Autosserviço: cliente atualiza email de contato, telefone, endereço.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.portal_update_profile(
  p_contact_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_state TEXT DEFAULT NULL,
  p_zip TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_account_id BIGINT;
BEGIN
  -- Atualiza email de contato na conta de portal
  IF p_contact_email IS NOT NULL THEN
    UPDATE public.customer_portal_accounts
    SET contact_email = NULLIF(trim(p_contact_email), ''),
        updated_at = now()
    WHERE customer_id = v_customer_id;
  END IF;

  -- Atualiza endereço no cadastro do cliente
  UPDATE public.customers
  SET
    address = COALESCE(NULLIF(trim(COALESCE(p_address, '')), ''), address),
    city = COALESCE(NULLIF(trim(COALESCE(p_city, '')), ''), city),
    state = COALESCE(NULLIF(trim(COALESCE(p_state, '')), ''), state),
    zip = COALESCE(NULLIF(trim(COALESCE(p_zip, '')), ''), zip),
    updated_at = now()
  WHERE id = v_customer_id;

  -- Telefone: upsert no contato principal (faturamento)
  IF p_phone IS NOT NULL AND trim(p_phone) <> '' THEN
    INSERT INTO public.customer_contacts (customer_id, name, email, phone, purpose, is_primary)
    VALUES (v_customer_id, 'Contato principal', NULL, NULLIF(trim(p_phone), ''), 'faturamento', true)
    ON CONFLICT DO NOTHING;

    -- Se jah existe contato de faturamento, atualiza o telefone
    UPDATE public.customer_contacts
    SET phone = NULLIF(trim(p_phone), '')
    WHERE customer_id = v_customer_id
      AND purpose = 'faturamento';
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_update_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_update_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- 7. RPC: portal_get_profile
--    Retorna dados do perfil do cliente para preencher o formulário.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.portal_get_profile()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'contact_email', a.contact_email,
    'phone', (SELECT cc.phone FROM public.customer_contacts AS cc WHERE cc.customer_id = v_customer_id AND cc.purpose = 'faturamento' LIMIT 1),
    'address', c.address,
    'city', c.city,
    'state', c.state,
    'zip', c.zip
  )
  INTO v_result
  FROM public.customers AS c
  LEFT JOIN public.customer_portal_accounts AS a ON a.customer_id = c.id
  WHERE c.id = v_customer_id;

  RETURN COALESCE(v_result, '{}'::JSONB);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_get_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_get_profile() TO authenticated;
