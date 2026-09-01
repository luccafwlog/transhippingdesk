-- 368: critério de portal em função única, recomputo do gate quando o portal
-- muda e remoção do hold que morria no rollback (revisão da issue #638).
--
-- A 367 endureceu o critério de prontidão de Portal dentro de
-- `compute_bl_review_pendencies`, mas deixou três brechas:
--
--   1. `reconcile_customer_bl_review_alerts` (364) carrega uma SEGUNDA cópia do
--      critério, ainda no formato frouxo da 337. Com a 367 aplicada, ela
--      RESOLVE o alerta `review_portal_not_ready` justamente para as contas que
--      a emissão passou a recusar — o operador perde o aviso do bloqueio que
--      acabou de ganhar. Aqui as duas passam a chamar
--      `public.customer_portal_access_ready`, função única do critério.
--   2. Nada recomputa `review_status`. Os triggers da 337 em
--      `customer_portal_accounts`/`customer_contacts` só reconciliam ALERTAS;
--      nunca escrevem `review_status`/`notes`. Logo (a) o B/L que ficou
--      `reviewed` sob o critério frouxo continua anunciado como pronto e só
--      descobre o bloqueio ao falhar na emissão, e (b) provisionar o portal não
--      liberava o B/L sem que alguém reabrisse a revisão. Esta migration cria
--      `public.recompute_bl_review_status`, passa a chamá-la nos triggers e faz
--      o backfill dos B/Ls já existentes.
--   3. `mark_bl_ready_for_billing` gravava `billing_hold_reason` e em seguida
--      levantava exceção na MESMA transação, sem handler em nenhum chamador: o
--      UPDATE sempre voltava no rollback. O hold do gate nunca existiu em
--      disco. Os UPDATEs mortos saem; o estado vivo das pendências continua
--      sendo `notes`, escrito pela `save_bl_review`, que é o que a tela lê.
--
-- Alcance: continua sendo a EMISSÃO. Nada aqui toca cálculo de taxas, CE
-- Mercante ou faturas já emitidas — B/L com `financial_status` faturado não é
-- recomputado nem volta para a fila de revisão.
--
-- Rollback: reaplicar o corpo da 367 (`compute_bl_review_pendencies`), o da 364
-- (`reconcile_customer_bl_review_alerts`), o da 337
-- (`trg_reconcile_bl_review_on_portal_change`) e o da 305
-- (`mark_bl_ready_for_billing`); depois `DROP FUNCTION
-- public.recompute_bl_review_status(TEXT), public.customer_portal_access_ready(BIGINT)`.
-- O backfill não se reverte sozinho: ele reescreve `review_status`/`notes` a
-- partir das pendências vigentes, e voltar o critério recomputa de novo.

-- 1. Critério único de prontidão do Portal (ADR 0054).
CREATE OR REPLACE FUNCTION public.customer_portal_access_ready(p_customer_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  -- `active` sozinho não basta: `account_situation` é a máquina de estados do
  -- provisionamento (178) e `recovery_email_status` é marcado pelo webhook de
  -- bounce/complaint (299), independente dela. Cliente que não recebe o e-mail
  -- não vê a fatura, que é o motivo de o gate existir.
  SELECT EXISTS (
    SELECT 1
    FROM public.customer_portal_accounts a
    WHERE a.customer_id = p_customer_id
      AND a.active = true
      AND a.account_situation = 'ativo'
      AND a.auth_user_id IS NOT NULL
      AND NULLIF(btrim(a.recovery_email), '') IS NOT NULL
      AND COALESCE(a.recovery_email_status, 'ok') = 'ok'
      AND NOT EXISTS (
        SELECT 1
        FROM public.portal_suppressed_emails s
        WHERE s.email = lower(btrim(a.recovery_email))
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.customer_portal_access_ready(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_portal_access_ready(BIGINT) TO service_role;

-- 2. Produtor canônico de pendências passa a consumir a função única.
CREATE OR REPLACE FUNCTION public.compute_bl_review_pendencies(
  p_customer_id BIGINT, p_cargo_mode TEXT, p_bb_weight_ton NUMERIC
)
RETURNS TEXT[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_reasons TEXT[] := ARRAY[]::TEXT[];
  v_has_email BOOLEAN := false;
BEGIN
  IF p_customer_id IS NULL THEN
    v_reasons := array_append(v_reasons, 'Cliente nao vinculado');
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.customer_contacts c
      WHERE c.customer_id = p_customer_id
        AND NULLIF(btrim(c.email), '') IS NOT NULL
    ) INTO v_has_email;

    IF NOT v_has_email THEN
      v_reasons := array_append(v_reasons, 'Cliente sem e-mail cadastrado');
    END IF;

    IF NOT public.customer_portal_access_ready(p_customer_id) THEN
      v_reasons := array_append(v_reasons, 'Acesso ao portal nao provisionado');
    END IF;
  END IF;

  IF p_cargo_mode = 'carga_solta'
     AND (p_bb_weight_ton IS NULL OR p_bb_weight_ton <= 0) THEN
    v_reasons := array_append(v_reasons, 'Peso BB ausente');
  END IF;

  RETURN v_reasons;
END;
$function$;

REVOKE ALL ON FUNCTION public.compute_bl_review_pendencies(BIGINT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_bl_review_pendencies(BIGINT, TEXT, NUMERIC) TO service_role;

-- 3. O alerta consolidado por cliente (364) perde a cópia do critério.

CREATE OR REPLACE FUNCTION public.reconcile_customer_bl_review_alerts(
  p_customer_id BIGINT,
  p_consignee TEXT,
  p_source TEXT DEFAULT 'bl_review_gate'
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_source TEXT := COALESCE(NULLIF(btrim(p_source), ''), 'bl_review_gate');
  v_customer_name TEXT;
  v_customer_label TEXT;
  v_entity_id TEXT;
  v_consignee_key TEXT;
  v_has_email BOOLEAN := false;
  v_portal_ready BOOLEAN := false;
  v_total_pending INTEGER := 0;
  v_bb_pending INTEGER := 0;
  v_msg TEXT;
BEGIN
  IF p_customer_id IS NOT NULL THEN
    SELECT name INTO v_customer_name FROM public.customers WHERE id = p_customer_id;
    v_customer_label := COALESCE(v_customer_name, 'Cliente #' || p_customer_id::TEXT);
    v_entity_id := p_customer_id::TEXT;

    SELECT EXISTS (
      SELECT 1 FROM public.customer_contacts c
      WHERE c.customer_id = p_customer_id
        AND NULLIF(btrim(c.email), '') IS NOT NULL
    ) INTO v_has_email;

    -- Mesmo critério do gate (ADR 0054): sem a função única, este alerta
    -- resolvia exatamente as contas que a emissão recusa.
    v_portal_ready := public.customer_portal_access_ready(p_customer_id);

    SELECT
      count(*),
      count(*) FILTER (WHERE cargo_mode = 'carga_solta' AND (bb_weight_ton IS NULL OR bb_weight_ton <= 0))
    INTO v_total_pending, v_bb_pending
    FROM public.bls
    WHERE customer_id = p_customer_id
      AND review_status = 'pending_review';

    -- 1. E-mail de contato ausente
    IF v_total_pending > 0 AND NOT v_has_email THEN
      v_msg := 'Cliente ' || v_customer_label || ': ' || v_total_pending ||
        CASE WHEN v_total_pending = 1 THEN ' B/L pendente de revisão (sem e-mail cadastrado)'
             ELSE ' B/Ls pendentes de revisão (sem e-mail cadastrado)' END;
      PERFORM public.upsert_alert_item(
        'review_customer_email_missing', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('customer_id', p_customer_id, 'pending_count', v_total_pending),
        '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_customer_email_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;

    -- 2. Conta de Portal não provisionada
    IF v_total_pending > 0 AND NOT v_portal_ready THEN
      v_msg := 'Cliente ' || v_customer_label || ': ' || v_total_pending ||
        CASE WHEN v_total_pending = 1 THEN ' B/L pendente (Conta de Portal não provisionada)'
             ELSE ' B/Ls pendentes (Conta de Portal não provisionada)' END;
      PERFORM public.upsert_alert_item(
        'review_portal_not_ready', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('customer_id', p_customer_id, 'pending_count', v_total_pending),
        '/clientes/portal?cliente=' || p_customer_id::TEXT
      );
    ELSE
      PERFORM public.resolve_alert_item('review_portal_not_ready', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;

    -- 3. Peso BB ausente
    IF v_bb_pending > 0 THEN
      v_msg := 'Cliente ' || v_customer_label || ': ' || v_bb_pending ||
        CASE WHEN v_bb_pending = 1 THEN ' B/L pendente de revisão (peso BB ausente)'
             ELSE ' B/Ls pendentes de revisão (peso BB ausente)' END;
      PERFORM public.upsert_alert_item(
        'review_breakbulk_weight_missing', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('customer_id', p_customer_id, 'pending_count', v_bb_pending),
        '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_breakbulk_weight_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;

    -- Para cliente já vinculado, não há pendência de vínculo
    PERFORM public.resolve_alert_item('review_customer_unlinked', 'customer', v_entity_id, v_source, '{}'::jsonb);

  ELSE
    -- B/Ls sem vínculo de cliente (chaveados por consignatário)
    v_consignee_key := COALESCE(NULLIF(btrim(p_consignee), ''), 'sem_cliente');
    v_entity_id := v_consignee_key;

    SELECT
      count(*),
      count(*) FILTER (WHERE cargo_mode = 'carga_solta' AND (bb_weight_ton IS NULL OR bb_weight_ton <= 0))
    INTO v_total_pending, v_bb_pending
    FROM public.bls
    WHERE customer_id IS NULL
      AND review_status = 'pending_review'
      AND COALESCE(NULLIF(btrim(consignee), ''), 'sem_cliente') = v_consignee_key;

    -- 1. Cliente não vinculado
    IF v_total_pending > 0 THEN
      v_msg := 'Cliente ' || v_consignee_key || ': ' || v_total_pending ||
        CASE WHEN v_total_pending = 1 THEN ' B/L pendente de vínculo com cliente'
             ELSE ' B/Ls pendentes de vínculo com cliente' END;
      PERFORM public.upsert_alert_item(
        'review_customer_unlinked', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('consignee', v_consignee_key, 'pending_count', v_total_pending),
        '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_customer_unlinked', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;

    -- 2. Peso BB ausente
    IF v_bb_pending > 0 THEN
      v_msg := 'Cliente ' || v_consignee_key || ': ' || v_bb_pending ||
        CASE WHEN v_bb_pending = 1 THEN ' B/L pendente de revisão (peso BB ausente)'
             ELSE ' B/Ls pendentes de revisão (peso BB ausente)' END;
      PERFORM public.upsert_alert_item(
        'review_breakbulk_weight_missing', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('consignee', v_consignee_key, 'pending_count', v_bb_pending),
        '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_breakbulk_weight_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;

    -- Para B/L sem cliente vinculado, e-mail e portal não se aplicam
    PERFORM public.resolve_alert_item('review_customer_email_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    PERFORM public.resolve_alert_item('review_portal_not_ready', 'customer', v_entity_id, v_source, '{}'::jsonb);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_customer_bl_review_alerts(BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_customer_bl_review_alerts(BIGINT, TEXT, TEXT) TO service_role;

-- 4. Recomputo do gate para um B/L, com a mesma regra da `save_bl_review`:
-- `review_status` derivado das pendências e a linha de notas mantida pela
-- máquina no fim, preservando as notas humanas.
CREATE OR REPLACE FUNCTION public.recompute_bl_review_status(p_bl_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_reasons TEXT[];
  v_status TEXT;
  v_human_notes TEXT;
  v_notes TEXT;
BEGIN
  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- O gate trava a emissão; não desfaz o que já foi emitido.
  IF COALESCE(v_bl.financial_status, '') IN ('invoiced', 'partially_paid', 'paid') THEN
    RETURN v_bl.review_status;
  END IF;

  -- Só os dois estados que o gate governa; qualquer outro fica fora do alcance.
  IF COALESCE(v_bl.review_status, '') NOT IN ('pending_review', 'reviewed') THEN
    RETURN v_bl.review_status;
  END IF;

  v_reasons := public.compute_bl_review_pendencies(p_bl_id);
  v_status := CASE
    WHEN COALESCE(cardinality(v_reasons), 0) = 0 THEN 'reviewed'
    ELSE 'pending_review'
  END;

  v_human_notes := btrim(
    regexp_replace(
      COALESCE(v_bl.notes, ''),
      E'(^|\\n)Pendencias de importacao:[^\\n]*$',
      '',
      'i'
    )
  );

  v_notes := CASE
    WHEN COALESCE(cardinality(v_reasons), 0) > 0 THEN concat_ws(
      E'\n',
      NULLIF(v_human_notes, ''),
      'Pendencias de importacao: ' || array_to_string(v_reasons, ', ')
    )
    ELSE NULLIF(v_human_notes, '')
  END;

  -- Sem mudança não se escreve: evita `updated_at` novo (e o conflito de edição
  -- concorrente na Revisão) a cada passagem do trigger.
  IF v_bl.review_status IS DISTINCT FROM v_status OR v_bl.notes IS DISTINCT FROM v_notes THEN
    UPDATE public.bls SET review_status = v_status, notes = v_notes WHERE id = p_bl_id;
  END IF;

  RETURN v_status;
END;
$function$;

REVOKE ALL ON FUNCTION public.recompute_bl_review_status(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_bl_review_status(TEXT) TO service_role;

-- 5. Mudança de portal ou de contato passa a recomputar o gate, não só o
-- alerta. É o que faz provisionar o portal liberar os B/Ls do cliente sem
-- intervenção manual, e o que faz o bloqueio aparecer quando a conta regride.
CREATE OR REPLACE FUNCTION public.trg_reconcile_bl_review_on_portal_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_customer_id BIGINT;
  v_bl_id TEXT;
BEGIN
  v_customer_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.customer_id ELSE NEW.customer_id END;
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR v_bl_id IN
    SELECT id FROM public.bls
    WHERE customer_id = v_customer_id
      AND review_status IN ('pending_review', 'reviewed')
      AND COALESCE(financial_status, '') NOT IN ('invoiced', 'partially_paid', 'paid')
  LOOP
    PERFORM public.recompute_bl_review_status(v_bl_id);
    PERFORM public.reconcile_bl_review_alerts(v_bl_id, 'portal_account_change');
  END LOOP;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NEW;
END;
$function$;

-- 6. Fronteira de emissão sem os UPDATEs que morriam no rollback.

CREATE OR REPLACE FUNCTION public.mark_bl_ready_for_billing(
  p_bl_id TEXT,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bl RECORD;
  v_pending_count INTEGER := 0;
  v_table_count INTEGER := 0;
  v_invoiceable_count INTEGER := 0;
  v_review_reasons TEXT[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  SELECT id, charge_status, pod, cargo_mode, customer_id, customer_reconciliation_status
  INTO v_bl FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.customer_id IS NULL THEN
    RAISE EXCEPTION 'B/L % nao possui cliente vinculado. Vincule um cliente antes de marcar como pronto para faturar.', p_bl_id USING ERRCODE = 'P0003';
  END IF;
  IF COALESCE(v_bl.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled') THEN
    RAISE EXCEPTION 'B/L exige reconciliacao manual antes do faturamento.' USING ERRCODE = '22023';
  END IF;

  v_review_reasons := public.compute_bl_review_pendencies(p_bl_id);
  IF COALESCE(cardinality(v_review_reasons), 0) > 0 THEN
    RAISE EXCEPTION 'B/L possui pendencias no gate de revisao: %', array_to_string(v_review_reasons, ', ') USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_pending_count FROM public.charge_calculations WHERE bl_id = p_bl_id AND status = 'review_required';
  IF v_pending_count > 0 THEN
    RAISE EXCEPTION 'Ainda existem linhas com pendencia de revisao' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_invoiceable_count
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id
    AND (COALESCE(total_value_brl, 0) > 0 OR COALESCE(total_value_usd, 0) > 0)
    AND COALESCE(status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');
  IF v_invoiceable_count = 0 THEN
    RAISE EXCEPTION 'B/L sem linhas faturaveis.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_table_count
  FROM public.charge_tables
  WHERE public.normalize_port_code(pod) = public.normalize_port_code(v_bl.pod)
    AND cargo_mode = v_bl.cargo_mode AND active = true;
  IF v_table_count = 0 THEN
    RAISE EXCEPTION
      'Nenhuma tabela de cobranca ativa para POD "%" (modo: %). Configure em /taxas-locais/tabelas antes de prosseguir.',
      v_bl.pod, v_bl.cargo_mode USING ERRCODE = 'P0004';
  END IF;

  UPDATE public.charge_calculations SET status = 'ready_for_billing' WHERE bl_id = p_bl_id AND status IN ('calculated', 'reviewed');
  UPDATE public.bls SET charge_status = 'ready_for_billing', billing_hold_reason = NULL WHERE id = p_bl_id;
  PERFORM public.sync_local_charge_receivable(p_bl_id);
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('bl', p_bl_id, 'charge_status', COALESCE(v_bl.charge_status, 'null'), 'ready_for_billing', auth.uid(), NOW(), 'Marcado como pronto para faturar no modulo de Taxas Locais');
  RETURN jsonb_build_object('bl_id', p_bl_id, 'status', 'ready_for_billing', 'changed', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_bl_ready_for_billing(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_bl_ready_for_billing(TEXT, UUID) TO authenticated;

-- 7. Backfill: alinha os B/Ls existentes ao critério vigente. Sem ele, todo B/L
-- que passou pelo gate frouxo continua anunciado como "pronto para emitir" e o
-- bloqueio novo nunca aparece para essa população.
DO $backfill$
DECLARE
  v_bl_id TEXT;
  v_before TEXT;
  v_after TEXT;
  v_changed INTEGER := 0;
BEGIN
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR v_bl_id, v_before IN
    SELECT id, review_status FROM public.bls
    WHERE review_status IN ('pending_review', 'reviewed')
      AND COALESCE(financial_status, '') NOT IN ('invoiced', 'partially_paid', 'paid')
  LOOP
    v_after := public.recompute_bl_review_status(v_bl_id);
    IF v_after IS DISTINCT FROM v_before THEN
      v_changed := v_changed + 1;
      PERFORM public.reconcile_bl_review_alerts(v_bl_id, 'portal_gate_backfill');
    END IF;
  END LOOP;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RAISE NOTICE 'Backfill do gate de revisao: % B/L(s) mudaram de review_status.', v_changed;
END;
$backfill$;
