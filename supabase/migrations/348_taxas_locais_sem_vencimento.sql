-- 348: taxa local não tem vencimento praticado — aposenta due_date e overdue.
--
-- Contexto (issue #605): `031_overdue_enforcement.sql` agendou um cron que marca
-- `invoices.status = 'overdue'` a partir de `invoices.due_date`, e o detector de
-- alertas (`329`) repete a mesma regra abrindo `invoice_overdue`. O produto
-- confirmou que **a operação não pratica data de vencimento para taxas locais**:
-- o `due_date` existia na tabela mas nunca correspondeu a um prazo cobrado do
-- cliente. O resultado era um estado inventado aparecendo em telas e leituras
-- financeiras — e, pior, `fn_block_invoice_overdue_customer` **bloqueava a
-- emissão de novas faturas** do cliente por causa dele.
--
-- Esta migration faz para a taxa local o que a `157_demurrage_drop_overdue.sql`
-- fez para o Demurrage sob o ADR 0014: remove o vencimento do domínio em vez de
-- manter uma regra que a operação não usa. O `due_date` do Demurrage vive em
-- `demurrage_invoices` e não é tocado aqui.
--
-- Escopo: comportamental + schema. Sai o cron, sai o detector, sai o bloqueio de
-- emissão, sai o status `overdue` de `public.invoices` e sai a coluna
-- `invoices.due_date`.
--
-- Rollback: não há reversão de dados — a coluna é removida e o vencimento
-- histórico se perde junto. Restaurar exigiria reaplicar `031`, `024`/`329`,
-- `282` e recriar a coluna, sem os valores originais. Ver ADR 0031.

-- ── 1. Desliga o marcador agendado ────────────────────────────────
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mark-overdue-invoices') THEN
    PERFORM cron.unschedule('mark-overdue-invoices');
  END IF;
END;
$cron$;

DROP FUNCTION IF EXISTS public.mark_overdue_invoices();

-- ── 2. Destrava a emissão ─────────────────────────────────────────
-- O gatilho recusava qualquer INSERT em invoices para cliente com fatura
-- 'overdue'. Como 'overdue' deixa de existir, o gatilho só poderia recusar
-- por um prazo fictício.
DROP TRIGGER IF EXISTS trg_block_invoice_overdue_customer ON public.invoices;
DROP FUNCTION IF EXISTS public.fn_block_invoice_overdue_customer();

-- ── 3. Aposenta o detector de vencidas e o alerta invoice_overdue ──
CREATE OR REPLACE FUNCTION public.run_alert_detectors()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor UUID;
  v_adr_pending INTEGER := 0;
  v_adr_deadline INTEGER := 0;
  v_bl_review INTEGER := 0;
  v_granite_review INTEGER := 0;
  v_voyage_ops INTEGER := 0;
  v_portal JSONB;
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

  -- Faturas vencidas saíram do runner: taxa local não tem vencimento praticado
  -- (issue #605). O Demurrage nunca teve (ADR 0014).

  -- ADR - Relatório de Saída da Agência (Bloco 5)
  v_adr_pending := public.detect_agency_report_pending();
  v_adr_deadline := public.detect_agency_report_deadline_missed();

  -- Revisão Manual de B/L e Granito (Bloco 1)
  v_bl_review := public.detect_bl_review_pendencies();
  v_granite_review := public.detect_granite_bl_review_pendencies();

  -- Operação e Viagens (Bloco 4)
  v_voyage_ops := public.detect_voyage_operation_alerts();

  -- Portal do Cliente e Disputas (Bloco 2)
  v_portal := public.reconcile_client_portal_alerts();

  RETURN jsonb_build_object(
    'agency_report_pending', v_adr_pending,
    'agency_report_deadline_missed', v_adr_deadline,
    'bl_review_pendencies', v_bl_review,
    'granite_bl_review_pendencies', v_granite_review,
    'voyage_operation_alerts', v_voyage_ops,
    'client_portal', v_portal
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.run_alert_detectors() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_alert_detectors() TO service_role;

DROP FUNCTION IF EXISTS public.detect_overdue_invoices();

-- ── 4. Normaliza as faturas já marcadas e retira o status do domínio ──
-- O status volta a refletir o que o ledger diz sobre o pagamento, que é a única
-- leitura real que a operação tem da fatura de taxas locais.
UPDATE public.invoices
SET status = CASE
      WHEN COALESCE(balance_brl, 0) <= 0.01 AND COALESCE(total_paid_brl, 0) > 0 THEN 'paid'
      WHEN COALESCE(total_paid_brl, 0) > 0 THEN 'partially_paid'
      ELSE 'issued'
    END,
    updated_at = now()
WHERE status = 'overdue';

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'covered', 'obsolete', 'cancelled'));

-- Fecha os itens de alerta abertos e desativa o tipo no catálogo, no mesmo
-- padrão da 327: sem produtor, o catálogo não pode prometer o alerta.
DO $cleanup$
DECLARE v_item RECORD;
BEGIN
  FOR v_item IN
    SELECT id, occurrence_id FROM public.alert_items
    WHERE status = 'active' AND item_type = 'invoice_overdue'
  LOOP
    INSERT INTO public.alert_item_events (
      alert_item_id, occurrence_id, event_type, previous_status, new_status, actor_id, metadata
    )
    VALUES (
      v_item.id, v_item.occurrence_id, 'resolved', 'active', 'resolved', NULL,
      jsonb_build_object('source', 'issue_605', 'reason', 'local_charge_has_no_due_date')
    );
    UPDATE public.alert_items
    SET status = 'resolved', resolved_at = COALESCE(resolved_at, now()), updated_at = now()
    WHERE id = v_item.id;
  END LOOP;

  UPDATE public.alerts SET status = 'closed', closed_at = COALESCE(closed_at, now())
  WHERE type = 'invoice_overdue'
     OR (type = 'aggregate'
         AND EXISTS (SELECT 1 FROM public.alert_items i WHERE i.alert_id = alerts.id AND i.item_type = 'invoice_overdue')
         AND NOT EXISTS (SELECT 1 FROM public.alert_items i WHERE i.alert_id = alerts.id AND i.status = 'active'));
END;
$cleanup$;

UPDATE public.alert_type_catalog
SET active = false
WHERE type = 'invoice_overdue';

-- O gatilho de resolução deixa de citar invoice_overdue: não há mais produtor e
-- os itens históricos já foram fechados acima.
CREATE OR REPLACE FUNCTION public.resolve_invoice_alerts_on_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    IF NEW.status IN ('paid', 'partially_paid', 'cancelled') THEN
      PERFORM public.resolve_alert_item(
        'invoice_payment_invalid', 'invoice', NEW.id::TEXT,
        'invoice_status_change', jsonb_build_object('invoice_status', NEW.status)
      );
    END IF;
    IF NEW.status = 'cancelled' THEN
      PERFORM public.resolve_alert_item(
        'invoice_cancel_blocked', 'invoice', NEW.id::TEXT,
        'invoice_status_change', jsonb_build_object('invoice_status', NEW.status)
      );
    END IF;
    PERFORM set_config('alerts.foundation_trigger', 'off', true);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_invoice_alerts_on_status_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_invoice_alerts_on_status_change() TO service_role;

-- ── 5. Retira due_date das funções que ainda o carregavam ─────────
-- A edição é cirúrgica sobre a definição viva (mesmo recurso que a 292 usa para
-- clonar funções): cada substituição é verificada, e uma que não encontre o
-- alvo aborta a migration em vez de deixar a função intacta em silêncio.
CREATE OR REPLACE FUNCTION pg_temp.strip_due_date(
  p_signature TEXT,
  p_replacements TEXT[][]
)
RETURNS VOID
LANGUAGE plpgsql
AS $strip$
DECLARE
  v_def TEXT;
  v_before TEXT;
  i INTEGER;
BEGIN
  v_def := pg_get_functiondef(p_signature::regprocedure);
  FOR i IN 1 .. array_length(p_replacements, 1) LOOP
    v_before := v_def;
    v_def := replace(v_def, p_replacements[i][1], p_replacements[i][2]);
    IF v_def = v_before THEN
      RAISE EXCEPTION 'Alvo não encontrado em %: %', p_signature, p_replacements[i][1];
    END IF;
  END LOOP;
  EXECUTE format('DROP FUNCTION %s', p_signature);
  EXECUTE v_def;
END;
$strip$;

-- 5.1 Leitura do portal. A coluna sai do RETURNS TABLE e do SELECT; os dois
-- wrappers repetem a assinatura e precisam ser recriados junto.
DROP FUNCTION IF EXISTS public.portal_list_invoices();
DROP FUNCTION IF EXISTS public.portal_inspect_list_invoices(BIGINT);
-- Sobra da clonagem feita pela 292: sem chamador e ainda lendo due_date.
DROP FUNCTION IF EXISTS public.portal_list_invoices_legacy();

SELECT pg_temp.strip_due_date(
  'public._portal_list_invoices_core(bigint)',
  ARRAY[
    ARRAY['issued_at timestamp with time zone, due_date date, total_brl', 'issued_at timestamp with time zone, total_brl'],
    ARRAY[
      $t1$    i.issued_at,
    i.due_date,
$t1$,
      $t2$    i.issued_at,
$t2$
    ]
  ]
);

CREATE OR REPLACE FUNCTION public.portal_list_invoices()
RETURNS TABLE(id BIGINT, invoice_number TEXT, issued_at TIMESTAMPTZ, total_brl NUMERIC, total_paid_brl NUMERIC, balance_brl NUMERIC, status TEXT, invoice_type TEXT, vessels TEXT[], voyages TEXT[], vessel_voyages TEXT[], bls TEXT[], pods TEXT[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ BEGIN RETURN QUERY SELECT * FROM public._portal_list_invoices_core(public.current_portal_customer_id()); END; $$;

CREATE OR REPLACE FUNCTION public.portal_inspect_list_invoices(p_customer_id BIGINT)
RETURNS TABLE(id BIGINT, invoice_number TEXT, issued_at TIMESTAMPTZ, total_brl NUMERIC, total_paid_brl NUMERIC, balance_brl NUMERIC, status TEXT, invoice_type TEXT, vessels TEXT[], voyages TEXT[], vessel_voyages TEXT[], bls TEXT[], pods TEXT[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ BEGIN RETURN QUERY SELECT * FROM public._portal_list_invoices_core(public._portal_inspect_guard(p_customer_id)); END; $$;

REVOKE ALL ON FUNCTION public._portal_list_invoices_core(BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_list_invoices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_list_invoices() TO authenticated;
REVOKE ALL ON FUNCTION public.portal_inspect_list_invoices(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_inspect_list_invoices(BIGINT) TO authenticated;

-- 5.2 Escrita: o parâmetro p_due_date sai das RPCs de emissão e a coluna sai
-- dos INSERTs. Recriar de dentro para fora mantém cada chamador coerente.
SELECT pg_temp.strip_due_date(
  'public.create_invoice_from_bls_core(text[],bigint,date,text,boolean,uuid,text,bigint)',
  ARRAY[
    ARRAY['p_customer_id bigint, p_due_date date DEFAULT NULL::date, p_notes text', 'p_customer_id bigint, p_notes text'],
    ARRAY[
      $t3$    issued_at,
    due_date,
$t3$,
      $t4$    issued_at,
$t4$
    ],
    ARRAY[
      $t5$    p_due_date,
    0,
$t5$,
      $t6$    0,
$t6$
    ]
  ]
);

SELECT pg_temp.strip_due_date(
  'public.create_invoice_from_bls(text[],bigint,date,text,boolean,uuid)',
  ARRAY[
    ARRAY['p_customer_id bigint DEFAULT NULL::bigint, p_due_date date DEFAULT NULL::date, p_notes text', 'p_customer_id bigint DEFAULT NULL::bigint, p_notes text'],
    ARRAY[
      $c1a$    p_customer_id,
    p_due_date,
$c1a$,
      $c1b$    p_customer_id,
$c1b$
    ]
  ]
);

SELECT pg_temp.strip_due_date(
  'public.create_invoice_from_bls_with_ledger(text[],bigint,date,text,boolean,uuid)',
  ARRAY[
    ARRAY['p_customer_id bigint DEFAULT NULL::bigint, p_due_date date DEFAULT NULL::date, p_notes text', 'p_customer_id bigint DEFAULT NULL::bigint, p_notes text'],
    ARRAY[
      $c2a$    p_customer_id,
    p_due_date,
$c2a$,
      $c2b$    p_customer_id,
$c2b$
    ]
  ]
);

SELECT pg_temp.strip_due_date(
  'public.mark_bl_ready_and_create_invoice(text,bigint,date,text,uuid)',
  ARRAY[
    ARRAY['p_customer_id bigint DEFAULT NULL::bigint, p_due_date date DEFAULT NULL::date, p_notes text', 'p_customer_id bigint DEFAULT NULL::bigint, p_notes text'],
    ARRAY[
      $v1a$    v_customer_id,
    p_due_date,
$v1a$,
      $v1b$    v_customer_id,
$v1b$
    ]
  ]
);

SELECT pg_temp.strip_due_date(
  'public.mark_bls_ready_and_create_invoice(text[],bigint,date,text,uuid)',
  ARRAY[
    ARRAY['p_customer_id bigint, p_due_date date DEFAULT NULL::date, p_notes text', 'p_customer_id bigint, p_notes text'],
    ARRAY[
      $c3a$    p_customer_id,
    p_due_date,
$c3a$,
      $c3b$    p_customer_id,
$c3b$
    ]
  ]
);

-- A consolidada já ignorava p_due_date (gravava NULL); o parâmetro era fachada.
SELECT pg_temp.strip_due_date(
  'public.create_local_consolidated_invoice(bigint,bigint[],date,text,uuid)',
  ARRAY[
    ARRAY['p_receivable_ids bigint[], p_due_date date DEFAULT NULL::date, p_notes text', 'p_receivable_ids bigint[], p_notes text']
  ]
);

SELECT pg_temp.strip_due_date(
  'public.create_local_consolidated_invoice_core(bigint,bigint[],uuid,text)',
  ARRAY[
    ARRAY['customer_id, bl_id, issued_at, due_date, total_brl, status, invoice_type,', 'customer_id, bl_id, issued_at, total_brl, status, invoice_type,'],
    ARRAY['p_customer_id, NULL, now(), NULL, v_total,', 'p_customer_id, NULL, now(), v_total,']
  ]
);

-- Granito é lápide: as duas sobrecargas só recusam a chamada (ADR de Granito
-- fora do faturamento financeiro). Perdem o parâmetro para não sugerir prazo.
DROP FUNCTION IF EXISTS public.create_invoice_from_granite_bls(UUID[], BIGINT, DATE, TEXT, BOOLEAN, UUID);
DROP FUNCTION IF EXISTS public.create_invoice_from_granite_bls(UUID[], BIGINT, DATE, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.create_invoice_from_granite_bls(
  p_granite_bl_ids UUID[],
  p_customer_id BIGINT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_issue_now BOOLEAN DEFAULT TRUE,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Granito não participa do faturamento financeiro.' USING ERRCODE = 'PT409';
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice_from_granite_bls(UUID[], BIGINT, TEXT, BOOLEAN, UUID) FROM PUBLIC, anon, authenticated;

-- Grants perdidos no DROP/CREATE das RPCs de emissão.
REVOKE ALL ON FUNCTION public.create_invoice_from_bls_core(TEXT[], BIGINT, TEXT, BOOLEAN, UUID, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_invoice_from_bls(TEXT[], BIGINT, TEXT, BOOLEAN, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_bls(TEXT[], BIGINT, TEXT, BOOLEAN, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.create_invoice_from_bls_with_ledger(TEXT[], BIGINT, TEXT, BOOLEAN, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_bls_with_ledger(TEXT[], BIGINT, TEXT, BOOLEAN, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_bl_ready_and_create_invoice(TEXT, BIGINT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_bl_ready_and_create_invoice(TEXT, BIGINT, TEXT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_bls_ready_and_create_invoice(TEXT[], BIGINT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_bls_ready_and_create_invoice(TEXT[], BIGINT, TEXT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.create_local_consolidated_invoice(BIGINT, BIGINT[], TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_local_consolidated_invoice(BIGINT, BIGINT[], TEXT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.create_local_consolidated_invoice_core(BIGINT, BIGINT[], UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- 5.3 O pagamento deixa de reclassificar a fatura como vencida.
SELECT pg_temp.strip_due_date(
  'public.register_invoice_payment(bigint,numeric,text,timestamp with time zone,text,uuid)',
  ARRAY[
    ARRAY[
      $t9$  IF v_next_status IN ('issued', 'partially_paid')
    AND v_invoice.due_date IS NOT NULL
    AND v_invoice.due_date < CURRENT_DATE THEN
    v_next_status := 'overdue';
  END IF;

$t9$,
      ''
    ]
  ]
);

REVOKE ALL ON FUNCTION public.register_invoice_payment(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_invoice_payment(BIGINT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, UUID) TO authenticated;

-- 5.4 A RPC de editar vencimento não tem mais o que editar.
DROP FUNCTION IF EXISTS public.update_invoice_due_date(BIGINT, DATE, UUID);

-- ── 6. A coluna sai da tabela ─────────────────────────────────────
ALTER TABLE public.invoices DROP COLUMN IF EXISTS due_date;

-- ── 7. Verificação ────────────────────────────────────────────────
DO $verify$
DECLARE
  v_count INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'due_date'
  ) THEN
    RAISE EXCEPTION 'invoices.due_date ainda existe.';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.invoices WHERE status = 'overdue';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Ainda há % fatura(s) de taxas locais em overdue.', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('mark_overdue_invoices', 'detect_overdue_invoices',
                      'update_invoice_due_date', 'fn_block_invoice_overdue_customer');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Restaram % função(ões) do regime de vencimento.', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND p.proname NOT LIKE '%demurrage%'
    AND p.proname <> 'array_agg'
    AND pg_get_functiondef(p.oid) ~* 'due_date';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Restaram % função(ões) não-Demurrage citando due_date.', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.alert_type_catalog WHERE type = 'invoice_overdue' AND active;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'invoice_overdue continua ativo no catálogo de alertas.';
  END IF;
END;
$verify$;
