-- 012: fronteira transacional para baixa e desconto de Demurrage (S08-A).
--
-- O navegador continua podendo consultar as faturas, mas nao escreve status,
-- valores, payload PIX ou historico. As duas mutacoes financeiras abaixo sao
-- idempotentes, bloqueiam a fatura durante a decisao e gravam a trilha dentro
-- da mesma transacao.

CREATE TABLE IF NOT EXISTS public.demurrage_mutation_requests (
  request_id uuid PRIMARY KEY,
  operation text NOT NULL CHECK (operation IN ('payment', 'discount', 'cancel', 'reopen')),
  invoice_id bigint NOT NULL REFERENCES public.demurrage_invoices(id) ON DELETE RESTRICT,
  request_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.demurrage_mutation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.demurrage_mutation_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.demurrage_mutation_requests TO service_role;

-- Um PIX identificado nao pode quitar duas faturas. A condicao ignora o valor
-- vazio para manter legivel o legado que ainda nao tem txid.
CREATE UNIQUE INDEX IF NOT EXISTS demurrage_invoices_pix_txid_key
  ON public.demurrage_invoices (btrim(pix_txid))
  WHERE pix_txid IS NOT NULL AND btrim(pix_txid) <> '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'demurrage_rates_intrinsic_sanity_chk'
      AND conrelid = 'public.demurrage_rates'::regclass
  ) THEN
    ALTER TABLE public.demurrage_rates
      ADD CONSTRAINT demurrage_rates_intrinsic_sanity_chk CHECK (
        free_days >= 0
        AND p1_day_from >= 1
        AND p1_day_to >= p1_day_from
        AND p2_day_from > p1_day_to
        AND p1_usd >= 0
        AND p2_usd >= 0
        AND (valid_to IS NULL OR valid_to >= valid_from)
      ) NOT VALID;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public._demurrage_mutation_request(
  p_request_id uuid,
  p_operation text,
  p_invoice_id bigint,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_existing public.demurrage_mutation_requests%ROWTYPE;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Identificador de pedido obrigatorio.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.demurrage_mutation_requests
  WHERE request_id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_existing.operation IS DISTINCT FROM p_operation
     OR v_existing.invoice_id IS DISTINCT FROM p_invoice_id
     OR v_existing.request_payload IS DISTINCT FROM p_payload THEN
    RAISE EXCEPTION 'Pedido % ja foi usado com outro conteudo.', p_request_id USING ERRCODE = '23505';
  END IF;

  RETURN v_existing.result;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_demurrage_payment(
  p_request_id uuid,
  p_invoice_id bigint,
  p_paid_at date,
  p_pix_txid text DEFAULT NULL,
  p_total_brl numeric DEFAULT NULL,
  p_ptax_used numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_payload jsonb;
  v_previous jsonb;
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_match record;
  v_total_brl numeric(14,2);
  v_ptax numeric(10,4);
  v_roe numeric(10,4);
  v_discount numeric(12,2);
  v_result jsonb;
  v_txid text := NULLIF(btrim(p_pix_txid), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_financeiro_user()) THEN
    RAISE EXCEPTION 'Usuario sem permissao para registrar baixa de Demurrage.' USING ERRCODE = '42501';
  END IF;
  IF p_invoice_id IS NULL OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'Fatura e data de pagamento sao obrigatorias.' USING ERRCODE = '22023';
  END IF;
  IF v_txid IS NOT NULL AND char_length(v_txid) > 140 THEN
    RAISE EXCEPTION 'Identificador PIX invalido.' USING ERRCODE = '22023';
  END IF;
  IF p_total_brl IS NOT NULL AND p_total_brl < 0 THEN
    RAISE EXCEPTION 'Valor pago nao pode ser negativo.' USING ERRCODE = '22003';
  END IF;

  v_payload := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'paid_at', p_paid_at,
    'pix_txid', v_txid,
    'total_brl', CASE WHEN p_total_brl IS NULL THEN NULL ELSE round(p_total_brl, 2) END
  );
  v_previous := public._demurrage_mutation_request(p_request_id, 'payment', p_invoice_id, v_payload);
  IF v_previous IS NOT NULL THEN
    RETURN v_previous;
  END IF;

  SELECT * INTO v_invoice
  FROM public.demurrage_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demurrage invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice.status = 'paid' THEN
    IF v_txid IS NOT NULL AND v_invoice.pix_txid = v_txid THEN
      RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'paid', 'idempotent', true);
    END IF;
    RAISE EXCEPTION 'Demurrage invoice % ja esta paga.', p_invoice_id USING ERRCODE = '22023';
  END IF;
  IF v_invoice.status NOT IN ('issued', 'overdue') OR v_invoice.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'Demurrage invoice % nao pode ser baixada no status atual.', p_invoice_id USING ERRCODE = '22023';
  END IF;

  -- A prova financeira vem da foto persistida. O valor informado pelo extrato
  -- apenas precisa coincidir com uma das duas fotos anteriores ao pagamento.
  SELECT h.total_brl, h.ptax_used, h.roe_used
    INTO v_match
  FROM public.demurrage_invoice_history AS h
  WHERE h.invoice_id = p_invoice_id
    AND h.event_date <= p_paid_at
    AND (p_total_brl IS NULL OR abs(h.total_brl - round(p_total_brl, 2)) <= 0.01)
  ORDER BY h.event_date DESC, h.id DESC
  LIMIT 1;

  IF FOUND THEN
    v_total_brl := round(COALESCE(p_total_brl, v_match.total_brl), 2);
    v_ptax := v_match.ptax_used;
    v_roe := v_match.roe_used;
  ELSE
    -- Legado sem foto: a propria fatura ainda e a unica referencia disponivel;
    -- nao aceitamos um ROE arbitrario do cliente para substituir esse valor.
    v_total_brl := round(COALESCE(p_total_brl, v_invoice.current_total_brl), 2);
    v_roe := v_invoice.current_roe;
    v_ptax := round(COALESCE(v_invoice.current_roe / NULLIF(1.065, 0), p_ptax_used), 4);
    IF v_invoice.current_total_brl IS NULL
       OR p_total_brl IS NULL
       OR abs(v_invoice.current_total_brl - p_total_brl) > 0.01 THEN
      RAISE EXCEPTION 'Valor divergente da foto financeira da Demurrage %.', p_invoice_id USING ERRCODE = '22003';
    END IF;
  END IF;

  IF v_total_brl IS NULL OR v_total_brl <= 0 OR v_roe IS NULL OR v_roe <= 0 OR v_ptax IS NULL OR v_ptax <= 0 THEN
    RAISE EXCEPTION 'Fatura % nao possui uma foto financeira pagavel.', p_invoice_id USING ERRCODE = '22023';
  END IF;
  IF v_txid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.demurrage_invoices d
    WHERE btrim(d.pix_txid) = v_txid AND d.id <> p_invoice_id
  ) THEN
    RAISE EXCEPTION 'PIX % ja esta associado a outra fatura.', v_txid USING ERRCODE = '23505';
  END IF;

  v_discount := greatest(0, round(v_invoice.total_usd - v_total_brl / v_roe, 2));

  UPDATE public.demurrage_invoices
  SET status = 'paid',
      paid_at = p_paid_at,
      pix_txid = v_txid,
      conciliated_by_extract = (v_txid IS NOT NULL),
      current_total_brl = v_total_brl,
      current_roe = v_roe,
      updated_at = now()
  WHERE id = p_invoice_id;

  INSERT INTO public.demurrage_invoice_history
    (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
  VALUES
    (p_invoice_id, p_paid_at, v_ptax, v_roe, v_invoice.total_usd, v_total_brl, v_discount, 'payment');

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, changed_at, justification
  ) VALUES (
    'demurrage_invoice', p_invoice_id::text, 'payment_registered',
    v_invoice.status,
    jsonb_build_object('status', 'paid', 'paid_at', p_paid_at, 'pix_txid', v_txid)::text,
    auth.uid(), now(), 'Baixa de Demurrage por contrato financeiro.'
  );

  v_result := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'status', 'paid',
    'paid_at', p_paid_at,
    'total_brl', v_total_brl,
    'idempotent', false
  );
  INSERT INTO public.demurrage_mutation_requests(request_id, operation, invoice_id, request_payload, result, created_by)
  VALUES (p_request_id, 'payment', p_invoice_id, v_payload, v_result, auth.uid())
  ON CONFLICT (request_id) DO NOTHING;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_demurrage_discount(
  p_request_id uuid,
  p_invoice_id bigint,
  p_discount_mode text,
  p_discount_value numeric,
  p_discount_type text DEFAULT NULL,
  p_discount_justification text DEFAULT NULL,
  p_discount_approver text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_payload jsonb;
  v_previous jsonb;
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_mode text := NULLIF(btrim(p_discount_mode), '');
  v_type text := NULLIF(btrim(p_discount_type), '');
  v_value numeric(12,2) := CASE WHEN p_discount_value IS NULL THEN NULL ELSE round(p_discount_value, 2) END;
  v_discount_usd numeric(12,2) := 0;
  v_total_brl numeric(14,2);
  v_pix_payload text;
  v_result jsonb;
  v_justification text := NULLIF(btrim(p_discount_justification), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_financeiro_user()) THEN
    RAISE EXCEPTION 'Usuario sem permissao para aplicar desconto de Demurrage.' USING ERRCODE = '42501';
  END IF;
  IF p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Fatura obrigatoria.' USING ERRCODE = '22023';
  END IF;
  IF v_mode IS NOT NULL AND v_mode NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'Modo de desconto invalido.' USING ERRCODE = '22023';
  END IF;
  IF v_type IS NOT NULL AND v_type NOT IN ('comercial', 'datas', 'cortesia', 'acordo', 'erro') THEN
    RAISE EXCEPTION 'Tipo de desconto invalido.' USING ERRCODE = '22023';
  END IF;
  IF v_value IS NOT NULL AND v_value < 0 THEN
    RAISE EXCEPTION 'Desconto nao pode ser negativo.' USING ERRCODE = '22003';
  END IF;
  IF v_value IS NOT NULL AND v_mode IS NULL THEN
    RAISE EXCEPTION 'Modo de desconto obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF v_justification IS NULL THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para alterar desconto.' USING ERRCODE = '22023';
  END IF;

  v_payload := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'discount_mode', v_mode,
    'discount_value', v_value,
    'discount_type', v_type,
    'discount_justification', v_justification,
    'discount_approver', NULLIF(btrim(p_discount_approver), '')
  );
  v_previous := public._demurrage_mutation_request(p_request_id, 'discount', p_invoice_id, v_payload);
  IF v_previous IS NOT NULL THEN
    RETURN v_previous;
  END IF;

  SELECT * INTO v_invoice
  FROM public.demurrage_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demurrage invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;
  IF v_invoice.status IN ('paid', 'cancelled') OR v_invoice.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'Desconto nao pode alterar fatura paga ou cancelada.' USING ERRCODE = '22023';
  END IF;

  IF v_value IS NULL THEN
    v_discount_usd := 0;
    v_mode := NULL;
  ELSIF v_mode = 'percent' THEN
    IF v_value > 100 THEN
      RAISE EXCEPTION 'Percentual de desconto deve ficar entre 0 e 100.' USING ERRCODE = '22003';
    END IF;
    v_discount_usd := round(v_invoice.total_usd * v_value / 100, 2);
  ELSE
    IF v_value > v_invoice.total_usd THEN
      RAISE EXCEPTION 'Desconto fixo nao pode exceder o total USD da fatura.' USING ERRCODE = '22003';
    END IF;
    v_discount_usd := v_value;
  END IF;

  IF v_invoice.current_roe IS NOT NULL AND v_invoice.current_roe > 0 THEN
    v_total_brl := round(greatest(v_invoice.total_usd - v_discount_usd, 0) * v_invoice.current_roe, 2);
    v_pix_payload := CASE WHEN v_total_brl > 0 THEN public.build_transshipping_pix_payload(v_total_brl, v_invoice.doc_number) ELSE NULL END;
  ELSE
    v_total_brl := NULL;
    v_pix_payload := NULL;
  END IF;

  UPDATE public.demurrage_invoices
  SET discount_type = v_type,
      discount_value = CASE WHEN v_value IS NULL THEN NULL ELSE v_value END,
      discount_mode = v_mode,
      discount_justification = v_justification,
      discount_approver = NULLIF(btrim(p_discount_approver), ''),
      current_total_brl = v_total_brl,
      pix_payload = v_pix_payload,
      updated_at = now()
  WHERE id = p_invoice_id;

  IF v_total_brl IS NOT NULL THEN
    INSERT INTO public.demurrage_invoice_history
      (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
    VALUES
      (p_invoice_id, CURRENT_DATE, round(v_invoice.current_roe / 1.065, 4), v_invoice.current_roe,
       v_invoice.total_usd, v_total_brl, v_discount_usd, 'manual');
  END IF;

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, changed_at, justification
  ) VALUES (
    'demurrage_invoice', p_invoice_id::text, 'discount',
    jsonb_build_object('mode', v_invoice.discount_mode, 'value', v_invoice.discount_value)::text,
    v_payload::text, auth.uid(), now(), v_justification
  );

  v_result := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'discount_usd', v_discount_usd,
    'current_total_brl', v_total_brl,
    'pix_payload', v_pix_payload,
    'idempotent', false
  );
  INSERT INTO public.demurrage_mutation_requests(request_id, operation, invoice_id, request_payload, result, created_by)
  VALUES (p_request_id, 'discount', p_invoice_id, v_payload, v_result, auth.uid())
  ON CONFLICT (request_id) DO NOTHING;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_demurrage_invoice(
  p_request_id uuid,
  p_invoice_id bigint,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_payload jsonb := jsonb_build_object('invoice_id', p_invoice_id, 'reason', NULLIF(btrim(p_reason), ''));
  v_previous jsonb;
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Usuario sem permissao para cancelar Demurrage.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para cancelar a fatura.' USING ERRCODE = '22023';
  END IF;
  v_previous := public._demurrage_mutation_request(p_request_id, 'cancel', p_invoice_id, v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;

  SELECT * INTO v_invoice FROM public.demurrage_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demurrage invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002'; END IF;
  IF v_invoice.status = 'paid' THEN RAISE EXCEPTION 'Fatura paga deve ser estornada antes do cancelamento.' USING ERRCODE = '22023'; END IF;
  IF v_invoice.status = 'cancelled' THEN RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'cancelled', 'idempotent', true); END IF;

  UPDATE public.demurrage_invoices SET status = 'cancelled', updated_at = now() WHERE id = p_invoice_id;
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('demurrage_invoice', p_invoice_id::text, 'status', v_invoice.status, 'cancelled', auth.uid(), now(), btrim(p_reason));
  v_result := jsonb_build_object('invoice_id', p_invoice_id, 'status', 'cancelled', 'idempotent', false);
  INSERT INTO public.demurrage_mutation_requests(request_id, operation, invoice_id, request_payload, result, created_by)
  VALUES (p_request_id, 'cancel', p_invoice_id, v_payload, v_result, auth.uid()) ON CONFLICT (request_id) DO NOTHING;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_demurrage_invoice(
  p_request_id uuid,
  p_invoice_id bigint,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_payload jsonb := jsonb_build_object('invoice_id', p_invoice_id, 'reason', NULLIF(btrim(p_reason), ''));
  v_previous jsonb;
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Usuario sem permissao para reabrir Demurrage.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para reabrir a fatura.' USING ERRCODE = '22023';
  END IF;
  v_previous := public._demurrage_mutation_request(p_request_id, 'reopen', p_invoice_id, v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;
  SELECT * INTO v_invoice FROM public.demurrage_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demurrage invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002'; END IF;
  IF v_invoice.status <> 'paid' THEN RAISE EXCEPTION 'Apenas uma fatura paga pode ser reaberta.' USING ERRCODE = '22023'; END IF;

  UPDATE public.demurrage_invoices
  SET status = 'issued', paid_at = NULL, pix_txid = NULL, conciliated_by_extract = false, updated_at = now()
  WHERE id = p_invoice_id;
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('demurrage_invoice', p_invoice_id::text, 'status', 'paid', 'issued', auth.uid(), now(), btrim(p_reason));
  v_result := jsonb_build_object('invoice_id', p_invoice_id, 'status', 'issued', 'idempotent', false);
  INSERT INTO public.demurrage_mutation_requests(request_id, operation, invoice_id, request_payload, result, created_by)
  VALUES (p_request_id, 'reopen', p_invoice_id, v_payload, v_result, auth.uid()) ON CONFLICT (request_id) DO NOTHING;
  RETURN v_result;
END;
$$;

-- Wrapper legado: conserva o nome consumido pelo reconciliador, mas agora cada
-- baixa passa pelo mesmo guard tipado e pela mesma janela de fotos.
CREATE OR REPLACE FUNCTION public.confirm_demurrage_pix_matches(p_matches jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  r record;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao para conciliar Demurrage.' USING ERRCODE = '42501';
  END IF;
  IF p_matches IS NULL OR jsonb_typeof(p_matches) <> 'array' THEN
    RAISE EXCEPTION 'Lista de conciliacao invalida.' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM jsonb_to_recordset(p_matches) AS x(invoice_id bigint, paid_at date, pix_txid text, total_brl numeric, ptax_used numeric)
  LOOP
    PERFORM public.register_demurrage_payment(gen_random_uuid(), r.invoice_id, r.paid_at, r.pix_txid, r.total_brl, r.ptax_used);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public._demurrage_mutation_request(uuid, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_demurrage_payment(uuid, bigint, date, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_demurrage_discount(uuid, bigint, text, numeric, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_demurrage_invoice(uuid, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reopen_demurrage_invoice(uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_demurrage_payment(uuid, bigint, date, text, numeric, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_demurrage_discount(uuid, bigint, text, numeric, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_demurrage_invoice(uuid, bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reopen_demurrage_invoice(uuid, bigint, text) TO authenticated, service_role;

-- O historico segue append-only para authenticated. A fatura ainda pode ser
-- consultada, e seus campos operacionais continuam editaveis por patch seguro;
-- status, dinheiro, txid e payload so mudam pelos RPCs acima ou por outros
-- contratos de servidor.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.demurrage_invoices FROM authenticated;
GRANT UPDATE (
  due_date, roe, roe_manual, dispute_open, dispute_subject, dispute_reason,
  dispute_status, dispute_notes, notes
) ON TABLE public.demurrage_invoices TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.demurrage_invoice_history FROM authenticated;

