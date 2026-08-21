-- 331: Bloco 522 — fechamento dos achados finais P1/P2.
-- Esta migration é forward-only. As migrations 318, 321, 323 e 324 permanecem
-- intactas; os contratos abaixo substituem seus caminhos permissivos.

-- ============================================================================
-- A. PIX: vínculo manual sem baixa fictícia, resolução autoritativa e reabertura
-- ============================================================================

ALTER TABLE public.pix_reconciliation_exceptions
  ADD COLUMN IF NOT EXISTS resolved_invoice_id BIGINT,
  ADD COLUMN IF NOT EXISTS resolved_demurrage_invoice_id BIGINT;

CREATE OR REPLACE FUNCTION public.normalize_pix_txid(p_txid TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT UPPER(REGEXP_REPLACE(COALESCE(p_txid, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.pix_reconciliation_authority_holds(p_exception_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_exception public.pix_reconciliation_exceptions%ROWTYPE;
  v_paid_date DATE;
BEGIN
  SELECT * INTO v_exception
  FROM public.pix_reconciliation_exceptions
  WHERE id = p_exception_id;

  IF NOT FOUND OR v_exception.status <> 'resolved' THEN
    RETURN false;
  END IF;

  IF v_exception.resolution_source = 'local' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.invoices i
      JOIN public.ledger_settlements first_settlement
        ON first_settlement.invoice_id = i.id
       AND first_settlement.source = 'pix_extract'
       AND public.normalize_pix_txid(first_settlement.pix_txid) = v_exception.normalized_txid
      WHERE i.id = v_exception.resolved_invoice_id
        AND i.invoice_type IN ('individual', 'consolidated')
        AND ABS((
          SELECT COALESCE(SUM(all_settlements.amount_brl), 0)
          FROM public.ledger_settlements all_settlements
          WHERE all_settlements.payment_id = first_settlement.payment_id
        ) - v_exception.amount_brl) <= 0.01
        AND (
          public.normalize_pix_txid(i.pix_txid) = v_exception.normalized_txid
          OR v_exception.normalized_txid <> ''
        )
    );
  END IF;

  IF v_exception.resolution_source = 'demurrage' THEN
    IF v_exception.paid_at IS NULL THEN
      RETURN false;
    END IF;
    v_paid_date := (v_exception.paid_at AT TIME ZONE 'UTC')::DATE;
    RETURN EXISTS (
      SELECT 1
      FROM public.demurrage_invoices d
      WHERE d.id = v_exception.resolved_demurrage_invoice_id
        AND d.status = 'paid'
        AND d.conciliated_by_extract = true
        AND d.paid_at = v_paid_date
        AND public.normalize_pix_txid(d.pix_txid) = v_exception.normalized_txid
        AND EXISTS (
          SELECT 1
          FROM public.get_demurrage_recent_values(d.id, v_paid_date) w
          WHERE ABS(w.total_brl - v_exception.amount_brl) <= 0.01
        )
    );
  END IF;

  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_pix_reconciliation_candidates(p_exception_id BIGINT)
RETURNS TABLE(source TEXT, invoice_id BIGINT, doc_number TEXT, amount_brl NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_exception public.pix_reconciliation_exceptions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para reconciliacao PIX.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_exception
  FROM public.pix_reconciliation_exceptions
  WHERE id = p_exception_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Excecao PIX % nao encontrada.', p_exception_id USING ERRCODE = 'P0002';
  END IF;

  IF v_exception.normalized_txid = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 'local', i.id, COALESCE(i.invoice_number, i.id::TEXT), COALESCE(i.balance_brl, i.total_brl, 0)
  FROM public.invoices i
  WHERE i.invoice_type IN ('individual', 'consolidated')
    AND COALESCE(i.status, 'issued') IN ('issued', 'partially_paid', 'overdue')
    AND public.normalize_pix_txid(i.pix_txid) = v_exception.normalized_txid
  UNION ALL
  SELECT 'demurrage', d.id, d.doc_number, COALESCE(d.current_total_brl, 0)
  FROM public.demurrage_invoices d
  WHERE COALESCE(d.status, 'issued') IN ('issued', 'paid')
    AND public.normalize_pix_txid(d.pix_txid) = v_exception.normalized_txid
  ORDER BY 1, 3;
END;
$function$;

CREATE OR REPLACE FUNCTION public.link_pix_reconciliation_candidate(
  p_exception_id BIGINT,
  p_resolution_source TEXT,
  p_invoice_id BIGINT DEFAULT NULL,
  p_demurrage_invoice_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_exception public.pix_reconciliation_exceptions%ROWTYPE;
  v_candidate RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para reconciliacao PIX.' USING ERRCODE = '42501';
  END IF;
  IF p_resolution_source NOT IN ('local', 'demurrage') THEN
    RAISE EXCEPTION 'Origem de resolucao PIX invalida.' USING ERRCODE = '22023';
  END IF;
  IF (p_resolution_source = 'local' AND (p_invoice_id IS NULL OR p_demurrage_invoice_id IS NOT NULL))
     OR (p_resolution_source = 'demurrage' AND (p_demurrage_invoice_id IS NULL OR p_invoice_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Vinculo PIX exige exatamente uma candidata da origem escolhida.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_exception
  FROM public.pix_reconciliation_exceptions
  WHERE id = p_exception_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Excecao PIX % nao encontrada.', p_exception_id USING ERRCODE = 'P0002';
  END IF;
  IF v_exception.status = 'resolved' THEN
    RETURN jsonb_build_object('id', v_exception.id, 'status', 'resolved');
  END IF;
  IF v_exception.normalized_txid = '' THEN
    RAISE EXCEPTION 'Linha sem TXID nao possui candidata segura para vinculo manual.' USING ERRCODE = 'P0001';
  END IF;

  IF p_resolution_source = 'local' THEN
    SELECT i.id, COALESCE(i.invoice_number, i.id::TEXT) AS doc_number,
           COALESCE(i.balance_brl, i.total_brl, 0) AS amount_brl
    INTO v_candidate
    FROM public.invoices i
    WHERE i.id = p_invoice_id
      AND i.invoice_type IN ('individual', 'consolidated')
      AND COALESCE(i.status, 'issued') IN ('issued', 'partially_paid', 'overdue')
      AND public.normalize_pix_txid(i.pix_txid) = v_exception.normalized_txid;
  ELSE
    SELECT d.id, d.doc_number, COALESCE(d.current_total_brl, 0) AS amount_brl
    INTO v_candidate
    FROM public.demurrage_invoices d
    WHERE d.id = p_demurrage_invoice_id
      AND COALESCE(d.status, 'issued') IN ('issued', 'paid')
      AND public.normalize_pix_txid(d.pix_txid) = v_exception.normalized_txid;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidata nao corresponde exatamente ao TXID persistido.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.pix_reconciliation_exceptions
  SET metadata = metadata || jsonb_build_object(
        'manual_candidate', jsonb_build_object(
          'source', p_resolution_source,
          'invoice_id', CASE WHEN p_resolution_source = 'local' THEN p_invoice_id ELSE NULL END,
          'demurrage_invoice_id', CASE WHEN p_resolution_source = 'demurrage' THEN p_demurrage_invoice_id ELSE NULL END,
          'doc_number', v_candidate.doc_number,
          'linked_at', now()
        )
      ),
      updated_at = now()
  WHERE id = v_exception.id;

  RETURN jsonb_build_object('id', v_exception.id, 'status', 'active', 'candidate', v_candidate.doc_number);
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_pix_reconciliation_exception(
  p_exception_id BIGINT,
  p_resolution_source TEXT,
  p_invoice_id BIGINT DEFAULT NULL,
  p_demurrage_invoice_id BIGINT DEFAULT NULL,
  p_txid TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_exception public.pix_reconciliation_exceptions%ROWTYPE;
  v_normalized_txid TEXT := public.normalize_pix_txid(p_txid);
  v_authoritative BOOLEAN := false;
  v_paid_date DATE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para reconciliacao PIX.' USING ERRCODE = '42501';
  END IF;
  IF p_resolution_source NOT IN ('local', 'demurrage') THEN
    RAISE EXCEPTION 'Origem de resolucao PIX invalida.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_exception
  FROM public.pix_reconciliation_exceptions
  WHERE id = p_exception_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Excecao PIX % nao encontrada.', p_exception_id USING ERRCODE = 'P0002';
  END IF;
  IF v_exception.status = 'resolved' THEN
    RETURN jsonb_build_object('id', v_exception.id, 'status', 'resolved');
  END IF;
  IF v_normalized_txid IS DISTINCT FROM v_exception.normalized_txid THEN
    RAISE EXCEPTION 'TXID informado nao corresponde exatamente ao TXID persistido na excecao.' USING ERRCODE = '22023';
  END IF;

  IF p_resolution_source = 'local' THEN
    IF p_invoice_id IS NULL OR p_demurrage_invoice_id IS NOT NULL OR v_normalized_txid = '' THEN
      RAISE EXCEPTION 'Resolucao local exige invoice local e TXID persistido.' USING ERRCODE = '22023';
    END IF;
    SELECT EXISTS (
      SELECT 1
      FROM public.invoices i
      JOIN public.ledger_settlements first_settlement
        ON first_settlement.invoice_id = i.id
       AND first_settlement.source = 'pix_extract'
       AND public.normalize_pix_txid(first_settlement.pix_txid) = v_exception.normalized_txid
      WHERE i.id = p_invoice_id
        AND i.invoice_type IN ('individual', 'consolidated')
        AND ABS((
          SELECT COALESCE(SUM(all_settlements.amount_brl), 0)
          FROM public.ledger_settlements all_settlements
          WHERE all_settlements.payment_id = first_settlement.payment_id
        ) - v_exception.amount_brl) <= 0.01
        AND (
          public.normalize_pix_txid(i.pix_txid) = v_exception.normalized_txid
          OR v_exception.normalized_txid <> ''
        )
    ) INTO v_authoritative;
  ELSE
    IF p_demurrage_invoice_id IS NULL OR p_invoice_id IS NOT NULL OR v_exception.paid_at IS NULL THEN
      RAISE EXCEPTION 'Resolucao Demurrage exige invoice e data paga persistida.' USING ERRCODE = '22023';
    END IF;
    v_paid_date := (v_exception.paid_at AT TIME ZONE 'UTC')::DATE;
    SELECT EXISTS (
      SELECT 1
      FROM public.demurrage_invoices d
      WHERE d.id = p_demurrage_invoice_id
        AND d.status = 'paid'
        AND d.conciliated_by_extract = true
        AND d.paid_at = v_paid_date
        AND public.normalize_pix_txid(d.pix_txid) = v_exception.normalized_txid
        AND EXISTS (
          SELECT 1
          FROM public.get_demurrage_recent_values(d.id, v_paid_date) w
          WHERE ABS(w.total_brl - v_exception.amount_brl) <= 0.01
        )
    ) INTO v_authoritative;
  END IF;

  IF NOT v_authoritative THEN
    RAISE EXCEPTION 'Nenhuma baixa/settlement autoritativa corresponde a excecao PIX %.', p_exception_id USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.pix_reconciliation_exceptions
  SET status = 'resolved', resolved_at = now(), resolved_by = auth.uid(),
      resolution_source = p_resolution_source,
      resolved_invoice_id = p_invoice_id,
      resolved_demurrage_invoice_id = p_demurrage_invoice_id,
      updated_at = now()
  WHERE id = v_exception.id;

  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  PERFORM public.resolve_alert_item(
    'pix_unreconciled', 'pix_transaction', v_exception.id::TEXT,
    'pix_reconciliation_authoritative', jsonb_build_object(
      'exception_id', v_exception.id,
      'resolution_source', p_resolution_source,
      'invoice_id', COALESCE(p_invoice_id, p_demurrage_invoice_id),
      'txid', NULLIF(p_txid, '')
    )
  );
  PERFORM set_config('alerts.foundation_trigger', 'off', true);

  RETURN jsonb_build_object('id', v_exception.id, 'status', 'resolved');
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_pix_reconciliation_exception(p_exception_id BIGINT, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_exception public.pix_reconciliation_exceptions%ROWTYPE;
BEGIN
  SELECT * INTO v_exception
  FROM public.pix_reconciliation_exceptions
  WHERE id = p_exception_id
  FOR UPDATE;
  IF NOT FOUND OR v_exception.status <> 'resolved' THEN
    RETURN;
  END IF;
  IF public.pix_reconciliation_authority_holds(p_exception_id) THEN
    RETURN;
  END IF;

  UPDATE public.pix_reconciliation_exceptions
  SET status = 'active', resolved_at = NULL, resolved_by = NULL,
      resolution_source = NULL, resolved_invoice_id = NULL,
      resolved_demurrage_invoice_id = NULL,
      metadata = metadata || jsonb_build_object('reopened_reason', COALESCE(p_reason, 'authority_invalidated')),
      updated_at = now()
  WHERE id = v_exception.id;

  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  PERFORM public.upsert_alert_item(
    'pix_unreconciled', 'pix_transaction', v_exception.id::TEXT,
    format('PIX sem conciliacao na linha %s do import %s.', v_exception.line_number, v_exception.import_key),
    'pix_authority_invalidated',
    jsonb_build_object('exception_id', v_exception.id, 'reason', COALESCE(p_reason, 'authority_invalidated')) || v_exception.metadata,
    '/reconciliacao'
  );
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_pix_exception_for_authority_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_payload JSONB := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_invoice_id BIGINT := NULLIF(v_payload->>'invoice_id', '')::BIGINT;
  v_demurrage_invoice_id BIGINT := NULLIF(v_payload->>'id', '')::BIGINT;
  v_exception RECORD;
BEGIN
  IF TG_TABLE_NAME = 'ledger_settlements' THEN
    FOR v_exception IN
      SELECT id FROM public.pix_reconciliation_exceptions
      WHERE status = 'resolved' AND resolved_invoice_id = v_invoice_id
    LOOP
      PERFORM public.reopen_pix_reconciliation_exception(v_exception.id, 'ledger_settlement_reverted_or_changed');
    END LOOP;
  ELSIF TG_TABLE_NAME = 'demurrage_invoices' THEN
    FOR v_exception IN
      SELECT id FROM public.pix_reconciliation_exceptions
      WHERE status = 'resolved' AND resolved_demurrage_invoice_id = v_demurrage_invoice_id
    LOOP
      PERFORM public.reopen_pix_reconciliation_exception(v_exception.id, 'demurrage_payment_reverted_or_changed');
    END LOOP;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS reopen_pix_exception_on_ledger_settlement ON public.ledger_settlements;
CREATE TRIGGER reopen_pix_exception_on_ledger_settlement
  AFTER INSERT OR UPDATE OR DELETE ON public.ledger_settlements
  FOR EACH ROW EXECUTE FUNCTION public.reopen_pix_exception_for_authority_change();

DROP TRIGGER IF EXISTS reopen_pix_exception_on_demurrage_invoice ON public.demurrage_invoices;
CREATE TRIGGER reopen_pix_exception_on_demurrage_invoice
  AFTER UPDATE OF status, paid_at, pix_txid, conciliated_by_extract, current_total_brl
  ON public.demurrage_invoices
  FOR EACH ROW EXECUTE FUNCTION public.reopen_pix_exception_for_authority_change();

REVOKE ALL ON FUNCTION public.normalize_pix_txid(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pix_reconciliation_authority_holds(BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_pix_reconciliation_candidates(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pix_reconciliation_candidates(BIGINT) TO authenticated;
REVOKE ALL ON FUNCTION public.link_pix_reconciliation_candidate(BIGINT, TEXT, BIGINT, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_pix_reconciliation_candidate(BIGINT, TEXT, BIGINT, BIGINT) TO authenticated;
REVOKE ALL ON FUNCTION public.resolve_pix_reconciliation_exception(BIGINT, TEXT, BIGINT, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_pix_reconciliation_exception(BIGINT, TEXT, BIGINT, BIGINT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.reopen_pix_reconciliation_exception(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reopen_pix_exception_for_authority_change() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- B. Disputa Demurrage: só Equipamentos quando a fonte #521 existir
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_demurrage_dispute_alert_for_invoice(
  p_demurrage_invoice_id BIGINT,
  p_next_responder TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_invoice RECORD;
BEGIN
  SELECT id, dispute_open, dispute_status INTO v_invoice
  FROM public.demurrage_invoices
  WHERE id = p_demurrage_invoice_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF COALESCE(lower(trim(p_next_responder)), '') = 'equipamentos'
     AND v_invoice.dispute_open
     AND COALESCE(v_invoice.dispute_status, 'aberto') NOT IN ('resolvido', 'cancelado') THEN
    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    PERFORM public.upsert_alert_item(
      'portal_dispute_opened', 'demurrage_invoice', v_invoice.id::TEXT,
      'Disputa de invoice Demurrage aguardando Equipamentos.',
      'demurrage_dispute', jsonb_build_object('next_responder', 'equipamentos'), '/demurrage'
    );
    PERFORM set_config('alerts.foundation_trigger', 'off', true);
  ELSE
    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    PERFORM public.resolve_alert_item(
      'portal_dispute_opened', 'demurrage_invoice', v_invoice.id::TEXT,
      CASE WHEN p_next_responder IS NULL THEN 'next_action_source_unavailable' ELSE 'next_action_not_equipamentos' END,
      jsonb_build_object('next_responder', p_next_responder)
    );
    PERFORM set_config('alerts.foundation_trigger', 'off', true);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_demurrage_dispute_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_link_column TEXT;
  v_next_responder TEXT;
BEGIN
  IF to_regclass('public.demurrage_disputes') IS NULL THEN
    PERFORM public.sync_demurrage_dispute_alert_for_invoice(NEW.id, NULL);
    RETURN NEW;
  END IF;

  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'demurrage_disputes' AND column_name = 'demurrage_invoice_id') THEN 'demurrage_invoice_id'
    WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'demurrage_disputes' AND column_name = 'invoice_id') THEN 'invoice_id'
    ELSE NULL
  END INTO v_link_column;

  IF v_link_column IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'demurrage_disputes' AND column_name = 'next_responder') THEN
    PERFORM public.sync_demurrage_dispute_alert_for_invoice(NEW.id, NULL);
    RETURN NEW;
  END IF;

  EXECUTE format(
    'SELECT next_responder::text FROM public.demurrage_disputes WHERE %I = $1 ORDER BY 1 DESC NULLS LAST LIMIT 1',
    v_link_column
  ) INTO v_next_responder USING NEW.id;
  PERFORM public.sync_demurrage_dispute_alert_for_invoice(NEW.id, v_next_responder);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_demurrage_dispute_source_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_payload JSONB := to_jsonb(NEW);
  v_invoice_id BIGINT;
BEGIN
  v_invoice_id := NULLIF(COALESCE(v_payload->>'demurrage_invoice_id', v_payload->>'invoice_id'), '')::BIGINT;
  IF v_invoice_id IS NOT NULL THEN
    PERFORM public.sync_demurrage_dispute_alert_for_invoice(v_invoice_id, v_payload->>'next_responder');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sync_demurrage_dispute_alert_on_change ON public.demurrage_invoices;
CREATE TRIGGER sync_demurrage_dispute_alert_on_change
  AFTER INSERT OR UPDATE OF dispute_open, dispute_status ON public.demurrage_invoices
  FOR EACH ROW EXECUTE FUNCTION public.sync_demurrage_dispute_alert();

DO $setup_source_trigger$
BEGIN
  IF to_regclass('public.demurrage_disputes') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'demurrage_disputes' AND column_name = 'next_responder')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'demurrage_disputes' AND column_name IN ('demurrage_invoice_id', 'invoice_id')) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS sync_demurrage_dispute_source_alert ON public.demurrage_disputes';
    EXECUTE 'CREATE TRIGGER sync_demurrage_dispute_source_alert AFTER INSERT OR UPDATE ON public.demurrage_disputes FOR EACH ROW EXECUTE FUNCTION public.sync_demurrage_dispute_source_alert()';
  END IF;
END;
$setup_source_trigger$;

REVOKE ALL ON FUNCTION public.sync_demurrage_dispute_alert_for_invoice(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_demurrage_dispute_alert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_demurrage_dispute_source_alert() FROM PUBLIC, anon, authenticated;
