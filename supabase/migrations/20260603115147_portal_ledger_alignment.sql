-- Portal ledger alignment
--
-- Objetivo: o portal do cliente operava no modelo legado de faturamento
-- (create_invoice_from_bls_core / invoice_bls / invoice_items, exigindo
-- bls.financial_status='pending'), enquanto o fluxo interno migrou para o
-- ledger (bl_receivables / invoice_receivable_links / create_local_consolidated_invoice).
-- Como na pratica todo B/L e faturado individualmente primeiro (financial_status='invoiced'),
-- portal_list_pending_bls retornava 0 linhas e a consolidada do portal ficava inoperante.
--
-- Esta migration alinha o portal ao ledger:
--   1. Extrai um core de consolidacao (sem guarda de admin) reusado pelos dois fluxos.
--   2. Cria portal_list_consolidatable_receivables (escopada por sessao).
--   3. Reescreve portal_create_consolidation para usar receivable_ids + o core do ledger.
--   4. Adiciona ao portal_invoice_details o fallback de invoice_receivable_links.
--
-- Vencimento e observacoes deixam de ser gravados nas novas consolidadas.
--
-- Rollback: restaurar as definicoes anteriores de create_local_consolidated_invoice,
-- portal_create_consolidation(text, text[], date, text) e portal_invoice_details a
-- partir das migrations 025 / 038 / phase4d; e DROP das funcoes novas
-- (create_local_consolidated_invoice_core, portal_list_consolidatable_receivables).

-- ============================================================================
-- 1. Core de consolidacao do ledger (sem guarda de admin, sem due_date/notes)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_local_consolidated_invoice_core(
  p_customer_id bigint,
  p_receivable_ids bigint[],
  p_actor uuid DEFAULT NULL::uuid,
  p_origin text DEFAULT 'internal'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids BIGINT[];
  v_count INTEGER;
  v_invoice_id BIGINT;
  v_invoice_number TEXT;
  v_total NUMERIC(14,2);
BEGIN
  SELECT ARRAY_AGG(DISTINCT id ORDER BY id)
  INTO v_ids
  FROM UNNEST(COALESCE(p_receivable_ids, ARRAY[]::BIGINT[])) AS u(id)
  WHERE id IS NOT NULL;

  IF COALESCE(ARRAY_LENGTH(v_ids, 1), 0) < 1 THEN
    RAISE EXCEPTION 'Nenhum receivable informado para consolidar.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.bl_receivables WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;

  SELECT COUNT(*) INTO v_count FROM public.bl_receivables WHERE id = ANY(v_ids);
  IF v_count <> ARRAY_LENGTH(v_ids, 1) THEN
    RAISE EXCEPTION 'Receivable(s) inexistente(s) na selecao.' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_receivables WHERE id = ANY(v_ids) AND customer_id <> p_customer_id
  ) THEN
    RAISE EXCEPTION 'Selecao contem receivables de clientes diferentes.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_receivables
    WHERE id = ANY(v_ids) AND (status NOT IN ('open', 'partially_settled') OR balance_brl <= 0)
  ) THEN
    RAISE EXCEPTION 'Todos os receivables precisam estar abertos com saldo positivo.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_receivable_links l
    JOIN public.invoices inv ON inv.id = l.invoice_id
    WHERE l.receivable_id = ANY(v_ids)
      AND inv.invoice_type = 'consolidated'
      AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
  ) THEN
    RAISE EXCEPTION 'Um ou mais B/Ls ja estao em consolidada aberta.' USING ERRCODE = '23505';
  END IF;

  SELECT COALESCE(SUM(balance_brl), 0) INTO v_total
  FROM public.bl_receivables WHERE id = ANY(v_ids);

  INSERT INTO public.invoices (
    customer_id, bl_id, issued_at, due_date, total_brl, status, invoice_type,
    notes, total_paid_brl, balance_brl, issued_by
  )
  VALUES (
    p_customer_id, NULL, now(), NULL, v_total, 'issued', 'consolidated',
    NULL, 0, v_total, p_actor
  )
  RETURNING id, invoice_number INTO v_invoice_id, v_invoice_number;

  INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id, subtotal_brl, status, bl_snapshot)
  SELECT
    v_invoice_id, br.id, br.bl_id, br.balance_brl, 'active',
    jsonb_build_object('bl_id', br.bl_id, 'voyage_id', br.voyage_id, 'cargo_mode', br.cargo_mode, 'pol', br.pol, 'pod', br.pod)
  FROM public.bl_receivables br
  WHERE br.id = ANY(v_ids);

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
  VALUES (v_invoice_id, 'issued', p_actor,
    jsonb_build_object('invoice_type', 'consolidated', 'receivable_count', ARRAY_LENGTH(v_ids, 1), 'total_brl', v_total, 'origin', COALESCE(p_origin, 'internal')));

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('invoice', v_invoice_id::TEXT, 'create_consolidated', NULL,
    CONCAT('invoice=', v_invoice_number, ' | receivables=', ARRAY_LENGTH(v_ids, 1), ' | total=', v_total),
    p_actor, now(),
    CASE WHEN COALESCE(p_origin, 'internal') = 'portal' THEN 'Emissao de consolidada via portal do cliente' ELSE 'Emissao de consolidada via ledger' END);

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'status', 'issued',
    'invoice_type', 'consolidated',
    'receivable_count', ARRAY_LENGTH(v_ids, 1),
    'total_brl', v_total
  );
END;
$function$;

-- ============================================================================
-- 2. Wrapper interno: mantem guarda de admin e delega ao core
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_local_consolidated_invoice(
  p_customer_id bigint,
  p_receivable_ids bigint[],
  p_due_date date DEFAULT NULL::date,
  p_notes text DEFAULT NULL::text,
  p_actor uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  RETURN public.create_local_consolidated_invoice_core(
    p_customer_id,
    p_receivable_ids,
    v_actor,
    'internal'
  );
END;
$function$;

-- ============================================================================
-- 3. Lista de receivables consolidaveis escopada a sessao do portal
-- ============================================================================
CREATE OR REPLACE FUNCTION public.portal_list_consolidatable_receivables(p_session_token text)
RETURNS TABLE(
  receivable_id bigint,
  bl_id text,
  customer_id bigint,
  customer_name text,
  customer_cnpj_cpf text,
  voyage_id bigint,
  vessel_name text,
  voyage_number text,
  individual_invoice_id bigint,
  individual_invoice_number text,
  balance_brl numeric,
  original_amount_brl numeric,
  receivable_status text,
  eligibility_status text,
  eligibility_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_session RECORD;
BEGIN
  SELECT *
  INTO v_session
  FROM public.resolve_customer_portal_session(p_session_token)
  LIMIT 1;

  IF v_session.customer_id IS NULL THEN
    RAISE EXCEPTION 'Sessao do portal invalida.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      br.id AS receivable_id,
      br.bl_id,
      br.customer_id,
      c.name AS customer_name,
      c.cnpj_cpf AS customer_cnpj_cpf,
      br.voyage_id,
      v.voyage_number,
      ve.name AS vessel_name,
      br.balance_brl,
      br.original_amount_brl,
      br.status AS receivable_status,
      indiv.invoice_id AS individual_invoice_id,
      inv_ind.invoice_number AS individual_invoice_number,
      EXISTS (
        SELECT 1
        FROM public.invoice_receivable_links irl
        JOIN public.invoices inv ON inv.id = irl.invoice_id
        WHERE irl.receivable_id = br.id
          AND inv.invoice_type = 'consolidated'
          AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
      ) AS has_open_consolidated
    FROM public.bl_receivables br
    JOIN public.customers c ON c.id = br.customer_id
    LEFT JOIN public.voyages v ON v.id = br.voyage_id
    LEFT JOIN public.vessels ve ON ve.id = v.vessel_id
    LEFT JOIN LATERAL (
      SELECT irl.invoice_id
      FROM public.invoice_receivable_links irl
      JOIN public.invoices inv ON inv.id = irl.invoice_id
      WHERE irl.receivable_id = br.id
        AND inv.invoice_type = 'individual'
      ORDER BY inv.id DESC
      LIMIT 1
    ) indiv ON TRUE
    LEFT JOIN public.invoices inv_ind ON inv_ind.id = indiv.invoice_id
    WHERE br.customer_id = v_session.customer_id
      AND br.source = 'local_charges'
  )
  SELECT
    base.receivable_id,
    base.bl_id,
    base.customer_id,
    base.customer_name,
    base.customer_cnpj_cpf,
    base.voyage_id,
    base.vessel_name,
    base.voyage_number,
    base.individual_invoice_id,
    base.individual_invoice_number,
    base.balance_brl,
    base.original_amount_brl,
    base.receivable_status,
    CASE
      WHEN base.receivable_status = 'settled' THEN 'paid'
      WHEN base.receivable_status = 'void' THEN 'no_balance'
      WHEN base.has_open_consolidated THEN 'open_consolidated'
      WHEN base.balance_brl <= 0 THEN 'no_balance'
      ELSE 'eligible'
    END AS eligibility_status,
    CASE
      WHEN base.receivable_status = 'settled' THEN 'B/L ja liquidado.'
      WHEN base.receivable_status = 'void' THEN 'B/L sem saldo de taxas locais.'
      WHEN base.has_open_consolidated THEN 'B/L ja esta em consolidada aberta.'
      WHEN base.balance_brl <= 0 THEN 'B/L sem saldo aberto.'
      ELSE 'Elegivel para consolidacao.'
    END AS eligibility_reason
  FROM base
  ORDER BY base.voyage_id DESC NULLS LAST, base.bl_id ASC;
END;
$function$;

-- ============================================================================
-- 4. Reescrita do portal_create_consolidation: receivable_ids + core do ledger
-- ============================================================================
DROP FUNCTION IF EXISTS public.portal_create_consolidation(text, text[], date, text);

CREATE OR REPLACE FUNCTION public.portal_create_consolidation(
  p_session_token text,
  p_receivable_ids bigint[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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

  IF v_session.customer_id IS NULL THEN
    RAISE EXCEPTION 'Sessao do portal invalida.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bl_receivables
    WHERE id = ANY(COALESCE(p_receivable_ids, ARRAY[]::BIGINT[]))
      AND customer_id <> v_session.customer_id
  ) THEN
    RAISE EXCEPTION 'Selecao contem B/Ls de outro cliente.' USING ERRCODE = '42501';
  END IF;

  v_result := public.create_local_consolidated_invoice_core(
    v_session.customer_id,
    p_receivable_ids,
    NULL,
    'portal'
  );

  SELECT name INTO v_customer_name
  FROM public.customers
  WHERE id = v_session.customer_id
  LIMIT 1;

  v_invoice_id     := v_result->>'invoice_id';
  v_invoice_number := COALESCE(v_result->>'invoice_number', 'fatura');
  v_total_brl      := COALESCE(v_result->>'total_brl', '0');
  v_bl_count       := COALESCE(array_length(p_receivable_ids, 1), 0);

  INSERT INTO public.alerts (type, entity_type, entity_id, message, status, created_at)
  VALUES (
    'portal_invoice_created',
    'invoices',
    v_invoice_id,
    'Cliente ' || COALESCE(v_customer_name, 'desconhecido') ||
    ' criou fatura ' || v_invoice_number ||
    ' com ' || v_bl_count::TEXT || ' B/L(s) via portal - R$ ' || v_total_brl,
    'open',
    now()
  );

  RETURN v_result;
END;
$function$;

-- ============================================================================
-- 5. portal_invoice_details: fallback de invoice_receivable_links para consolidadas
-- ============================================================================
CREATE OR REPLACE FUNCTION public.portal_invoice_details(p_session_token text, p_invoice_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_session RECORD;
  v_invoice JSONB;
  v_bls JSONB;
  v_items JSONB;
  v_payments JSONB;
BEGIN
  SELECT *
  INTO v_session
  FROM public.resolve_customer_portal_session(p_session_token)
  LIMIT 1;

  SELECT TO_JSONB(i.*) || jsonb_build_object(
    'customer_name', c.name,
    'customer_cnpj_cpf', c.cnpj_cpf
  )
  INTO v_invoice
  FROM public.invoices AS i
  LEFT JOIN public.customers AS c ON c.id = i.customer_id
  WHERE i.id = p_invoice_id
    AND i.customer_id = v_session.customer_id;

  IF v_invoice IS NULL THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(JSONB_AGG(
    TO_JSONB(ib.*) || jsonb_build_object(
      'charge_status', b.charge_status,
      'financial_status', b.financial_status,
      'pol', b.pol,
      'pod', b.pod,
      'voyage_number', v.voyage_number,
      'vessel_name', vs.name
    )
    ORDER BY ib.id
  ), '[]'::JSONB)
  INTO v_bls
  FROM public.invoice_bls AS ib
  JOIN public.bls AS b ON b.id = ib.bl_id
  LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
  LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
  WHERE ib.invoice_id = p_invoice_id;

  SELECT COALESCE(JSONB_AGG(TO_JSONB(ii.*) ORDER BY ii.id), '[]'::JSONB)
  INTO v_items
  FROM public.invoice_items AS ii
  WHERE ii.invoice_id = p_invoice_id;

  IF v_items = '[]'::JSONB THEN
    SELECT
      COALESCE(JSONB_AGG(
        jsonb_build_object(
          'id', l.id,
          'invoice_id', p_invoice_id,
          'bl_id', l.bl_id,
          'charge_status_snapshot', NULL,
          'financial_status_snapshot', NULL,
          'subtotal_brl', l.subtotal_brl,
          'subtotal_usd', 0,
          'created_at', NULL,
          'pol', l.bl_snapshot->>'pol',
          'pod', l.bl_snapshot->>'pod',
          'voyage_number', v.voyage_number,
          'vessel_name', vs.name
        ) ORDER BY l.id
      ), '[]'::JSONB),
      COALESCE(JSONB_AGG(
        jsonb_build_object(
          'id', l.id,
          'invoice_id', p_invoice_id,
          'charge_calculation_id', NULL,
          'description', 'BL ' || l.bl_id || ' - Taxas locais',
          'quantity', 1,
          'unit_value_brl', l.subtotal_brl,
          'total_value_brl', l.subtotal_brl,
          'bl_id', l.bl_id,
          'manifest_id', NULL,
          'charge_table_id', NULL,
          'charge_item_id', NULL,
          'source', 'ledger',
          'currency', 'BRL',
          'unit_value_usd', NULL,
          'total_value_usd', NULL
        ) ORDER BY l.id
      ), '[]'::JSONB)
    INTO v_bls, v_items
    FROM public.invoice_receivable_links AS l
    LEFT JOIN public.voyages AS v ON v.id = (l.bl_snapshot->>'voyage_id')::bigint
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    WHERE l.invoice_id = p_invoice_id;
  END IF;

  SELECT COALESCE(JSONB_AGG(TO_JSONB(p.*) ORDER BY p.paid_at DESC, p.id DESC), '[]'::JSONB)
  INTO v_payments
  FROM public.payments AS p
  WHERE p.invoice_id = p_invoice_id;

  RETURN jsonb_build_object(
    'invoice', v_invoice,
    'bls', v_bls,
    'items', v_items,
    'payments', v_payments
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.portal_list_pending_bls(text);

-- O core nao tem guarda de auth e e chamado apenas pelas funcoes SECURITY DEFINER
-- (create_local_consolidated_invoice e portal_create_consolidation). Revoga acesso
-- direto de anon/authenticated/public para impedir emissao arbitraria.
REVOKE ALL ON FUNCTION public.create_local_consolidated_invoice_core(bigint, bigint[], uuid, text) FROM PUBLIC, anon, authenticated;
