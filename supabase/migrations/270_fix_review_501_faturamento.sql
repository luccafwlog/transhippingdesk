-- Correções da review da PR 501 (ADR 0038 - faturamento) sobre as migrations
-- 267 e 268. As migrations anteriores estão protegidas por
-- .claude/hooks/protect-files.sh (não editamos migrations já existentes no
-- histórico local); esta migration nova sobrescreve (CREATE OR REPLACE) as
-- funções afetadas e acrescenta uma guarda de dados em 267, seguindo a
-- convenção descrita em WORKFLOW.md (nunca editar migration já numerada,
-- sempre incrementar).

-- ---------------------------------------------------------------------------
-- Achado 8 (267_customer_rate_overrides_no_overlap.sql): daterange(valid_from,
-- valid_to, '[]') lança erro cru do Postgres em qualquer linha com
-- valid_from > valid_to, pois nada garantia essa ordem antes da pré-checagem
-- de sobreposição rodar. Acrescenta:
--   1. checagem explícita de dados existentes com valid_from > valid_to,
--      identificando as linhas ofensoras com uma mensagem clara;
--   2. um trigger BEFORE INSERT/UPDATE que valida a ordem antes de a linha
--      chegar a qualquer construção de daterange (pré-checagem ou EXCLUDE
--      constraint), trocando o erro cru do Postgres por um diagnóstico
--      legível também em inserções futuras.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad TEXT := '';
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT id, customer_id, charge_item_id, valid_from, valid_to
    FROM public.customer_rate_overrides
    WHERE valid_from IS NOT NULL
      AND valid_to IS NOT NULL
      AND valid_from > valid_to
  LOOP
    v_bad := v_bad || format(
      'id %s (customer_id=%s charge_item_id=%s valid_from=%s > valid_to=%s); ',
      v_row.id, v_row.customer_id, v_row.charge_item_id, v_row.valid_from, v_row.valid_to
    );
  END LOOP;

  IF v_bad <> '' THEN
    RAISE EXCEPTION 'customer_rate_overrides tem valid_from > valid_to; corrija manualmente antes de continuar: %', v_bad
      USING ERRCODE = '22023';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.customer_rate_overrides_validate_range()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.valid_from IS NOT NULL AND NEW.valid_to IS NOT NULL AND NEW.valid_from > NEW.valid_to THEN
    RAISE EXCEPTION 'valid_from (%) nao pode ser posterior a valid_to (%) em customer_rate_overrides (customer_id=%, charge_item_id=%)',
      NEW.valid_from, NEW.valid_to, NEW.customer_id, NEW.charge_item_id
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_customer_rate_overrides_validate_range ON public.customer_rate_overrides;
CREATE TRIGGER trg_customer_rate_overrides_validate_range
  BEFORE INSERT OR UPDATE ON public.customer_rate_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.customer_rate_overrides_validate_range();

-- ---------------------------------------------------------------------------
-- Achado 4 (268_..._usd_conversion_at_emission.sql):
-- create_local_consolidated_invoice_core congela o ROE em v_roe lendo
-- exchange_rate_reference NO MOMENTO DA CONSOLIDAÇÃO -- não o ROE que já
-- estava congelado em cada B/L quando ele foi para ready_for_billing (via
-- sync_local_charge_receivable). Se o ROE mudou entre os dois momentos,
-- bl_recon.detailed_sum (recalculado com o ROE novo) não bate mais com
-- bl_recon.subtotal_brl (congelado com o ROE antigo), e a reconciliação por
-- B/L falha silenciosamente, colapsando o detalhamento para uma linha
-- agregada -- justamente o que a etapa 1 tentava evitar.
--
-- Corrige guardando o ROE congelado em bl_receivables (colunas novas
-- roe_frozen / roe_effective_date_frozen, setadas por
-- sync_local_charge_receivable) e usando o ROE de CADA receivable ao montar
-- o detalhamento, em vez de um único v_roe global lido na consolidação.
-- ---------------------------------------------------------------------------
ALTER TABLE public.bl_receivables
  ADD COLUMN IF NOT EXISTS roe_frozen NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS roe_effective_date_frozen DATE;

CREATE OR REPLACE FUNCTION public.sync_local_charge_receivable(p_bl_id TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bl RECORD;
  v_amount NUMERIC(14,2);
  v_roe NUMERIC(10,4);
  v_roe_effective_date DATE;
  v_paid_amount NUMERIC(14,2);
  v_receivable_id BIGINT;
  v_status TEXT;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT id, customer_id, voyage_id, cargo_mode, pol, pod
  INTO v_bl
  FROM public.bls
  WHERE id = UPPER(TRIM(p_bl_id));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.customer_id IS NULL THEN
    RAISE EXCEPTION 'B/L % sem cliente vinculado.', p_bl_id USING ERRCODE = '22023';
  END IF;

  SELECT roe, effective_date INTO v_roe, v_roe_effective_date
  FROM public.exchange_rate_reference WHERE id = 1;

  IF v_roe IS NULL AND EXISTS (
    SELECT 1 FROM public.charge_calculations AS cc
    WHERE cc.bl_id = v_bl.id
      AND COALESCE(cc.total_value_usd, 0) > 0
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt')
  ) THEN
    RAISE EXCEPTION 'Cambio (ROE) nao configurado; nao e possivel calcular o saldo de linhas em USD.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(
    COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN ROUND(cc.total_value_usd * v_roe, 2) END, 0)
  ), 0)
  INTO v_amount
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = v_bl.id
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt');

  SELECT COALESCE(SUM(p.amount_brl), 0)
  INTO v_paid_amount
  FROM public.invoice_bls ib
  JOIN public.invoices i ON i.id = ib.invoice_id
  JOIN public.payments p ON p.invoice_id = i.id
  WHERE ib.bl_id = v_bl.id
    AND COALESCE(i.status, 'issued') = 'paid';

  v_paid_amount := LEAST(v_paid_amount, v_amount);
  v_status := CASE
    WHEN v_amount <= 0 THEN 'void'
    WHEN v_paid_amount >= v_amount THEN 'settled'
    WHEN v_paid_amount > 0 THEN 'partially_settled'
    ELSE 'open'
  END;

  INSERT INTO public.bl_receivables (
    bl_id, customer_id, source, original_amount_brl, settled_amount_brl, balance_brl,
    status, voyage_id, cargo_mode, pol, pod, roe_frozen, roe_effective_date_frozen, updated_at
  )
  VALUES (
    v_bl.id, v_bl.customer_id, 'local_charges', v_amount, v_paid_amount,
    GREATEST(v_amount - v_paid_amount, 0), v_status, v_bl.voyage_id,
    v_bl.cargo_mode, v_bl.pol, v_bl.pod, v_roe, v_roe_effective_date, now()
  )
  ON CONFLICT (source, bl_id)
  DO UPDATE SET
    customer_id = EXCLUDED.customer_id,
    original_amount_brl = EXCLUDED.original_amount_brl,
    settled_amount_brl = EXCLUDED.settled_amount_brl,
    balance_brl = EXCLUDED.balance_brl,
    status = EXCLUDED.status,
    voyage_id = EXCLUDED.voyage_id,
    cargo_mode = EXCLUDED.cargo_mode,
    pol = EXCLUDED.pol,
    pod = EXCLUDED.pod,
    roe_frozen = EXCLUDED.roe_frozen,
    roe_effective_date_frozen = EXCLUDED.roe_effective_date_frozen,
    updated_at = now()
  RETURNING id INTO v_receivable_id;

  RETURN v_receivable_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_local_charge_receivable(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_local_charge_receivable(TEXT) TO authenticated;

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
  v_missing_roe_count INTEGER;
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

  -- Achado 4 da review da PR 501: garante que todo receivable USD selecionado
  -- tem ROE congelado antes de montar o detalhamento (evita usar um ROE
  -- global "current" como fallback silencioso).
  SELECT COUNT(*)
  INTO v_missing_roe_count
  FROM public.bl_receivables br
  JOIN public.charge_calculations cc ON cc.bl_id = br.bl_id
  LEFT JOIN public.charge_table_items cti ON cti.id = cc.charge_item_id
  WHERE br.id = ANY(v_ids)
    AND br.roe_frozen IS NULL
    AND COALESCE(cti.currency, 'BRL') = 'USD'
    AND COALESCE(cc.total_value_usd, 0) > 0
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt');

  IF v_missing_roe_count > 0 THEN
    RAISE EXCEPTION 'Um ou mais receivables selecionados nao tem ROE congelado para linhas em USD; recalcule/atualize o B/L antes de consolidar.' USING ERRCODE = '22023';
  END IF;

  WITH links AS (
    SELECT l.bl_id, l.subtotal_brl, br.roe_frozen, br.roe_effective_date_frozen
    FROM public.invoice_receivable_links l
    JOIN public.bl_receivables br ON br.id = l.receivable_id
    WHERE l.invoice_id = v_invoice_id
  ),
  calcs AS (
    SELECT
      cc.bl_id, cc.id AS charge_calculation_id, cc.charge_table_id, cc.charge_item_id,
      cc.quantity,
      COALESCE(cc.unit_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.unit_value_usd, 0) * links.roe_frozen, 2) END) AS unit_value_brl,
      COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.total_value_usd, 0) * links.roe_frozen, 2) END, 0) AS total_value_brl,
      cti.currency,
      cc.unit_value_usd, cc.total_value_usd, cc.calculation_key, cti.name AS charge_name,
      links.roe_frozen, links.roe_effective_date_frozen
    FROM public.charge_calculations cc
    JOIN links ON links.bl_id = cc.bl_id
    LEFT JOIN public.charge_table_items cti ON cti.id = cc.charge_item_id
    WHERE (COALESCE(cc.total_value_brl, 0) > 0 OR COALESCE(cc.total_value_usd, 0) > 0)
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt')
  ),
  bl_recon AS (
    SELECT links.bl_id, links.subtotal_brl,
      COUNT(calcs.charge_calculation_id) AS calc_count,
      COALESCE(SUM(calcs.total_value_brl), 0) AS detailed_sum
    FROM links
    LEFT JOIN calcs ON calcs.bl_id = links.bl_id
    GROUP BY links.bl_id, links.subtotal_brl
  )
  INSERT INTO public.invoice_items (
    invoice_id, charge_calculation_id, description, quantity, unit_value_brl,
    total_value_brl, bl_id, charge_table_id, charge_item_id, source, currency,
    unit_value_usd, total_value_usd, calculation_key, snapshot_payload
  )
  SELECT
    v_invoice_id, calcs.charge_calculation_id,
    CONCAT('BL ', calcs.bl_id, ' - ', COALESCE(calcs.charge_name, calcs.calculation_key, 'Linha de taxa')),
    COALESCE(calcs.quantity, 1), calcs.unit_value_brl, calcs.total_value_brl,
    calcs.bl_id, calcs.charge_table_id, calcs.charge_item_id, 'ledger',
    COALESCE(calcs.currency, 'BRL'), calcs.unit_value_usd, calcs.total_value_usd,
    calcs.calculation_key,
    jsonb_build_object(
      'reconciled', true,
      'roe', CASE WHEN COALESCE(calcs.currency, 'BRL') = 'USD' THEN calcs.roe_frozen ELSE NULL END,
      'roe_effective_date', CASE WHEN COALESCE(calcs.currency, 'BRL') = 'USD' THEN calcs.roe_effective_date_frozen ELSE NULL END
    )
  FROM calcs
  JOIN bl_recon ON bl_recon.bl_id = calcs.bl_id
  WHERE bl_recon.calc_count > 0 AND ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01
  UNION ALL
  SELECT
    v_invoice_id, NULL, CONCAT('BL ', bl_recon.bl_id, ' - Taxas locais'),
    1, bl_recon.subtotal_brl, bl_recon.subtotal_brl,
    bl_recon.bl_id, NULL, NULL, 'ledger', 'BRL', NULL, NULL, NULL,
    jsonb_build_object('reconciled', false)
  FROM bl_recon
  WHERE NOT (bl_recon.calc_count > 0 AND ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01);

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

REVOKE ALL ON FUNCTION public.create_local_consolidated_invoice_core(bigint, bigint[], uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Achado 1 (268_..._usd_conversion_at_emission.sql):
-- create_invoice_from_bls_core grava invoice_bls.subtotal_brl como
-- SUM(cc.total_value_brl) -- NULL/0 para linhas 100% em USD, já que essas
-- linhas não populam total_value_brl. link_invoice_to_ledger usa esse
-- subtotal para SOBRESCREVER bl_receivables.original_amount_brl (que
-- sync_local_charge_receivable já tinha calculado certo), deixando um B/L
-- USD-only com receivable zerado mesmo com a fatura cobrando o valor
-- convertido. Corrige somando o MESMO valor convertido (ROE) que alimenta
-- invoice_items/invoices.total_brl.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_invoice_from_bls_core(
  p_bl_ids TEXT[],
  p_customer_id BIGINT,
  p_due_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_issue_now BOOLEAN DEFAULT true,
  p_actor UUID DEFAULT NULL,
  p_origin TEXT DEFAULT 'internal',
  p_portal_account_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requested_bls TEXT[];
  v_bl_count INTEGER;
  v_missing_bls TEXT;
  v_customer_id BIGINT;
  v_max_customer_id BIGINT;
  v_conflict_count INTEGER;
  v_usd_count INTEGER;
  v_invoice_id BIGINT;
  v_invoice_number TEXT;
  v_total_brl NUMERIC(14,2);
  v_item_count INTEGER;
  v_status TEXT;
  v_batch_id BIGINT;
  v_roe NUMERIC(10,4);
  v_roe_effective_date DATE;
BEGIN
  v_status := CASE WHEN COALESCE(p_issue_now, true) THEN 'issued' ELSE 'draft' END;

  SELECT ARRAY_AGG(DISTINCT UPPER(TRIM(bl_id)) ORDER BY UPPER(TRIM(bl_id)))
  INTO v_requested_bls
  FROM UNNEST(COALESCE(p_bl_ids, ARRAY[]::TEXT[])) AS input(bl_id)
  WHERE TRIM(COALESCE(bl_id, '')) <> '';

  IF COALESCE(ARRAY_LENGTH(v_requested_bls, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado para emissao.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.bls
  WHERE id = ANY(v_requested_bls)
  FOR UPDATE;

  SELECT COUNT(*) INTO v_bl_count
  FROM public.bls
  WHERE id = ANY(v_requested_bls);

  IF v_bl_count <> ARRAY_LENGTH(v_requested_bls, 1) THEN
    SELECT STRING_AGG(req.bl_id, ', ' ORDER BY req.bl_id)
    INTO v_missing_bls
    FROM UNNEST(v_requested_bls) AS req(bl_id)
    LEFT JOIN public.bls AS b ON b.id = req.bl_id
    WHERE b.id IS NULL;

    RAISE EXCEPTION 'B/L(s) nao encontrado(s): %', COALESCE(v_missing_bls, '-')
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = ANY(v_requested_bls)
      AND COALESCE(b.charge_status, 'not_calculated') <> 'ready_for_billing'
  ) THEN
    RAISE EXCEPTION 'Todos os B/Ls devem estar como ready_for_billing.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = ANY(v_requested_bls)
      AND COALESCE(b.financial_status, 'pending') <> 'pending'
  ) THEN
    RAISE EXCEPTION 'Existe B/L ja faturado/pago/cancelado na selecao.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = ANY(v_requested_bls)
      AND (b.customer_id IS NULL OR COALESCE(b.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled'))
  ) THEN
    RAISE EXCEPTION 'Todos os B/Ls precisam de cliente reconciliado para faturar.' USING ERRCODE = '22023';
  END IF;

  SELECT MIN(b.customer_id), MAX(b.customer_id)
  INTO v_customer_id, v_max_customer_id
  FROM public.bls AS b
  WHERE b.id = ANY(v_requested_bls);

  IF v_customer_id IS NULL OR v_customer_id <> v_max_customer_id THEN
    RAISE EXCEPTION 'Selecao contem B/Ls de clientes diferentes.' USING ERRCODE = '22023';
  END IF;

  IF p_customer_id IS NOT NULL AND p_customer_id <> v_customer_id THEN
    RAISE EXCEPTION 'Cliente informado nao corresponde aos B/Ls selecionados.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO v_conflict_count
  FROM public.invoice_bls AS ib
  JOIN public.invoices AS inv ON inv.id = ib.invoice_id
  WHERE ib.bl_id = ANY(v_requested_bls)
    AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue');

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Existe B/L vinculado a invoice ativa.' USING ERRCODE = '23505';
  END IF;

  SELECT COUNT(*)
  INTO v_usd_count
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = ANY(v_requested_bls)
    AND COALESCE(cc.total_value_usd, 0) > 0
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_usd_count > 0 THEN
    SELECT roe, effective_date INTO v_roe, v_roe_effective_date
    FROM public.exchange_rate_reference WHERE id = 1;

    IF v_roe IS NULL THEN
      RAISE EXCEPTION 'Cambio (ROE) nao configurado; nao e possivel converter linhas em USD para emitir a fatura.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF ARRAY_LENGTH(v_requested_bls, 1) > 1 THEN
    INSERT INTO public.billing_batches (
      customer_id,
      origin,
      status,
      notes,
      requested_by,
      portal_account_id
    )
    VALUES (
      v_customer_id,
      COALESCE(p_origin, 'internal'),
      'requested',
      NULLIF(TRIM(COALESCE(p_notes, '')), ''),
      p_actor,
      p_portal_account_id
    )
    RETURNING id INTO v_batch_id;
  END IF;

  INSERT INTO public.invoices (
    customer_id,
    bl_id,
    issued_at,
    due_date,
    total_brl,
    status,
    notes,
    total_paid_brl,
    balance_brl,
    issued_by
  )
  VALUES (
    v_customer_id,
    CASE WHEN ARRAY_LENGTH(v_requested_bls, 1) = 1 THEN v_requested_bls[1] ELSE NULL END,
    CASE WHEN v_status = 'issued' THEN now() ELSE NULL END,
    p_due_date,
    0,
    v_status,
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    0,
    0,
    p_actor
  )
  RETURNING id, invoice_number
  INTO v_invoice_id, v_invoice_number;

  INSERT INTO public.invoice_bls (
    invoice_id,
    bl_id,
    charge_status_snapshot,
    financial_status_snapshot,
    subtotal_brl,
    subtotal_usd
  )
  SELECT
    v_invoice_id,
    b.id,
    b.charge_status,
    b.financial_status,
    COALESCE(calc.total_brl, 0),
    COALESCE(calc.total_usd, 0)
  FROM public.bls AS b
  LEFT JOIN (
    -- Bug da review da PR 501 (achado 1): subtotal_brl precisa somar o MESMO
    -- valor convertido que alimenta invoice_items/invoices.total_brl (mesma
    -- conversao USD->BRL feita no INSERT de invoice_items abaixo), e nao
    -- apenas cc.total_value_brl -- que fica NULL para linhas em USD e
    -- deixava o subtotal do B/L zerado/nulo mesmo com fatura cobrando valor
    -- convertido. link_invoice_to_ledger usa esse subtotal para sobrescrever
    -- bl_receivables.original_amount_brl, entao um subtotal errado aqui
    -- zerava o receivable de B/Ls 100% em USD.
    SELECT
      cc.bl_id,
      SUM(COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.total_value_usd, 0) * v_roe, 2) END, 0)) AS total_brl,
      SUM(COALESCE(cc.total_value_usd, 0)) AS total_usd
    FROM public.charge_calculations AS cc
    LEFT JOIN public.charge_table_items AS cti ON cti.id = cc.charge_item_id
    WHERE cc.bl_id = ANY(v_requested_bls)
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt')
    GROUP BY cc.bl_id
  ) AS calc ON calc.bl_id = b.id
  WHERE b.id = ANY(v_requested_bls);

  INSERT INTO public.invoice_items (
    invoice_id,
    charge_calculation_id,
    description,
    quantity,
    unit_value_brl,
    total_value_brl,
    bl_id,
    manifest_id,
    charge_table_id,
    charge_item_id,
    source,
    currency,
    unit_value_usd,
    total_value_usd,
    pricing_rule_version_id,
    billing_run_id,
    calculation_key,
    snapshot_payload
  )
  SELECT
    v_invoice_id,
    cc.id,
    CONCAT('BL ', cc.bl_id, ' - ', COALESCE(cti.name, cc.calculation_key, 'Linha de taxa')),
    COALESCE(cc.quantity, 1),
    COALESCE(cc.unit_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.unit_value_usd, 0) * v_roe, 2) END, 0),
    COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.total_value_usd, 0) * v_roe, 2) END, 0),
    cc.bl_id,
    cc.manifest_id,
    cc.charge_table_id,
    cc.charge_item_id,
    cc.source,
    COALESCE(cti.currency, CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN 'USD' ELSE 'BRL' END),
    cc.unit_value_usd,
    cc.total_value_usd,
    cc.pricing_rule_version_id,
    cc.billing_run_id,
    cc.calculation_key,
    jsonb_build_object(
      'manifest_id', cc.manifest_id,
      'bl_id', cc.bl_id,
      'charge_table_id', cc.charge_table_id,
      'charge_item_id', cc.charge_item_id,
      'source', cc.source,
      'currency', COALESCE(cti.currency, CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN 'USD' ELSE 'BRL' END),
      'pricing_rule_version_id', cc.pricing_rule_version_id,
      'calculation_key', cc.calculation_key,
      'charge_name', cti.name,
      'roe', CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN v_roe ELSE NULL END,
      'roe_effective_date', CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN v_roe_effective_date ELSE NULL END
    )
  FROM public.charge_calculations AS cc
  LEFT JOIN public.charge_table_items AS cti ON cti.id = cc.charge_item_id
  WHERE cc.bl_id = ANY(v_requested_bls)
    AND (COALESCE(cc.total_value_brl, 0) > 0 OR COALESCE(cc.total_value_usd, 0) > 0)
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt');

  GET DIAGNOSTICS v_item_count = ROW_COUNT;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Nenhuma linha BRL elegivel para faturamento.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(total_value_brl), 0)
  INTO v_total_brl
  FROM public.invoice_items
  WHERE invoice_id = v_invoice_id;

  UPDATE public.invoices
  SET
    total_brl = v_total_brl,
    total_paid_brl = 0,
    balance_brl = v_total_brl
  WHERE id = v_invoice_id;

  IF v_status = 'issued' THEN
    UPDATE public.bls
    SET financial_status = 'invoiced'
    WHERE id = ANY(v_requested_bls);
  END IF;

  IF v_batch_id IS NOT NULL THEN
    UPDATE public.billing_batches
    SET
      status = CASE WHEN v_status = 'issued' THEN 'issued' ELSE 'requested' END,
      invoice_id = v_invoice_id,
      notes = NULLIF(TRIM(COALESCE(p_notes, '')), '')
    WHERE id = v_batch_id;
  END IF;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
  )
  VALUES (
    'invoice',
    v_invoice_id::TEXT,
    'create_invoice',
    NULL,
    CONCAT('invoice=', v_invoice_number, ' | bl_count=', ARRAY_LENGTH(v_requested_bls, 1), ' | total=', v_total_brl),
    p_actor,
    now(),
    CASE WHEN COALESCE(p_origin, 'internal') = 'portal' THEN 'Emissao consolidada via portal do cliente' ELSE 'Emissao de invoice por B/L' END
  );

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'status', v_status,
    'customer_id', v_customer_id,
    'bl_count', ARRAY_LENGTH(v_requested_bls, 1),
    'total_brl', v_total_brl,
    'balance_brl', v_total_brl,
    'billing_batch_id', v_batch_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Achado 3 (blFreightImport.ts:330 chama calculateProvisionalLocalCharges no
-- import, que chama calculate_bl_local_charges -- migration 266/269, achado
-- da review da PR 501): a Etapa 4 (calculo automatico no import) combinada
-- com a Etapa 9 (ETA da escala do POD como UNICA referencia, sem fallback)
-- fazia todo B/L importado antes de a ETA da escala ser salva manualmente
-- cair em review:no_eta / charge_status='review_required' -- mesmo quando a
-- viagem ja tinha uma ETA geral conhecida (voyages.eta, populada na criacao
-- da viagem/escala unificada, migration 478-ish -- distinta do snapshot por
-- POD em voyages.pod_schedule_snapshot). Adiciona fallback: se o snapshot do
-- POD nao tiver uma ETA valida ainda, usa voyages.eta antes de marcar
-- review:no_eta. Redefine a versao final da funcao (a de
-- 269_rateio_rounding_last_share_absorbs_diff.sql).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_bl_local_charges(
  p_bl_id TEXT,
  p_actor UUID DEFAULT NULL,
  p_recalculate BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bl RECORD;
  v_table_id BIGINT;
  v_ref_date DATE;
  v_actor UUID;
  v_has_vehicles BOOLEAN := false;
  v_is_exempt BOOLEAN := false;
  v_is_lcl_movement BOOLEAN := false;
  v_auto_review BOOLEAN := false;
  v_line_count INTEGER := 0;
  v_total_brl NUMERIC(14,2) := 0;
  v_total_usd NUMERIC(14,2) := 0;
  v_status TEXT := 'calculated';
  v_reason TEXT := NULL;
  v_qty_total NUMERIC(12,6) := 0;
  v_qty_std NUMERIC(12,6) := 0;
  v_qty_imo NUMERIC(12,6) := 0;
  v_qty_oog NUMERIC(12,6) := 0;
  v_qty_dual NUMERIC(12,6) := 0;
  v_container_shares JSONB;
  v_weight_ton NUMERIC(12,3) := 0;
  item RECORD;
  v_qty NUMERIC(12,6);
  v_unit_brl NUMERIC(12,2);
  v_unit_usd NUMERIC(12,2);
  v_total_line_brl NUMERIC(14,2);
  v_total_line_usd NUMERIC(14,2);
  v_is_thd BOOLEAN;
  v_override BOOLEAN;
  v_calculation_key TEXT;
  v_no_containers BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  SELECT
    b.id,
    b.voyage_id,
    b.batch_id,
    COALESCE(b.cargo_mode, 'container') AS cargo_mode,
    b.customer_id,
    b.pod,
    NULLIF((to_jsonb(b)->>'bb_weight_ton'), '')::NUMERIC AS bb_weight_ton,
    b.total_weight_kg,
    b.movement_to,
    b.created_at,
    b.financial_status,
    ib.uploaded_at
  INTO v_bl
  FROM public.bls AS b
  LEFT JOIN public.import_batches AS ib ON ib.id = b.batch_id
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- Etapa 2 do plano de faturamento (ADR 0038, achado 6): a mesma trava que
  -- ja existe no service (chargeOperationsService.ts, checagem previa via
  -- bls.financial_status) agora tambem vive na RPC, para cobrir chamada
  -- direta fora do app.
  IF v_bl.financial_status IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % ja foi faturado (status financeiro=%); recalculo bloqueado. Cancele e reemita a fatura para corrigir.', p_bl_id, v_bl.financial_status USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  IF p_recalculate THEN
    DELETE FROM public.charge_calculations
    WHERE bl_id = p_bl_id
      AND COALESCE(source, 'auto') = 'auto';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.vehicles WHERE bl_id = p_bl_id)
  INTO v_has_vehicles;

  -- Etapa 8 do plano de faturamento (ADR 0038, achados 8 e 10): a isencao de
  -- veiculo exige prova positiva de LCL no destino -- ausencia ou notacao
  -- irreconhecida em movement_to cobra normalmente, ao contrario do padrao
  -- "parar e sinalizar" da etapa 7 (aqui o padrao ja e cobrar). O motor para
  -- de escrever container_load_type: antes, qualquer B/L de container com
  -- veiculo virava LCL por escrita propria e passava na checagem seguinte,
  -- isentando 100% dos B/Ls com veiculo independentemente do movimento real.
  v_is_lcl_movement := v_bl.movement_to IS NOT NULL AND (
    UPPER(TRIM(v_bl.movement_to)) LIKE '%LCL%' OR UPPER(TRIM(v_bl.movement_to)) LIKE '%CFS%'
  );

  IF v_bl.cargo_mode = 'container' AND v_has_vehicles AND v_is_lcl_movement THEN
    v_is_exempt := true;
    v_reason := 'Carga de veiculos / LCL no destino (movement_to=' || v_bl.movement_to || ') com taxas pagas na origem';

    INSERT INTO public.charge_calculations (
      bl_id, source, status, calculation_key, quantity,
      unit_value_brl, total_value_brl, notes, review_reason, created_by, calculated_at
    )
    VALUES (
      p_bl_id, 'auto', 'exempt', 'exempt:lcl_vehicle', 1,
      0, 0, 'Linha sintetica de isencao', v_reason, v_actor, NOW()
    )
    ON CONFLICT (bl_id, calculation_key) DO UPDATE
      SET status = EXCLUDED.status,
          quantity = EXCLUDED.quantity,
          unit_value_brl = EXCLUDED.unit_value_brl,
          total_value_brl = EXCLUDED.total_value_brl,
          notes = EXCLUDED.notes,
          review_reason = EXCLUDED.review_reason,
          created_by = EXCLUDED.created_by,
          calculated_at = NOW();

    UPDATE public.bls
    SET
      charge_status = 'exempt',
      charges_calculated_at = NOW(),
      charge_exemption_reason = v_reason,
      billing_hold_reason = NULL
    WHERE id = p_bl_id;

    RETURN jsonb_build_object(
      'bl_id', p_bl_id,
      'status', 'exempt',
      'table_id', NULL,
      'line_count', 1,
      'total_brl', 0,
      'total_usd', 0,
      'review_required', false,
      'exempt', true,
      'reason', v_reason
    );
  END IF;

  -- Etapa 9 do plano de faturamento (ADR 0038, decisao 3, achado 4): a data
  -- de referencia da tarifa (tabela de taxas e Condicao de Cliente) deixa de
  -- ser uploaded_at/created_at do lote de importacao e passa a ser a ETA da
  -- escala do POD do B/L (voyages.pod_schedule_snapshot, chave = POD). Duas
  -- ancoras alternando faziam o mesmo B/L dar precos diferentes em
  -- recalculos diferentes. ETA ausente vira pendencia de revisao, nao
  -- fallback -- sem ela nao ha tabela nem override resolvidos.
  -- Achado da review da PR 501: pod_schedule_snapshot vem de new_value TEXT
  -- de uma tabela de auditoria (046_voyage_schedule_snapshot_trigger.sql) que
  -- nunca valida formato -- nem o proprio leitor do app (normalizeDateValue
  -- em voyageRouteSchedules.ts) faz mais que trim. Um ::DATE cru sobre isso
  -- estoura em texto malformado, e esta funcao nao tem EXCEPTION handler, o
  -- que derrubaria o calculo do B/L inteiro (e do lote, ja que a Etapa 4
  -- chama isso automaticamente no import) em vez de virar review:no_eta como
  -- o padrao "parar e sinalizar" da Etapa 7 pede. Valida o formato ISO antes
  -- de converter; texto fora do padrao vira NULL, mesmo caminho do ETA
  -- ausente.
  SELECT v_eta_raw.eta_text::DATE
  INTO v_ref_date
  FROM public.voyages AS v
  CROSS JOIN LATERAL (
    SELECT NULLIF(TRIM(v.pod_schedule_snapshot -> v_bl.pod ->> 'eta'), '') AS eta_text
  ) AS v_eta_raw
  WHERE v.id = v_bl.voyage_id
    AND v_eta_raw.eta_text ~ '^\d{4}-\d{2}-\d{2}$';

  -- Achado 3 da review da PR 501: a Etapa 4 chama este calculo
  -- automaticamente NO IMPORT do B/L, antes de qualquer usuario abrir o modal
  -- da escala e salvar a ETA manualmente -- pod_schedule_snapshot so e
  -- populado nesse momento posterior (046_voyage_schedule_snapshot_trigger.sql).
  -- Sem fallback, TODO B/L importado antes disso caia sempre em
  -- review:no_eta, mesmo quando a viagem ja tem uma ETA geral conhecida.
  -- Cai para voyages.eta (ETA geral da viagem, distinta do snapshot por
  -- escala) quando o snapshot do POD ainda nao existe/nao tem ETA valida;
  -- so vira review:no_eta quando NENHUMA das duas fontes tem data.
  IF v_ref_date IS NULL THEN
    SELECT v.eta::DATE
    INTO v_ref_date
    FROM public.voyages AS v
    WHERE v.id = v_bl.voyage_id
      AND v.eta IS NOT NULL;
  END IF;

  IF v_ref_date IS NULL THEN
    v_auto_review := true;
    INSERT INTO public.charge_calculations (
      bl_id, source, status, calculation_key, quantity, total_value_brl,
      review_reason, notes, created_by, calculated_at
    )
    VALUES (
      p_bl_id, 'auto', 'review_required', 'review:no_eta', 1, 0,
      'ETA da escala do POD ausente; nao ha data de referencia para a tarifa', 'Revisao manual obrigatoria', v_actor, NOW()
    )
    ON CONFLICT (bl_id, calculation_key) DO UPDATE
      SET status = EXCLUDED.status,
          quantity = EXCLUDED.quantity,
          total_value_brl = EXCLUDED.total_value_brl,
          review_reason = EXCLUDED.review_reason,
          notes = EXCLUDED.notes,
          created_by = EXCLUDED.created_by,
          calculated_at = NOW();
  END IF;

  IF v_ref_date IS NOT NULL THEN
    v_table_id := public.resolve_local_charge_table_id(v_bl.cargo_mode, v_bl.pod, v_ref_date);

    IF v_table_id IS NULL THEN
      v_reason := 'Nao existe tabela ativa para POD/mode na data de referencia (ETA da escala)';
      v_auto_review := true;

      INSERT INTO public.charge_calculations (
        bl_id, source, status, calculation_key, quantity, total_value_brl,
        review_reason, notes, created_by, calculated_at
      )
      VALUES (
        p_bl_id, 'auto', 'review_required', 'review:no_table', 1, 0,
        v_reason, 'Revisao manual obrigatoria', v_actor, NOW()
      )
      ON CONFLICT (bl_id, calculation_key) DO UPDATE
        SET status = EXCLUDED.status,
            quantity = EXCLUDED.quantity,
            total_value_brl = EXCLUDED.total_value_brl,
            review_reason = EXCLUDED.review_reason,
            notes = EXCLUDED.notes,
            created_by = EXCLUDED.created_by,
            calculated_at = NOW();
    END IF;
  END IF;

  IF v_bl.cargo_mode = 'container' THEN
    WITH current_containers AS (
      SELECT
        UPPER(TRIM(bc.container_number)) AS cn,
        BOOL_OR(COALESCE(bc.is_imo, false)) AS has_imo,
        BOOL_OR(COALESCE(bc.is_oog, false)) AS has_oog
      FROM public.bl_containers AS bc
      WHERE bc.bl_id = p_bl_id
        AND TRIM(COALESCE(bc.container_number, '')) <> ''
      GROUP BY UPPER(TRIM(bc.container_number))
    ),
    shares AS (
      SELECT
        cc.cn,
        cc.has_imo,
        cc.has_oog,
        sh.share_count,
        sh.last_bl_id
      FROM current_containers AS cc
      JOIN LATERAL (
        SELECT
          COUNT(DISTINCT b2.id)::NUMERIC AS share_count,
          MAX(b2.id) AS last_bl_id
        FROM public.bls AS b2
        JOIN public.bl_containers AS bc2 ON bc2.bl_id = b2.id
        WHERE b2.voyage_id = v_bl.voyage_id
          AND COALESCE(b2.cargo_mode, 'container') = 'container'
          AND UPPER(TRIM(COALESCE(bc2.container_number, ''))) = cc.cn
      ) AS sh ON TRUE
    )
    SELECT
      COALESCE(SUM(CASE WHEN share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN NOT has_imo AND NOT has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_imo AND NOT has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_oog AND NOT has_imo AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_imo AND has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      -- Etapa 13 do plano de faturamento (achado 9): guarda o grupo de rateio
      -- (classificacao, quantos B/Ls dividem o container e se este B/L e o
      -- ultimo do grupo por bl_id) para o loop de itens corrigir o
      -- arredondamento por container em vez de por quantidade agregada --
      -- ROUND(qty_agregada * rate, 2) perde centavo quando ha mais de um
      -- container com tamanhos de grupo diferentes (ex.: R$100/3 = R$33,33 em
      -- cada um dos 3 B/Ls, soma R$99,99). O ultimo B/L do grupo (maior
      -- bl_id, ordem estavel e deterministica) absorve a diferenca.
      jsonb_agg(jsonb_build_object(
        'has_imo', has_imo,
        'has_oog', has_oog,
        'share_count', share_count,
        'is_last', (p_bl_id = last_bl_id)
      )) FILTER (WHERE share_count > 0)
    INTO v_qty_total, v_qty_std, v_qty_imo, v_qty_oog, v_qty_dual, v_container_shares
    FROM shares;

    IF v_qty_dual > 0 THEN
      v_auto_review := true;
      INSERT INTO public.charge_calculations (
        bl_id, charge_table_id, source, status, calculation_key, quantity,
        total_value_brl, review_reason, notes, created_by, calculated_at
      )
      VALUES (
        p_bl_id, v_table_id, 'auto', 'review_required', 'review:imo_oog_thd', v_qty_dual,
        0, 'Container com IMO e OOG ao mesmo tempo exige revisao manual de THD', 'THD nao calculado automaticamente', v_actor, NOW()
      )
      ON CONFLICT (bl_id, calculation_key) DO UPDATE
        SET
          status = EXCLUDED.status,
          quantity = EXCLUDED.quantity,
          total_value_brl = EXCLUDED.total_value_brl,
          review_reason = EXCLUDED.review_reason,
          notes = EXCLUDED.notes,
          created_by = EXCLUDED.created_by,
          calculated_at = NOW();
    END IF;
  END IF;

  -- Etapa 7 do plano de faturamento (ADR 0038 decisao 7, achado 1): B/L de
  -- container sem nenhum container cadastrado nunca deve cobrar zero em
  -- silencio (o COALESCE(v_qty,0)<=0 THEN CONTINUE do loop de itens pularia
  -- toda linha container_distinct_voyage sem avisar ninguem). Sinaliza uma
  -- vez por B/L, nao por item.
  IF v_bl.cargo_mode = 'container' THEN
    SELECT NOT EXISTS(
      SELECT 1 FROM public.bl_containers AS bc
      WHERE bc.bl_id = p_bl_id AND TRIM(COALESCE(bc.container_number, '')) <> ''
    ) INTO v_no_containers;

    IF v_no_containers THEN
      v_auto_review := true;
      INSERT INTO public.charge_calculations (
        bl_id, charge_table_id, source, status, calculation_key, quantity,
        total_value_brl, review_reason, notes, created_by, calculated_at
      )
      VALUES (
        p_bl_id, v_table_id, 'auto', 'review_required', 'review:no_containers', 1,
        0, 'B/L de container sem containers cadastrados', 'Revisao manual obrigatoria', v_actor, NOW()
      )
      ON CONFLICT (bl_id, calculation_key) DO UPDATE
        SET
          status = EXCLUDED.status,
          quantity = EXCLUDED.quantity,
          total_value_brl = EXCLUDED.total_value_brl,
          review_reason = EXCLUDED.review_reason,
          notes = EXCLUDED.notes,
          created_by = EXCLUDED.created_by,
          calculated_at = NOW();
    END IF;
  END IF;

  IF v_table_id IS NOT NULL THEN
    FOR item IN
      SELECT
        cti.id,
        cti.name,
        cti.category,
        cti.application_basis,
        COALESCE(cti.cargo_profile, 'any') AS cargo_profile,
        COALESCE(cti.currency, 'BRL') AS currency,
        cti.unit_value_brl,
        cti.unit_value_usd,
        ov.override_value
      FROM public.charge_table_items AS cti
      LEFT JOIN LATERAL (
        SELECT cro.override_value
        FROM public.customer_rate_overrides AS cro
        WHERE cro.customer_id = v_bl.customer_id
          AND cro.charge_item_id = cti.id
          AND (cro.valid_from IS NULL OR cro.valid_from <= v_ref_date)
          AND (cro.valid_to IS NULL OR cro.valid_to >= v_ref_date)
        -- Etapa 10 do plano de faturamento (ADR 0038 decisao 5, achado 5):
        -- customer_rate_overrides_no_overlap (migration 267) garante que no
        -- maximo uma linha bate aqui, entao o desempate por created_at nao
        -- tem mais funcao. LIMIT 1 fica como rede de seguranca defensiva.
        LIMIT 1
      ) AS ov ON TRUE
      WHERE cti.charge_table_id = v_table_id
        AND COALESCE(cti.active, true)
        AND NOT COALESCE(cti.manual_only, false)
      ORDER BY COALESCE(cti.sort_order, 100), cti.id
    LOOP
      v_qty := 0;
      v_is_thd := UPPER(COALESCE(item.name, '')) LIKE 'THD%';

      IF item.application_basis = 'bl' THEN
        v_qty := 1;
      ELSIF item.application_basis = 'weight_ton' THEN
        v_weight_ton := COALESCE(v_bl.bb_weight_ton, CASE WHEN v_bl.total_weight_kg IS NULL THEN NULL ELSE v_bl.total_weight_kg / 1000 END, 0);
        IF v_weight_ton <= 0 THEN
          v_auto_review := true;
          INSERT INTO public.charge_calculations (
            bl_id, charge_table_id, charge_item_id, source, status, calculation_key, quantity,
            total_value_brl, review_reason, notes, created_by, calculated_at
          )
          VALUES (
            p_bl_id, v_table_id, item.id, 'auto', 'review_required',
            CONCAT('review:weight_missing:', item.id), 0,
            0, 'Weight ton ausente/invalido para calculo', 'Revisao manual obrigatoria', v_actor, NOW()
          )
          ON CONFLICT (bl_id, calculation_key) DO UPDATE
            SET
              status = EXCLUDED.status,
              quantity = EXCLUDED.quantity,
              total_value_brl = EXCLUDED.total_value_brl,
              review_reason = EXCLUDED.review_reason,
              notes = EXCLUDED.notes,
              created_by = EXCLUDED.created_by,
              calculated_at = NOW();
          CONTINUE;
        END IF;
        v_qty := v_weight_ton;
      ELSIF item.application_basis = 'container_distinct_voyage' THEN
        IF v_bl.cargo_mode = 'container' THEN
          IF v_is_thd THEN
            IF item.cargo_profile = 'standard' THEN
              v_qty := v_qty_std;
            ELSIF item.cargo_profile = 'imo' THEN
              v_qty := v_qty_imo;
            ELSIF item.cargo_profile = 'oog' THEN
              v_qty := v_qty_oog;
            ELSE
              -- Etapa 7 (achado 1): THD com cargo_profile 'any' e um item mal
              -- cadastrado (o motor so sabe distinguir standard/imo/oog) -- para
              -- e sinaliza em vez de cobrar zero.
              v_auto_review := true;
              INSERT INTO public.charge_calculations (
                bl_id, charge_table_id, charge_item_id, source, status, calculation_key, quantity,
                total_value_brl, review_reason, notes, created_by, calculated_at
              )
              VALUES (
                p_bl_id, v_table_id, item.id, 'auto', 'review_required',
                CONCAT('review:thd_any_profile:', item.id), 0,
                0, 'Item THD cadastrado com perfil de carga ''any''; motor so calcula standard/imo/oog', 'Revisao manual obrigatoria', v_actor, NOW()
              )
              ON CONFLICT (bl_id, calculation_key) DO UPDATE
                SET
                  status = EXCLUDED.status,
                  quantity = EXCLUDED.quantity,
                  total_value_brl = EXCLUDED.total_value_brl,
                  review_reason = EXCLUDED.review_reason,
                  notes = EXCLUDED.notes,
                  created_by = EXCLUDED.created_by,
                  calculated_at = NOW();
              CONTINUE;
            END IF;
          ELSE
            v_qty := v_qty_total;
          END IF;
        ELSE
          v_qty := 0;
        END IF;
      ELSE
        -- Etapa 7 (achado 1): application_basis sem implementacao no motor
        -- (ex.: 'teu') -- para e sinaliza em vez de cobrar zero em silencio.
        v_auto_review := true;
        INSERT INTO public.charge_calculations (
          bl_id, charge_table_id, charge_item_id, source, status, calculation_key, quantity,
          total_value_brl, review_reason, notes, created_by, calculated_at
        )
        VALUES (
          p_bl_id, v_table_id, item.id, 'auto', 'review_required',
          CONCAT('review:unsupported_basis:', item.id), 0,
          0, CONCAT('Base de aplicacao nao suportada pelo motor: ', COALESCE(item.application_basis, '(vazia)')), 'Revisao manual obrigatoria', v_actor, NOW()
        )
        ON CONFLICT (bl_id, calculation_key) DO UPDATE
          SET
            status = EXCLUDED.status,
            quantity = EXCLUDED.quantity,
            total_value_brl = EXCLUDED.total_value_brl,
            review_reason = EXCLUDED.review_reason,
            notes = EXCLUDED.notes,
            created_by = EXCLUDED.created_by,
            calculated_at = NOW();
        CONTINUE;
      END IF;

      IF COALESCE(v_qty, 0) <= 0 THEN
        CONTINUE;
      END IF;

      v_override := item.override_value IS NOT NULL;
      v_unit_brl := COALESCE(item.override_value, item.unit_value_brl, 0);
      v_unit_usd := item.unit_value_usd;

      IF item.application_basis = 'container_distinct_voyage' AND v_bl.cargo_mode = 'container' THEN
        -- Etapa 13 (achado 9): soma por container com o ultimo B/L do grupo
        -- absorvendo a diferenca de arredondamento, em vez de
        -- ROUND(qty_agregada * rate, 2). Mesmo filtro de classificacao
        -- (standard/imo/oog vs. todos os containers do B/L) que decidia qual
        -- v_qty_* usar antes.
        IF item.currency = 'USD' THEN
          SELECT COALESCE(SUM(
            CASE WHEN (elem->>'is_last')::BOOLEAN
              THEN COALESCE(v_unit_usd, 0) - ((elem->>'share_count')::NUMERIC - 1) * ROUND(COALESCE(v_unit_usd, 0) / (elem->>'share_count')::NUMERIC, 2)
              ELSE ROUND(COALESCE(v_unit_usd, 0) / (elem->>'share_count')::NUMERIC, 2)
            END
          ), 0)
          INTO v_total_line_usd
          FROM jsonb_array_elements(COALESCE(v_container_shares, '[]'::jsonb)) AS elem
          WHERE
            NOT v_is_thd
            OR (item.cargo_profile = 'standard' AND NOT (elem->>'has_imo')::BOOLEAN AND NOT (elem->>'has_oog')::BOOLEAN)
            OR (item.cargo_profile = 'imo' AND (elem->>'has_imo')::BOOLEAN AND NOT (elem->>'has_oog')::BOOLEAN)
            OR (item.cargo_profile = 'oog' AND (elem->>'has_oog')::BOOLEAN AND NOT (elem->>'has_imo')::BOOLEAN);
          v_total_line_brl := NULL;
        ELSE
          SELECT COALESCE(SUM(
            CASE WHEN (elem->>'is_last')::BOOLEAN
              THEN COALESCE(v_unit_brl, 0) - ((elem->>'share_count')::NUMERIC - 1) * ROUND(COALESCE(v_unit_brl, 0) / (elem->>'share_count')::NUMERIC, 2)
              ELSE ROUND(COALESCE(v_unit_brl, 0) / (elem->>'share_count')::NUMERIC, 2)
            END
          ), 0)
          INTO v_total_line_brl
          FROM jsonb_array_elements(COALESCE(v_container_shares, '[]'::jsonb)) AS elem
          WHERE
            NOT v_is_thd
            OR (item.cargo_profile = 'standard' AND NOT (elem->>'has_imo')::BOOLEAN AND NOT (elem->>'has_oog')::BOOLEAN)
            OR (item.cargo_profile = 'imo' AND (elem->>'has_imo')::BOOLEAN AND NOT (elem->>'has_oog')::BOOLEAN)
            OR (item.cargo_profile = 'oog' AND (elem->>'has_oog')::BOOLEAN AND NOT (elem->>'has_imo')::BOOLEAN);
          v_total_line_usd := NULL;
        END IF;
      ELSE
        v_total_line_brl := CASE WHEN item.currency = 'USD' THEN NULL ELSE ROUND(v_qty * COALESCE(v_unit_brl, 0), 2) END;
        v_total_line_usd := CASE WHEN item.currency = 'USD' THEN ROUND(v_qty * COALESCE(v_unit_usd, 0), 2) ELSE NULL END;
      END IF;

      v_calculation_key := CONCAT('auto:item:', item.id);

      INSERT INTO public.charge_calculations (
        bl_id,
        charge_table_id,
        charge_item_id,
        quantity,
        unit_value_brl,
        unit_value_usd,
        total_value_brl,
        total_value_usd,
        override_applied,
        source,
        status,
        calculation_key,
        created_by,
        calculated_at
      )
      VALUES (
        p_bl_id,
        v_table_id,
        item.id,
        v_qty,
        CASE WHEN item.currency = 'USD' THEN NULL ELSE v_unit_brl END,
        CASE WHEN item.currency = 'USD' THEN v_unit_usd ELSE NULL END,
        v_total_line_brl,
        v_total_line_usd,
        v_override,
        'auto',
        'calculated',
        v_calculation_key,
        v_actor,
        NOW()
      )
      ON CONFLICT (bl_id, calculation_key) DO UPDATE
      SET
        charge_table_id = EXCLUDED.charge_table_id,
        charge_item_id = EXCLUDED.charge_item_id,
        quantity = EXCLUDED.quantity,
        unit_value_brl = EXCLUDED.unit_value_brl,
        unit_value_usd = EXCLUDED.unit_value_usd,
        total_value_brl = EXCLUDED.total_value_brl,
        total_value_usd = EXCLUDED.total_value_usd,
        override_applied = EXCLUDED.override_applied,
        source = EXCLUDED.source,
        status = EXCLUDED.status,
        created_by = EXCLUDED.created_by,
        calculated_at = NOW();
    END LOOP;
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(COALESCE(total_value_brl, 0)), 0),
    COALESCE(SUM(COALESCE(total_value_usd, 0)), 0)
  INTO v_line_count, v_total_brl, v_total_usd
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id;

  IF v_is_exempt THEN
    v_status := 'exempt';
  ELSIF v_auto_review THEN
    v_status := 'review_required';
  ELSIF v_line_count > 0 THEN
    v_status := 'calculated';
  ELSE
    v_status := 'not_calculated';
  END IF;

  UPDATE public.bls
  SET
    charge_status = v_status,
    charges_calculated_at = NOW(),
    charge_exemption_reason = CASE WHEN v_status = 'exempt' THEN v_reason ELSE NULL END,
    -- Etapa 11 do plano de faturamento (ADR 0038 decisao 6, achado 7): linhas
    -- em USD deixam de exigir ajuste manual -- create_invoice_from_bls_core e
    -- create_local_consolidated_invoice_core convertem para BRL pelo ROE
    -- vigente na emissao (migration 268). O hold aqui so fazia sentido
    -- enquanto USD bloqueava o fluxo; mante-lo bloquearia todo B/L com linha
    -- em USD na tela de Validacao mesmo depois da conversao automatica.
    billing_hold_reason = CASE
      WHEN v_status = 'review_required' THEN COALESCE(v_reason, 'Pendencia de revisao nas taxas locais.')
      WHEN v_status = 'not_calculated' THEN 'Nenhuma tabela de preco ou tarifa encontrada. Adicione os precos e recalcule.'
      ELSE NULL
    END
  WHERE id = p_bl_id;

  RETURN jsonb_build_object(
    'bl_id', p_bl_id,
    'status', v_status,
    'table_id', v_table_id,
    'line_count', v_line_count,
    'total_brl', v_total_brl,
    'total_usd', v_total_usd,
    'review_required', v_auto_review,
    'exempt', (v_status = 'exempt'),
    'reason', COALESCE(v_reason, '')
  );
END;
$$;
