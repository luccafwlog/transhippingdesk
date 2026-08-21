-- 328: persistencia server-side para linhas PIX nao conciliadas ou ambiguas.
--
-- A identidade de uma linha nao depende do TXID: o extrato pode trazer TXID
-- ausente ou repetido. O par (import_key, line_number) e estavel para
-- reprocessamentos do mesmo arquivo e evita criar invoice/payment ficticio.
-- Rollback: DROP FUNCTION das tres RPCs e DROP TABLE public.pix_reconciliation_exceptions.

CREATE TABLE IF NOT EXISTS public.pix_reconciliation_exceptions (
  id BIGSERIAL PRIMARY KEY,
  import_key TEXT NOT NULL CHECK (char_length(btrim(import_key)) >= 8),
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  txid TEXT NOT NULL DEFAULT '',
  normalized_txid TEXT NOT NULL DEFAULT '',
  cnpj TEXT NOT NULL DEFAULT '',
  paid_at TIMESTAMPTZ,
  amount_brl NUMERIC(14,2) NOT NULL CHECK (amount_brl >= 0),
  reason TEXT NOT NULL CHECK (reason IN ('unmatched', 'ambiguous')),
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_source TEXT CHECK (resolution_source IN ('local', 'demurrage')),
  UNIQUE (import_key, line_number)
);

CREATE INDEX IF NOT EXISTS idx_pix_reconciliation_exceptions_status
  ON public.pix_reconciliation_exceptions(status, created_at DESC);

ALTER TABLE public.pix_reconciliation_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pix_reconciliation_exceptions_select ON public.pix_reconciliation_exceptions;
CREATE POLICY pix_reconciliation_exceptions_select
  ON public.pix_reconciliation_exceptions
  FOR SELECT TO authenticated
  USING (public.is_active_user() AND public.is_admin());

REVOKE INSERT, UPDATE, DELETE ON public.pix_reconciliation_exceptions FROM authenticated, anon, PUBLIC;
GRANT SELECT ON public.pix_reconciliation_exceptions TO authenticated;
REVOKE USAGE, SELECT ON SEQUENCE public.pix_reconciliation_exceptions_id_seq FROM authenticated, anon, PUBLIC;

CREATE OR REPLACE FUNCTION public.upsert_pix_reconciliation_exceptions(
  p_import_key TEXT,
  p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row RECORD;
  v_exception public.pix_reconciliation_exceptions%ROWTYPE;
  v_alert JSONB;
  v_items JSONB := '[]'::jsonb;
  v_import_key TEXT := NULLIF(btrim(COALESCE(p_import_key, '')), '');
  v_normalized_txid TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para reconciliacao PIX.' USING ERRCODE = '42501';
  END IF;
  IF v_import_key IS NULL OR char_length(v_import_key) < 8 THEN
    RAISE EXCEPTION 'Identificador do import PIX invalido.' USING ERRCODE = '22023';
  END IF;

  FOR v_row IN
    SELECT *
    FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS row(
      line_number INTEGER,
      txid TEXT,
      cnpj TEXT,
      paid_at TIMESTAMPTZ,
      amount_brl NUMERIC,
      reason TEXT,
      candidate_count INTEGER,
      metadata JSONB
    )
  LOOP
    IF v_row.line_number IS NULL OR v_row.line_number <= 0
       OR v_row.reason NOT IN ('unmatched', 'ambiguous')
       OR COALESCE(v_row.amount_brl, 0) < 0 THEN
      RAISE EXCEPTION 'Linha de excecao PIX invalida.' USING ERRCODE = '22023';
    END IF;

    v_normalized_txid := UPPER(REGEXP_REPLACE(COALESCE(v_row.txid, ''), '[^A-Za-z0-9]', '', 'g'));
    INSERT INTO public.pix_reconciliation_exceptions (
      import_key, line_number, txid, normalized_txid, cnpj, paid_at,
      amount_brl, reason, candidate_count, metadata, status, updated_at
    )
    VALUES (
      v_import_key, v_row.line_number, COALESCE(v_row.txid, ''), v_normalized_txid,
      COALESCE(v_row.cnpj, ''), v_row.paid_at, ROUND(COALESCE(v_row.amount_brl, 0), 2),
      v_row.reason, GREATEST(COALESCE(v_row.candidate_count, 0), 0),
      COALESCE(v_row.metadata, '{}'::jsonb), 'active', now()
    )
    ON CONFLICT (import_key, line_number) DO UPDATE
      SET txid = EXCLUDED.txid,
          normalized_txid = EXCLUDED.normalized_txid,
          cnpj = EXCLUDED.cnpj,
          paid_at = EXCLUDED.paid_at,
          amount_brl = EXCLUDED.amount_brl,
          reason = EXCLUDED.reason,
          candidate_count = EXCLUDED.candidate_count,
          metadata = EXCLUDED.metadata,
          status = CASE
            WHEN public.pix_reconciliation_exceptions.status = 'resolved' THEN 'resolved'
            ELSE 'active'
          END,
          updated_at = now()
    RETURNING * INTO v_exception;

    v_alert := NULL;
    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    IF v_exception.status = 'active' THEN
      v_alert := public.upsert_alert_item(
        'pix_unreconciled', 'pix_transaction', v_exception.id::TEXT,
        CASE WHEN v_exception.reason = 'ambiguous'
          THEN format('PIX ambiguo na linha %s do import %s.', v_exception.line_number, v_exception.import_key)
          ELSE format('PIX sem conciliacao na linha %s do import %s.', v_exception.line_number, v_exception.import_key)
        END,
        'pix_extract_import',
        jsonb_build_object(
          'exception_id', v_exception.id,
          'import_key', v_exception.import_key,
          'line_number', v_exception.line_number,
          'normalized_txid', v_exception.normalized_txid,
          'reason', v_exception.reason,
          'candidate_count', v_exception.candidate_count
        ) || v_exception.metadata,
        '/reconciliacao'
      );
    ELSE
      PERFORM public.resolve_alert_item(
        'pix_unreconciled', 'pix_transaction', v_exception.id::TEXT,
        'pix_exception_already_resolved', jsonb_build_object('exception_id', v_exception.id)
      );
    END IF;
    PERFORM set_config('alerts.foundation_trigger', 'off', true);

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'id', v_exception.id, 'line_number', v_exception.line_number,
      'status', v_exception.status, 'alert_id', v_alert->>'alert_id'
    ));
  END LOOP;

  RETURN jsonb_build_object('items', v_items);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_pix_reconciliation_exceptions(
  p_status TEXT DEFAULT 'active'
)
RETURNS SETOF public.pix_reconciliation_exceptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para reconciliacao PIX.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_status, 'active') NOT IN ('active', 'resolved', 'all') THEN
    RAISE EXCEPTION 'Status de excecao PIX invalido.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT e.*
  FROM public.pix_reconciliation_exceptions e
  WHERE COALESCE(p_status, 'active') = 'all' OR e.status = COALESCE(p_status, 'active')
  ORDER BY e.created_at DESC, e.line_number DESC;
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
  v_normalized_txid TEXT := UPPER(REGEXP_REPLACE(COALESCE(p_txid, ''), '[^A-Za-z0-9]', '', 'g'));
  v_authoritative BOOLEAN := false;
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

  IF p_resolution_source = 'local' THEN
    IF p_invoice_id IS NULL OR v_normalized_txid = '' THEN
      RAISE EXCEPTION 'Resolucao local exige invoice e TXID.' USING ERRCODE = '22023';
    END IF;
    SELECT EXISTS (
      SELECT 1
      FROM public.ledger_settlements first_settlement
      WHERE first_settlement.invoice_id = p_invoice_id
        AND first_settlement.source = 'pix_extract'
        AND first_settlement.pix_txid IS NOT NULL
        AND UPPER(REGEXP_REPLACE(first_settlement.pix_txid, '[^A-Za-z0-9]', '', 'g')) = v_normalized_txid
        AND ABS((
          SELECT COALESCE(SUM(all_settlements.amount_brl), 0)
          FROM public.ledger_settlements all_settlements
          WHERE all_settlements.payment_id = first_settlement.payment_id
        ) - v_exception.amount_brl) <= 0.01
    ) INTO v_authoritative;
  ELSE
    IF p_demurrage_invoice_id IS NULL THEN
      RAISE EXCEPTION 'Resolucao de demurrage exige invoice.' USING ERRCODE = '22023';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.demurrage_invoices d
      WHERE d.id = p_demurrage_invoice_id
        AND d.status = 'paid'
        AND d.conciliated_by_extract = true
        AND (v_normalized_txid = '' OR UPPER(REGEXP_REPLACE(COALESCE(d.pix_txid, ''), '[^A-Za-z0-9]', '', 'g')) = v_normalized_txid)
        AND ABS(COALESCE(d.current_total_brl, 0) - v_exception.amount_brl) <= 0.01
    ) INTO v_authoritative;
  END IF;

  IF NOT v_authoritative THEN
    RAISE EXCEPTION 'Nenhuma baixa/settlement autoritativa corresponde a excecao PIX %.', p_exception_id USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.pix_reconciliation_exceptions
  SET status = 'resolved', resolved_at = now(), resolved_by = auth.uid(),
      resolution_source = p_resolution_source, updated_at = now()
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

REVOKE ALL ON FUNCTION public.upsert_pix_reconciliation_exceptions(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_pix_reconciliation_exceptions(TEXT, JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.list_pix_reconciliation_exceptions(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pix_reconciliation_exceptions(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.resolve_pix_reconciliation_exception(BIGINT, TEXT, BIGINT, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_pix_reconciliation_exception(BIGINT, TEXT, BIGINT, BIGINT, TEXT) TO authenticated;
