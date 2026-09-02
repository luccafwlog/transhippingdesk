-- Renumbered from 20260615145427 (original timestamped migration: 20260615145427_portal_fixes_post_pr227.sql).
-- Correcoes pos-merge do Portal do Cliente (PR #227)
--
-- Intent: corrigir bugs introduzidos nas migrations 0002/0003/0004 do portal que
-- nao foram pegos pelo CI (lint/build/test passavam, mas as funcoes falham em runtime).
--
-- Tabelas afetadas: portal_notifications, portal_rate_limits, customer_contacts,
-- invoice_receivable_links, invoice_lifecycle_events, customer_portal_accounts.
-- Breaking? Nao ha rename/drop de coluna. Apenas CREATE OR REPLACE de funcoes,
-- GRANT e ALTER TABLE ... ENABLE ROW LEVEL SECURITY.

-- ============================================================================
-- 1. portal_resolve_login: liberar EXECUTE para anon
--    A resolucao CNPJ->email ocorre ANTES do signInWithPassword, quando o papel
--    JWT do cliente do portal ainda e anon. Sem este grant o login por CNPJ e o
--    "esqueci a senha" por CNPJ falham com "permission denied for function".
--    (O legado portal_login era concedido a anon, authenticated.)
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.portal_resolve_login(TEXT) TO anon;

-- ============================================================================
-- 2. RLS nas tabelas server-only do portal.
--    Espelha o padrao de portal_login_attempts: RLS habilitado, sem policies, de
--    modo que anon/authenticated nao acessam diretamente; as funcoes SECURITY
--    DEFINER bypassam o RLS como owner. Sem isto, qualquer usuario autenticado
--    poderia ler as notificacoes de todos os clientes e inspecionar o rate limit.
-- ============================================================================

ALTER TABLE public.portal_notifications ENABLE ROW LEVEL SECURITY;
-- Sem policies = inacessivel diretamente por anon/authenticated.

ALTER TABLE public.portal_rate_limits ENABLE ROW LEVEL SECURITY;
-- Sem policies = inacessivel diretamente por anon/authenticated.

-- ============================================================================
-- 3. portal_list_notifications: aplicar LIMIT antes do agregado.
--    Como estava, o LIMIT incidia sobre a query do JSONB_AGG (que retorna 1 linha),
--    sendo um no-op: todas as notificacoes do cliente eram retornadas.
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
      'read', n.read,
      'created_at', n.created_at
    ) ORDER BY n.created_at DESC
  ), '[]'::JSONB)
  INTO v_result
  FROM (
    SELECT id, type, title, message, link, (read_at IS NOT NULL) AS read, created_at
    FROM public.portal_notifications
    WHERE customer_id = v_customer_id
    ORDER BY created_at DESC
    LIMIT p_limit
  ) AS n;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_list_notifications(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_list_notifications(INT) TO authenticated;

-- ============================================================================
-- 4. portal_update_profile: evitar duplicacao do contato de faturamento.
--    customer_contacts nao possui unique constraint, entao ON CONFLICT DO NOTHING
--    nunca disparava e cada salvamento com telefone inseria um novo contato.
--    Agora: atualiza se existir, insere apenas se nao existir.
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
BEGIN
  -- Atualiza email de contato na conta de portal
  IF p_contact_email IS NOT NULL THEN
    UPDATE public.customer_portal_accounts
    SET contact_email = NULLIF(trim(p_contact_email), ''),
        updated_at = now()
    WHERE customer_id = v_customer_id;
  END IF;

  -- Atualiza endereco no cadastro do cliente
  UPDATE public.customers
  SET
    address = COALESCE(NULLIF(trim(COALESCE(p_address, '')), ''), address),
    city = COALESCE(NULLIF(trim(COALESCE(p_city, '')), ''), city),
    state = COALESCE(NULLIF(trim(COALESCE(p_state, '')), ''), state),
    zip = COALESCE(NULLIF(trim(COALESCE(p_zip, '')), ''), zip),
    updated_at = now()
  WHERE id = v_customer_id;

  -- Telefone: atualiza o contato de faturamento se existir, senao cria.
  IF p_phone IS NOT NULL AND trim(p_phone) <> '' THEN
    IF EXISTS (
      SELECT 1 FROM public.customer_contacts
      WHERE customer_id = v_customer_id AND purpose = 'faturamento'
    ) THEN
      UPDATE public.customer_contacts
      SET phone = NULLIF(trim(p_phone), '')
      WHERE customer_id = v_customer_id
        AND purpose = 'faturamento';
    ELSE
      INSERT INTO public.customer_contacts (customer_id, name, email, phone, purpose, is_primary)
      VALUES (v_customer_id, 'Contato principal', NULL, NULLIF(trim(p_phone), ''), 'faturamento', true);
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_update_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_update_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- 5. portal_obsolete_consolidation: corrigir coluna/evento/status invalidos.
--    - invoice_lifecycle_events usa a coluna event_type (nao "event") e o valor
--      precisa estar no CHECK; 'obsoleted_by_customer' nao existe -> usar 'obsolete'.
--    - invoice_receivable_links.status valido e 'obsolete' (nao 'cancelled'), e
--      apenas vinculos 'active' devem ser obsoletados.
--    Como estava, qualquer "desfazer consolidacao" pelo portal lancava erro.
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

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
  VALUES (
    p_invoice_id,
    'obsolete',
    NULL,
    jsonb_build_object('reason', 'obsoleted_by_customer', 'origin', 'portal', 'customer_id', v_customer_id)
  );

  UPDATE public.invoices
  SET status = 'obsolete',
      obsolete_reason = 'Desfeita pelo cliente pelo portal.',
      updated_at = now()
  WHERE id = p_invoice_id;

  UPDATE public.invoice_receivable_links
  SET status = 'obsolete'
  WHERE invoice_id = p_invoice_id
    AND status = 'active';

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

-- Rollback:
--   REVOKE EXECUTE ON FUNCTION public.portal_resolve_login(TEXT) FROM anon;
--   ALTER TABLE public.portal_notifications DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.portal_rate_limits DISABLE ROW LEVEL SECURITY;
--   -- e restaurar as versoes anteriores das funcoes via CREATE OR REPLACE.
