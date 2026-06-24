-- Renumbered from 20260603130350 (original timestamped migration: 20260603130350_portal_auth_uid_rework.sql).
-- Portal: camada de dados por auth.uid() + enriquecimento + self-service de obsoletar
--
-- O portal migrou para login Supabase Auth (email+senha; ver docs/adr/0001).
-- Os RPCs de dados eram chaveados por p_session_token (token legado). Aqui eles
-- passam a resolver o cliente pela sessao Supabase Auth via auth.uid(), usando o
-- helper current_portal_customer_id(). As assinaturas com p_session_token sao
-- dropadas (substituicao no lugar). O portal nao tinha usuarios reais alem da
-- conta legada (descartada), entao nao ha sessao em producao a preservar.
--
-- Inclui:
--   - portal_list_invoices enriquecido com navio/viagem/POD (filtros do redesenho)
--   - portal_obsolete_consolidation: cliente desfaz a propria consolidada aberta
--     (sem pagamentos), liberando os B/Ls para reemissao (ver docs/adr/0002)
--
-- Rollback: restaurar as versoes com p_session_token a partir das migrations
-- 025/038/phase4d/050 e DROP de current_portal_customer_id / portal_obsolete_consolidation.

-- ============================================================================
-- Helper: resolve o customer_id do cliente autenticado no portal (Supabase Auth)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_portal_customer_id()
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  SELECT a.customer_id
  INTO v_customer_id
  FROM public.customer_portal_accounts AS a
  WHERE a.auth_user_id = auth.uid()
    AND a.active = true;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  RETURN v_customer_id;
END;
$function$;

-- ============================================================================
-- portal_list_invoices() — auth.uid + enriquecido com navio/viagem/POD
-- ============================================================================
DROP FUNCTION IF EXISTS public.portal_list_invoices(text);

CREATE OR REPLACE FUNCTION public.portal_list_invoices()
RETURNS TABLE(
  id bigint,
  invoice_number text,
  issued_at timestamptz,
  due_date date,
  total_brl numeric,
  total_paid_brl numeric,
  balance_brl numeric,
  status text,
  invoice_type text,
  vessels text[],
  voyages text[],
  pods text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint := public.current_portal_customer_id();
BEGIN
  RETURN QUERY
  WITH bl_info AS (
    -- Individuais / granito (modelo legado de vinculos)
    SELECT ib.invoice_id, b.pod, v.voyage_number, vs.name AS vessel_name
    FROM public.invoice_bls AS ib
    JOIN public.bls AS b ON b.id = ib.bl_id
    LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    UNION ALL
    -- Consolidadas (ledger): dados vem do snapshot do vinculo
    SELECT irl.invoice_id, irl.bl_snapshot->>'pod', v.voyage_number, vs.name
    FROM public.invoice_receivable_links AS irl
    LEFT JOIN public.voyages AS v ON v.id = (irl.bl_snapshot->>'voyage_id')::bigint
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    WHERE irl.status = 'active'
  ),
  agg AS (
    SELECT
      bl_info.invoice_id,
      array_agg(DISTINCT bl_info.vessel_name) FILTER (WHERE bl_info.vessel_name IS NOT NULL) AS vessels,
      array_agg(DISTINCT bl_info.voyage_number) FILTER (WHERE bl_info.voyage_number IS NOT NULL) AS voyages,
      array_agg(DISTINCT bl_info.pod) FILTER (WHERE bl_info.pod IS NOT NULL) AS pods
    FROM bl_info
    GROUP BY bl_info.invoice_id
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
        THEN ledger.balance_brl
      ELSE i.balance_brl
    END AS balance_brl,
    i.status,
    i.invoice_type,
    COALESCE(agg.vessels, '{}'::text[]),
    COALESCE(agg.voyages, '{}'::text[]),
    COALESCE(agg.pods, '{}'::text[])
  FROM public.invoices AS i
  LEFT JOIN agg ON agg.invoice_id = i.id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS link_count,
      COALESCE(SUM(COALESCE(br.balance_brl, 0)), 0) AS balance_brl
    FROM public.invoice_receivable_links AS irl
    JOIN public.bl_receivables AS br ON br.id = irl.receivable_id
    WHERE irl.invoice_id = i.id
      AND irl.status = 'active'
  ) AS ledger ON true
  WHERE i.customer_id = v_customer_id
  ORDER BY i.created_at DESC;
END;
$function$;

-- ============================================================================
-- portal_list_consolidatable_receivables() — auth.uid
-- ============================================================================
DROP FUNCTION IF EXISTS public.portal_list_consolidatable_receivables(text);

CREATE OR REPLACE FUNCTION public.portal_list_consolidatable_receivables()
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
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint := public.current_portal_customer_id();
BEGIN
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
    WHERE br.customer_id = v_customer_id
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
-- portal_create_consolidation(p_receivable_ids) — auth.uid
-- ============================================================================
DROP FUNCTION IF EXISTS public.portal_create_consolidation(text, bigint[]);

CREATE OR REPLACE FUNCTION public.portal_create_consolidation(p_receivable_ids bigint[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint := public.current_portal_customer_id();
  v_result JSONB;
  v_customer_name TEXT;
  v_invoice_id TEXT;
  v_invoice_number TEXT;
  v_total_brl TEXT;
  v_bl_count INT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.bl_receivables
    WHERE id = ANY(COALESCE(p_receivable_ids, ARRAY[]::BIGINT[]))
      AND customer_id <> v_customer_id
  ) THEN
    RAISE EXCEPTION 'Selecao contem B/Ls de outro cliente.' USING ERRCODE = '42501';
  END IF;

  v_result := public.create_local_consolidated_invoice_core(
    v_customer_id,
    p_receivable_ids,
    NULL,
    'portal'
  );

  SELECT name INTO v_customer_name FROM public.customers WHERE id = v_customer_id LIMIT 1;

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
-- portal_invoice_details(p_invoice_id) — auth.uid (mantem fallback de links)
-- ============================================================================
DROP FUNCTION IF EXISTS public.portal_invoice_details(text, bigint);

CREATE OR REPLACE FUNCTION public.portal_invoice_details(p_invoice_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint := public.current_portal_customer_id();
  v_invoice JSONB;
  v_bls JSONB;
  v_items JSONB;
  v_payments JSONB;
BEGIN
  SELECT TO_JSONB(i.*) || jsonb_build_object(
    'customer_name', c.name,
    'customer_cnpj_cpf', c.cnpj_cpf
  )
  INTO v_invoice
  FROM public.invoices AS i
  LEFT JOIN public.customers AS c ON c.id = i.customer_id
  WHERE i.id = p_invoice_id
    AND i.customer_id = v_customer_id;

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
          'id', l.id, 'invoice_id', p_invoice_id, 'bl_id', l.bl_id,
          'charge_status_snapshot', NULL, 'financial_status_snapshot', NULL,
          'subtotal_brl', l.subtotal_brl, 'subtotal_usd', 0, 'created_at', NULL,
          'pol', l.bl_snapshot->>'pol', 'pod', l.bl_snapshot->>'pod',
          'voyage_number', v.voyage_number, 'vessel_name', vs.name
        ) ORDER BY l.id
      ), '[]'::JSONB),
      COALESCE(JSONB_AGG(
        jsonb_build_object(
          'id', l.id, 'invoice_id', p_invoice_id, 'charge_calculation_id', NULL,
          'description', 'BL ' || l.bl_id || ' - Taxas locais', 'quantity', 1,
          'unit_value_brl', l.subtotal_brl, 'total_value_brl', l.subtotal_brl,
          'bl_id', l.bl_id, 'manifest_id', NULL, 'charge_table_id', NULL,
          'charge_item_id', NULL, 'source', 'ledger', 'currency', 'BRL',
          'unit_value_usd', NULL, 'total_value_usd', NULL
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

  RETURN jsonb_build_object('invoice', v_invoice, 'bls', v_bls, 'items', v_items, 'payments', v_payments);
END;
$function$;

-- ============================================================================
-- portal_list_demurrage_invoices() — auth.uid
-- ============================================================================
DROP FUNCTION IF EXISTS public.portal_list_demurrage_invoices(text);

CREATE OR REPLACE FUNCTION public.portal_list_demurrage_invoices()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint := public.current_portal_customer_id();
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.doc_date DESC), '[]'::jsonb)
    FROM (
      SELECT
        di.id, di.doc_number, di.doc_date, di.due_date, di.billed_at, di.paid_at,
        di.total_usd, di.frozen_roe, di.frozen_total_brl, di.status, di.pix_payload,
        di.dispute_open, di.discount_type, di.discount_value, di.discount_mode,
        b.id AS bl_id, b.pol, b.pod, v.voyage_number, vs.name AS vessel_name
      FROM public.demurrage_invoices di
      JOIN public.bls b ON b.id = di.bl_id
      LEFT JOIN public.voyages v ON v.id = b.voyage_id
      LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
      WHERE di.customer_id = v_customer_id
        AND di.status IN ('issued', 'overdue', 'paid')
    ) t
  );
END;
$function$;

-- ============================================================================
-- portal_get_demurrage_invoice_detail(p_invoice_id) — auth.uid
-- ============================================================================
DROP FUNCTION IF EXISTS public.portal_get_demurrage_invoice_detail(text, bigint);

CREATE OR REPLACE FUNCTION public.portal_get_demurrage_invoice_detail(p_invoice_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint := public.current_portal_customer_id();
  v_invoice JSONB;
  v_items   JSONB;
BEGIN
  SELECT row_to_json(t)::jsonb INTO v_invoice
  FROM (
    SELECT di.*, c.name AS customer_name, c.cnpj_cpf AS customer_cnpj_cpf,
      b.pol, b.pod, v.voyage_number, vs.name AS vessel_name
    FROM public.demurrage_invoices di
    JOIN public.customers c ON c.id = di.customer_id
    JOIN public.bls b ON b.id = di.bl_id
    LEFT JOIN public.voyages v ON v.id = b.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE di.id = p_invoice_id
      AND di.customer_id = v_customer_id
      AND di.status IN ('issued', 'overdue', 'paid')
  ) t;

  IF v_invoice IS NULL THEN
    RAISE EXCEPTION 'Invoice % nao encontrada ou acesso negado', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.id), '[]'::jsonb) INTO v_items
  FROM (SELECT * FROM public.demurrage_invoice_items WHERE invoice_id = p_invoice_id) t;

  RETURN jsonb_build_object('invoice', v_invoice, 'items', v_items);
END;
$function$;

-- ============================================================================
-- portal_obsolete_consolidation(p_invoice_id) — self-service (ver ADR 0002)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.portal_obsolete_consolidation(p_invoice_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint := public.current_portal_customer_id();
  v_invoice RECORD;
  v_customer_name TEXT;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;

  IF NOT FOUND OR v_invoice.customer_id <> v_customer_id THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.invoice_type, 'individual') <> 'consolidated' THEN
    RAISE EXCEPTION 'Apenas faturas consolidadas podem ser desfeitas.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') NOT IN ('issued', 'partially_paid', 'overdue') THEN
    RAISE EXCEPTION 'Esta fatura nao pode ser desfeita.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'Nao e possivel desfazer uma fatura com pagamentos registrados.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices
  SET status = 'obsolete', obsolete_reason = 'Refeita pelo cliente via portal'
  WHERE id = p_invoice_id;

  UPDATE public.invoice_receivable_links SET status = 'obsolete'
  WHERE invoice_id = p_invoice_id AND status = 'active';

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
  VALUES (p_invoice_id, 'obsolete', NULL, jsonb_build_object('reason', 'portal_reissue', 'origin', 'portal'));

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('invoice', p_invoice_id::TEXT, 'obsolete_consolidated', COALESCE(v_invoice.status, 'issued'), 'obsolete',
    NULL, now(), 'Consolidada desfeita pelo cliente via portal');

  SELECT name INTO v_customer_name FROM public.customers WHERE id = v_customer_id LIMIT 1;

  INSERT INTO public.alerts (type, entity_type, entity_id, message, status, created_at)
  VALUES (
    'portal_consolidation_obsoleted', 'invoices', p_invoice_id::TEXT,
    'Cliente ' || COALESCE(v_customer_name, 'desconhecido') || ' desfez a consolidada ' ||
    COALESCE(v_invoice.invoice_number, p_invoice_id::TEXT) || ' via portal',
    'open', now()
  );

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'obsolete');
END;
$function$;

-- Grants: portal usa o role 'authenticated' (Supabase Auth). As funcoes exigem
-- auth.uid() valido, entao chamadas anonimas falham de qualquer forma.
GRANT EXECUTE ON FUNCTION public.current_portal_customer_id() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.portal_list_invoices() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.portal_list_consolidatable_receivables() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.portal_create_consolidation(bigint[]) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.portal_invoice_details(bigint) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.portal_list_demurrage_invoices() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.portal_get_demurrage_invoice_detail(bigint) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.portal_obsolete_consolidation(bigint) TO authenticated, anon;
