-- 027: duas correcoes no caminho de dinheiro de Demurrage.
--
-- (A) capture_demurrage_calculation_snapshot (023): o gatilho aborta qualquer
--     UPDATE financeiro em demurrage_invoices, entao aplicar desconto falha com
--     'record "new" has no field "invoice_id"'. A causa e a resolucao do id na
--     secao DECLARE:
--
--       v_invoice_id bigint := CASE WHEN TG_TABLE_NAME = 'demurrage_invoice_items'
--         THEN COALESCE(NEW.invoice_id, OLD.invoice_id) ELSE COALESCE(NEW.id, OLD.id) END;
--
--     PL/pgSQL prepara a expressao inteira: as duas referencias de campo do
--     record sao resolvidas independentemente do ramo do CASE, e NEW nao tem
--     invoice_id quando o gatilho dispara na tabela de faturas. A resolucao
--     passa para IF/ELSE no corpo, onde so o ramo tomado e avaliado.
--
--     O DELETE de item NAO estava quebrado: verificado que passa com o corpo
--     original. O uso de TG_OP aqui e para nao depender de COALESCE sobre um
--     record nao atribuido, nao correcao de defeito observado.
--
-- (B) register_demurrage_payment (012): janela de fotos e procedencia da PTAX.
--     A 012 aceita QUALQUER foto de demurrage_invoice_history com
--     event_date <= data do extrato, bastando o valor bater. O contrato anterior
--     a esta remediacao ja era mais estrito: confirm_demurrage_pix_matches (002)
--     usa get_demurrage_recent_values, que limita as DUAS fotos mais recentes.
--     Aceitar a terceira deixa um extrato com cotacao antiga quitar a fatura.
--     A 012 tambem grava round(current_roe / 1.065, 4) como ptax_used quando a
--     fatura nao tem foto, inventando uma cotacao que nunca foi publicada
--     (#658 F9). Sem foto a procedencia e desconhecida e o historico registra
--     NULL -- a coluna ja aceita nulo desde a 023. Quem prova o dinheiro e o par
--     (total_brl, roe_used); ptax_used e procedencia.

-- (A) -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.capture_demurrage_calculation_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_invoice_id bigint;
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_items jsonb;
  v_inputs jsonb;
  v_result jsonb;
  v_hash text;
  v_ptax numeric;
  v_event_kind text := 'recalculation';
BEGIN
  -- Só o ramo tomado é avaliado: NEW não tem invoice_id na tabela de faturas e
  -- não está atribuído em DELETE.
  IF TG_TABLE_NAME = 'demurrage_invoice_items' THEN
    IF TG_OP = 'DELETE' THEN
      v_invoice_id := OLD.invoice_id;
    ELSE
      v_invoice_id := NEW.invoice_id;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_invoice_id := OLD.id;
    ELSE
      v_invoice_id := NEW.id;
    END IF;
  END IF;

  SELECT * INTO v_invoice
  FROM public.demurrage_invoices
  WHERE id = v_invoice_id;
  IF NOT FOUND OR v_invoice.status = 'draft' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.id), '[]'::jsonb)
    INTO v_items
  FROM (
    SELECT id, container_id, container_number, container_type, discharge_date,
           return_date, total_days, free_days, days_p1, rate_p1_usd,
           days_p2, rate_p2_usd, subtotal_usd
    FROM public.demurrage_invoice_items
    WHERE invoice_id = v_invoice_id
  ) AS item;

  IF v_invoice.roe_source = 'manual' THEN
    v_ptax := NULL;
  ELSE
    SELECT history.ptax_used INTO v_ptax
    FROM public.exchange_rate_reference_history AS history
    WHERE history.source = v_invoice.roe_source
      AND history.roe = v_invoice.current_roe
      AND history.effective_date <= COALESCE(v_invoice.updated_at::date, v_invoice.doc_date, CURRENT_DATE)
    ORDER BY history.effective_date DESC, history.id DESC
    LIMIT 1;
  END IF;

  IF TG_TABLE_NAME = 'demurrage_invoices' AND TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'paid' THEN
      v_event_kind := 'payment';
    ELSIF OLD.discount_value IS DISTINCT FROM NEW.discount_value
       OR OLD.discount_mode IS DISTINCT FROM NEW.discount_mode THEN
      v_event_kind := 'discount';
    END IF;
  ELSIF TG_TABLE_NAME = 'demurrage_invoice_items' AND TG_OP = 'INSERT'
        AND NOT EXISTS (
          SELECT 1 FROM public.demurrage_calculation_snapshots AS snapshot
          WHERE snapshot.demurrage_invoice_id = v_invoice_id
        ) THEN
    v_event_kind := 'initial';
  END IF;

  v_inputs := jsonb_build_object(
    'invoice_id', v_invoice.id,
    'bl_id', v_invoice.bl_id,
    'total_usd', v_invoice.total_usd,
    'discount_mode', v_invoice.discount_mode,
    'discount_value', v_invoice.discount_value,
    'current_roe', v_invoice.current_roe,
    'roe_source', v_invoice.roe_source,
    'ptax_used', v_ptax,
    'items', v_items
  );
  v_result := jsonb_build_object(
    'current_total_brl', v_invoice.current_total_brl,
    'pix_payload', v_invoice.pix_payload,
    'status', v_invoice.status
  );
  v_hash := encode(extensions.digest(v_inputs::text || v_result::text, 'sha256'), 'hex');

  INSERT INTO public.demurrage_calculation_snapshots(
    demurrage_invoice_id, calculation_version, input_hash,
    input_snapshot, result_snapshot, event_kind, created_by
  ) VALUES (
    v_invoice_id, 1, v_hash, v_inputs, v_result, v_event_kind, auth.uid()
  ) ON CONFLICT (demurrage_invoice_id, input_hash) DO NOTHING;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_demurrage_calculation_snapshot() FROM PUBLIC, anon, authenticated;

-- (B) -----------------------------------------------------------------------

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
  v_has_history boolean;
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

  SELECT EXISTS (
    SELECT 1 FROM public.demurrage_invoice_history AS h
    WHERE h.invoice_id = p_invoice_id AND h.event_date <= p_paid_at
  ) INTO v_has_history;

  IF v_has_history THEN
    -- A prova financeira vem da foto persistida, e a janela e a mesma do
    -- reconciliador: as DUAS fotos mais recentes ate a data do extrato.
    -- Uma cotacao mais antiga que isso e divergencia, nao quitacao.
    SELECT w.total_brl, w.ptax_used
      INTO v_match
    FROM public.get_demurrage_recent_values(p_invoice_id, p_paid_at) AS w
    WHERE p_total_brl IS NULL OR abs(w.total_brl - round(p_total_brl, 2)) <= 0.01
    ORDER BY w.event_date DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Valor divergente das duas ultimas fotos financeiras da Demurrage %.', p_invoice_id
        USING ERRCODE = '22003';
    END IF;

    v_total_brl := round(COALESCE(p_total_brl, v_match.total_brl), 2);
    v_ptax := v_match.ptax_used;
    -- O ROE da foto casada; get_demurrage_recent_values nao o projeta, entao
    -- ele vem da mesma linha pela chave (invoice, data, total).
    SELECT h.roe_used INTO v_roe
    FROM public.demurrage_invoice_history AS h
    WHERE h.invoice_id = p_invoice_id
      AND h.event_date <= p_paid_at
      AND h.total_brl = v_total_brl
    ORDER BY h.event_date DESC, h.id DESC
    LIMIT 1;
    v_roe := COALESCE(v_roe, v_invoice.current_roe);
  ELSE
    -- Legado sem foto: a propria fatura e a unica referencia disponivel. O ROE
    -- aplicado e conhecido; a PTAX que o originou, nao. Registrar NULL em vez
    -- de deduzir mantem o historico honesto (#658 F9).
    v_total_brl := round(COALESCE(p_total_brl, v_invoice.current_total_brl), 2);
    v_roe := v_invoice.current_roe;
    v_ptax := NULL;
    IF v_invoice.current_total_brl IS NULL
       OR p_total_brl IS NULL
       OR abs(v_invoice.current_total_brl - p_total_brl) > 0.01 THEN
      RAISE EXCEPTION 'Valor divergente da foto financeira da Demurrage %.', p_invoice_id USING ERRCODE = '22003';
    END IF;
  END IF;

  -- ptax_used e procedencia e pode faltar; o par (total_brl, roe_used) e que
  -- precisa ser pagavel. Uma PTAX presente, porem, tem de ser positiva.
  IF v_total_brl IS NULL OR v_total_brl <= 0 OR v_roe IS NULL OR v_roe <= 0 THEN
    RAISE EXCEPTION 'Fatura % nao possui uma foto financeira pagavel.', p_invoice_id USING ERRCODE = '22023';
  END IF;
  IF v_ptax IS NOT NULL AND v_ptax <= 0 THEN
    RAISE EXCEPTION 'Fatura % tem cotacao invalida na foto financeira.', p_invoice_id USING ERRCODE = '22023';
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

REVOKE ALL ON FUNCTION public.register_demurrage_payment(uuid, bigint, date, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_demurrage_payment(uuid, bigint, date, text, numeric, numeric) TO authenticated, service_role;
