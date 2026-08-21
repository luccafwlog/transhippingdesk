-- 325: detector de faturas vencidas locais, exclusivamente server-side.
--
-- A migration 322_review_customer_group_onboarding.sql já ocupa o prefixo
-- 322. Esta cópia forward preserva a alteração ainda não aplicada do Bloco
-- 522 sem criar duas versões com o mesmo número.
-- Rollback: restaurar as definições anteriores de detect_overdue_invoices e
-- run_alert_detectors em banco descartável; não desfazer alertas já emitidos.

CREATE OR REPLACE FUNCTION public.detect_overdue_invoices()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row RECORD;
  v_count INTEGER := 0;
  v_balance_cents BIGINT;
  v_balance_abs NUMERIC;
  v_balance_integer TEXT;
  v_balance_grouped TEXT;
  v_balance_text TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     OR current_setting('alerts.detector_runner', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Detector de vencimentos disponível somente ao runner server-side.'
      USING ERRCODE = '42501';
  END IF;

  FOR v_row IN
    UPDATE public.invoices
    SET status = 'overdue'
    WHERE invoice_type IN ('individual', 'consolidated')
      AND status IN ('issued', 'partially_paid')
      AND due_date IS NOT NULL
      AND due_date < CURRENT_DATE
      AND COALESCE(balance_brl, 0) > 0.01
    RETURNING id, invoice_number, invoice_type, balance_brl, due_date
  LOOP
    v_balance_cents := round(COALESCE(v_row.balance_brl, 0) * 100)::BIGINT;
    v_balance_abs := abs(v_balance_cents) / 100;
    v_balance_integer := trunc(v_balance_abs)::BIGINT::TEXT;
    v_balance_grouped := '';
    WHILE length(v_balance_integer) > 3 LOOP
      v_balance_grouped := '.' || right(v_balance_integer, 3) || v_balance_grouped;
      v_balance_integer := left(v_balance_integer, length(v_balance_integer) - 3);
    END LOOP;
    v_balance_grouped := v_balance_integer || v_balance_grouped;
    v_balance_text :=
      CASE WHEN v_balance_cents < 0 THEN '-' ELSE '' END ||
      v_balance_grouped || ',' ||
      lpad((abs(v_balance_cents) % 100)::TEXT, 2, '0');

    PERFORM public.upsert_alert_item(
      'invoice_overdue',
      'invoice',
      v_row.id::TEXT,
      format(
        'Fatura %s venceu em %s — saldo pendente: R$ %s',
        COALESCE(v_row.invoice_number, 'INV-' || v_row.id),
        to_char(v_row.due_date, 'DD/MM/YYYY'),
        v_balance_text
      ),
      'overdue_invoice_detector',
      jsonb_build_object(
        'invoice_id', v_row.id,
        'invoice_number', v_row.invoice_number,
        'invoice_type', v_row.invoice_type,
        'due_date', v_row.due_date,
        'balance_brl', v_row.balance_brl
      ),
      '/taxas-locais'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.detect_overdue_invoices() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_overdue_invoices() TO service_role;

CREATE OR REPLACE FUNCTION public.run_alert_detectors()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor UUID;
  v_overdue INTEGER := 0;
  v_adr_pending INTEGER := 0;
  v_adr_deadline INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_actor
  FROM public.user_profiles
  WHERE active = true AND role <> 'equipamentos'
  ORDER BY CASE WHEN role IN ('admin', 'administrativo') THEN 0 ELSE 1 END, created_at, id
  LIMIT 1;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Não há usuário interno ativo para executar os detectores.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor::TEXT, true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('alerts.detector_runner', 'on', true);

  v_overdue := public.detect_overdue_invoices();
  v_adr_pending := public.detect_agency_report_pending();
  v_adr_deadline := public.detect_agency_report_deadline_missed();

  RETURN jsonb_build_object(
    'overdue_invoices', v_overdue,
    'agency_report_pending', v_adr_pending,
    'agency_report_deadline_missed', v_adr_deadline
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.run_alert_detectors() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_alert_detectors() TO service_role;

