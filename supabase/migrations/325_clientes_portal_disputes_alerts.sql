-- 325: Bloco 2 (#521) — Clientes, Portal e Disputes.
--
-- A migration é aditiva sobre a fundação 317–321. Ela troca os produtores
-- legados pelo agregado de itens, remove a decisão funcional obsoleta do
-- Portal, fecha o gate no banco e transforma a Dispute em conversa auditável.
-- Rollback operacional: reverter a PR e restaurar os produtores históricos;
-- não apagar alert_items, eventos, mensagens ou anexos, que são auditoria.

-- ---------------------------------------------------------------------------
-- 1. Portal: remover “provisionamento não necessário” do contrato vivo.
-- ---------------------------------------------------------------------------

ALTER TABLE public.customer_portal_accounts
  DROP CONSTRAINT IF EXISTS customer_portal_accounts_provisioning_decision_check;

UPDATE public.customer_portal_accounts
SET provisioning_decision = 'aguardando_analise'
WHERE provisioning_decision = 'provisionamento_nao_necessario';

ALTER TABLE public.customer_portal_accounts
  ADD CONSTRAINT customer_portal_accounts_provisioning_decision_check
  CHECK (provisioning_decision IN ('aguardando_analise', 'aprovado_para_provisionar'));

CREATE OR REPLACE FUNCTION public.portal_billing_gate(p_bl_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_customer_id BIGINT;
  v_account public.customer_portal_accounts%ROWTYPE;
  v_reason TEXT;
  v_email TEXT;
BEGIN
  SELECT customer_id INTO v_customer_id FROM public.bls WHERE id = p_bl_id;
  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Cliente não reconciliado para faturamento.');
  END IF;

  SELECT * INTO v_account
  FROM public.customer_portal_accounts
  WHERE customer_id = v_customer_id;

  v_email := lower(NULLIF(btrim(v_account.recovery_email), ''));
  IF v_account.id IS NULL OR NOT COALESCE(v_account.active, false)
     OR v_account.account_situation <> 'ativo'
     OR v_account.auth_user_id IS NULL THEN
    v_reason := 'Portal do Cliente não está ativo.';
  ELSIF v_email IS NULL OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    v_reason := 'Email de recuperação ausente ou inválido.';
  ELSIF COALESCE(v_account.recovery_email_status, 'ok') <> 'ok'
     OR EXISTS (SELECT 1 FROM public.portal_suppressed_emails s WHERE lower(s.email) = v_email) THEN
    v_reason := 'Email de recuperação suprimido ou sem entrega utilizável.';
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_reason IS NULL,
    'reason', v_reason,
    'customer_id', v_customer_id,
    'account_id', v_account.id,
    'recovery_email', v_email
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.portal_billing_gate(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_billing_gate(TEXT) TO authenticated, service_role;

-- A operação deixou de existir; manter a assinatura evita quebra de clientes
-- antigos, mas nenhuma chamada nova pode gravar o estado removido.
CREATE OR REPLACE FUNCTION public.portal_set_exception(p_customer_id BIGINT, p_reason TEXT, p_request_id TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'A decisão de provisionamento não necessário foi removida; use Aguardando análise.' USING ERRCODE = '22023';
END;
$function$;

REVOKE ALL ON FUNCTION public.portal_set_exception(BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_reopen_on_new_process()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_account public.customer_portal_accounts%ROWTYPE;
BEGIN
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_account
  FROM public.customer_portal_accounts
  WHERE customer_id = NEW.customer_id
  FOR UPDATE;
  IF FOUND AND v_account.provisioning_decision <> 'aguardando_analise' THEN
    UPDATE public.customer_portal_accounts
    SET provisioning_decision = 'aguardando_analise'
    WHERE id = v_account.id;
    PERFORM public._portal_log_event(
      NEW.customer_id, v_account.id, NULL,
      v_account.provisioning_decision, 'aguardando_analise',
      v_account.account_situation, v_account.account_situation,
      'sistema', 'Novo processo ativo reabriu a análise do Portal.', NULL
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_portal_reopen_on_new_process ON public.bls;
CREATE TRIGGER trg_portal_reopen_on_new_process
AFTER INSERT OR UPDATE OF customer_id ON public.bls
FOR EACH ROW EXECUTE FUNCTION public.portal_reopen_on_new_process();

CREATE OR REPLACE FUNCTION public.portal_list_provisioning_console(p_customer_id BIGINT DEFAULT NULL)
RETURNS SETOF JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_full_access BOOLEAN := v_role IN ('administrativo', 'documentacao', 'financeiro', 'equipamentos');
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  PERFORM public.portal_repair_missing_accounts();
  RETURN QUERY
  SELECT jsonb_build_object(
    'account_id', a.id,
    'customer_id', c.id,
    'customer_name', c.name,
    'cnpj_cpf', c.cnpj_cpf,
    'provisioning_decision', a.provisioning_decision,
    'account_situation', CASE WHEN a.account_situation = 'convite_pendente' AND pi.expires_at < now() THEN 'convite_expirado' ELSE a.account_situation END,
    'recovery_email', CASE WHEN v_full_access THEN a.recovery_email ELSE NULL END,
    'recovery_email_source', CASE WHEN v_full_access THEN a.recovery_email_source ELSE NULL END,
    'pending_invite_expires_at', pi.expires_at,
    'latest_delivery_status', CASE WHEN v_full_access THEN ea.status ELSE NULL END,
    'exception_reason', NULL,
    'last_event_at', ev.created_at,
    'has_critical_alert', EXISTS (
      SELECT 1 FROM public.alerts al
      LEFT JOIN public.alert_items ai ON ai.alert_id = al.id
      WHERE al.status <> 'closed'
        AND ((al.entity_type = 'customer' AND al.entity_id = c.id::text)
          OR (al.entity_type = 'bl' AND EXISTS (
            SELECT 1 FROM public.bls cb WHERE cb.id = al.entity_id AND cb.customer_id = c.id
          )))
        AND (al.type = 'aggregate' OR ai.severity = 'critical' OR al.type = 'portal_abuso_login')
    ),
    'has_open_invoice', EXISTS (SELECT 1 FROM public.invoices i WHERE i.customer_id = c.id AND i.status IN ('issued', 'overdue', 'partially_paid')),
    'has_active_process', EXISTS (SELECT 1 FROM public.bls b WHERE b.customer_id = c.id AND b.financial_status IS DISTINCT FROM 'cancelled'),
    'candidates', CASE WHEN v_full_access THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('email', cc.email, 'purpose', cc.purpose, 'origin', 'Contato do Cliente') ORDER BY cc.id) FROM public.customer_contacts cc WHERE cc.customer_id = c.id AND cc.email IS NOT NULL AND cc.purpose IN ('geral', 'financeiro', 'operacional', 'faturamento')), '[]'::jsonb) ELSE '[]'::jsonb END,
    'shared_email_count', CASE WHEN v_full_access AND a.recovery_email IS NOT NULL THEN (SELECT count(*) FROM public.customer_portal_accounts other WHERE lower(other.recovery_email) = lower(a.recovery_email) AND other.id <> a.id) ELSE 0 END
  )
  FROM public.customer_portal_accounts a
  JOIN public.customers c ON c.id = a.customer_id
  LEFT JOIN LATERAL (SELECT expires_at FROM public.portal_invites WHERE account_id = a.id AND purpose = 'convite' AND status = 'pendente' ORDER BY created_at DESC LIMIT 1) pi ON true
  LEFT JOIN LATERAL (SELECT status FROM public.portal_email_attempts WHERE account_id = a.id ORDER BY created_at DESC LIMIT 1) ea ON true
  LEFT JOIN LATERAL (SELECT created_at FROM public.portal_provisioning_events WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1) ev ON true
  WHERE p_customer_id IS NULL OR c.id = p_customer_id
  ORDER BY c.name;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.portal_list_provisioning_console(BIGINT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_list_provisioning_console(BIGINT) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 2. Produtor único de pendências do Portal e backfill idempotente.
-- ---------------------------------------------------------------------------

INSERT INTO public.alert_type_catalog(type, severity, responsible_department, audience_departments, default_destination)
VALUES ('portal_reprocessamento_falhou', 'critical', 'documentacao', ARRAY['documentacao'], '/clientes/portal')
ON CONFLICT (type) DO UPDATE SET active = true, severity = EXCLUDED.severity,
  responsible_department = EXCLUDED.responsible_department,
  audience_departments = EXCLUDED.audience_departments,
  default_destination = EXCLUDED.default_destination;

-- PR #570 (migration 323) adds the department-aware eight-argument
-- upsert_alert_item contract. Keep this migration replayable from main while
-- making the integrated 323 -> 324 chain use the real item audience.
CREATE OR REPLACE FUNCTION public.block521_upsert_alert(
  p_type TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_message TEXT,
  p_source TEXT,
  p_department TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_destination TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  IF to_regprocedure('public.upsert_alert_item(text,text,text,text,text,text,jsonb,text)') IS NOT NULL THEN
    EXECUTE 'SELECT public.upsert_alert_item($1,$2,$3,$4,$5,$6,$7,$8)'
      INTO v_result
      USING p_type, p_entity_type, p_entity_id, p_message, p_source,
        p_department, COALESCE(p_metadata, '{}'::jsonb), p_destination;
  ELSE
    EXECUTE 'SELECT public.upsert_alert_item($1,$2,$3,$4,$5,$6,$7)'
      INTO v_result
      USING p_type, p_entity_type, p_entity_id, p_message, p_source,
        COALESCE(p_metadata, '{}'::jsonb), p_destination;
  END IF;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.block521_resolve_alert(
  p_type TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_department TEXT,
  p_source TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result BOOLEAN;
BEGIN
  IF to_regprocedure('public.resolve_alert_item_for_department(text,text,text,text,text,jsonb)') IS NOT NULL THEN
    EXECUTE 'SELECT public.resolve_alert_item_for_department($1,$2,$3,$4,$5,$6)'
      INTO v_result
      USING p_type, p_entity_type, p_entity_id, p_department, p_source, '{}'::jsonb;
  ELSE
    EXECUTE 'SELECT public.resolve_alert_item($1,$2,$3,$4)'
      INTO v_result
      USING p_type, p_entity_type, p_entity_id, p_source;
    v_result := true;
  END IF;
  RETURN COALESCE(v_result, false);
END;
$function$;

REVOKE ALL ON FUNCTION public.block521_upsert_alert(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT), public.block521_resolve_alert(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block521_upsert_alert(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT), public.block521_resolve_alert(TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_client_portal_alerts()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_customer RECORD;
  v_account public.customer_portal_accounts%ROWTYPE;
  v_active_process BOOLEAN;
  v_gate_ok BOOLEAN;
  v_result JSONB := '{}'::jsonb;
  v_count INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  FOR v_customer IN
    SELECT c.id, c.name,
           EXISTS (SELECT 1 FROM public.bls b WHERE b.customer_id = c.id AND b.financial_status IS DISTINCT FROM 'cancelled') AS active_process,
           a.id AS account_id, a.active, a.account_situation, a.auth_user_id, a.recovery_email, a.recovery_email_status
    FROM public.customers c
    LEFT JOIN public.customer_portal_accounts a ON a.customer_id = c.id
    ORDER BY c.id
  LOOP
    v_active_process := v_customer.active_process;
    v_account.id := v_customer.account_id;
    v_account.active := v_customer.active;
    v_account.account_situation := v_customer.account_situation;
    v_account.auth_user_id := v_customer.auth_user_id;
    v_account.recovery_email := v_customer.recovery_email;
    v_account.recovery_email_status := v_customer.recovery_email_status;
    v_gate_ok := false;
    IF v_account.id IS NOT NULL THEN
      v_gate_ok := v_account.active
        AND v_account.account_situation = 'ativo'
        AND v_account.auth_user_id IS NOT NULL
        AND lower(COALESCE(v_account.recovery_email, '')) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
        AND COALESCE(v_account.recovery_email_status, 'ok') = 'ok'
        AND NOT EXISTS (SELECT 1 FROM public.portal_suppressed_emails s WHERE lower(s.email) = lower(v_account.recovery_email));
    END IF;

    IF v_active_process AND NOT v_gate_ok THEN
      PERFORM public.block521_upsert_alert(
        'portal_pendencia_geral', 'customer', v_customer.id::text,
        'Cliente com processo ativo sem Portal ativo ou sem email de recuperação utilizável.',
        'portal_reconciliation',
        'documentacao',
        jsonb_build_object('customer_id', v_customer.id, 'active_process', true),
        '/clientes/portal?cliente=' || v_customer.id
      );
    ELSE
      PERFORM public.block521_resolve_alert('portal_pendencia_geral', 'customer', v_customer.id::text, 'documentacao', 'portal_reconciliation');
    END IF;

    IF v_active_process AND v_account.id IS NOT NULL AND v_account.account_situation = 'convite_expirado' THEN
      PERFORM public.block521_upsert_alert('portal_convite_expirado', 'customer', v_customer.id::text, 'Convite do Portal expirado; reenvie o convite.', 'portal_reconciliation', 'documentacao', jsonb_build_object('customer_id', v_customer.id), '/clientes/portal?cliente=' || v_customer.id);
    ELSE
      PERFORM public.block521_resolve_alert('portal_convite_expirado', 'customer', v_customer.id::text, 'documentacao', 'portal_reconciliation');
    END IF;

    IF v_active_process AND v_account.id IS NOT NULL AND v_account.account_situation = 'falha_no_envio' THEN
      PERFORM public.block521_upsert_alert('portal_falha_envio', 'customer', v_customer.id::text, 'Falha no envio do convite do Portal; revise o email e reenvie.', 'portal_reconciliation', 'documentacao', jsonb_build_object('customer_id', v_customer.id), '/clientes/portal?cliente=' || v_customer.id);
    ELSE
      PERFORM public.block521_resolve_alert('portal_falha_envio', 'customer', v_customer.id::text, 'documentacao', 'portal_reconciliation');
    END IF;

    IF v_active_process AND v_account.id IS NOT NULL AND (COALESCE(v_account.recovery_email_status, 'ok') <> 'ok' OR EXISTS (SELECT 1 FROM public.portal_suppressed_emails s WHERE lower(s.email) = lower(v_account.recovery_email))) THEN
      PERFORM public.block521_upsert_alert('portal_email_suprimido', 'customer', v_customer.id::text, 'Email de recuperação suprimido; escolha e confirme um endereço utilizável.', 'portal_reconciliation', 'documentacao', jsonb_build_object('customer_id', v_customer.id, 'email', v_account.recovery_email), '/clientes/portal?cliente=' || v_customer.id);
    ELSE
      PERFORM public.block521_resolve_alert('portal_email_suprimido', 'customer', v_customer.id::text, 'documentacao', 'portal_reconciliation');
    END IF;
    v_count := v_count + 1;
  END LOOP;
  v_result := jsonb_build_object('customers_scanned', v_count, 'reconciled_at', now());
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_client_portal_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_client_portal_alerts() TO service_role;

CREATE OR REPLACE FUNCTION public.register_portal_login_abuse(p_customer_id BIGINT, p_evidence JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  RETURN public.block521_upsert_alert(
    'portal_abuso_login', 'customer', p_customer_id::text,
    'Padrão de tentativas de login exige investigação de segurança.',
    'portal_login_security', 'documentacao', COALESCE(p_evidence, '{}'::jsonb),
    '/clientes/portal?cliente=' || p_customer_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.register_portal_login_abuse(BIGINT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_portal_login_abuse(BIGINT, JSONB) TO service_role, authenticated;

-- Eventos normais continuam no histórico, mas não criam pendência coletiva.
CREATE OR REPLACE FUNCTION public.suppress_normal_portal_alert_events()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
BEGIN
  IF NEW.type IN ('portal_invoice_created', 'portal_consolidation_obsoleted') THEN
    NEW.status := 'closed';
    NEW.closed_at := COALESCE(NEW.closed_at, now());
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS suppress_normal_portal_alert_events ON public.alerts;
CREATE TRIGGER suppress_normal_portal_alert_events
BEFORE INSERT ON public.alerts
FOR EACH ROW EXECUTE FUNCTION public.suppress_normal_portal_alert_events();

-- ---------------------------------------------------------------------------
-- 3. Gate final, exceção crítica por B/L e reprocessamento pós-ativação.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_portal_invoice_exception(p_invoice_id BIGINT, p_bl_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_gate JSONB;
BEGIN
  v_gate := public.portal_billing_gate(p_bl_id);
  IF COALESCE((v_gate->>'allowed')::boolean, false) THEN
    PERFORM public.block521_resolve_alert('portal_excecao_critica_fatura', 'bl', p_bl_id, 'documentacao', 'portal_invoice_gate');
    RETURN;
  END IF;
  PERFORM public.block521_upsert_alert(
    'portal_excecao_critica_fatura', 'bl', p_bl_id,
    'Invoice emitida sem Portal ativo ou email de recuperação utilizável.',
    CASE WHEN current_setting('alerts.foundation_backfill', true) = 'on' THEN 'foundation_backfill' ELSE 'portal_invoice_gate' END,
    'documentacao',
    jsonb_build_object('invoice_id', p_invoice_id, 'gate', v_gate),
    '/manifestos/' || p_bl_id || '?tab=faturamento'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.portal_invoice_exception_on_issue()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_bl RECORD;
BEGIN
  IF NEW.status <> 'issued' OR (TG_OP = 'UPDATE' AND OLD.status = 'issued') THEN RETURN NEW; END IF;
  IF NEW.bl_id IS NOT NULL THEN
    PERFORM public.upsert_portal_invoice_exception(NEW.id, NEW.bl_id);
  END IF;
  FOR v_bl IN SELECT ib.bl_id FROM public.invoice_bls ib WHERE ib.invoice_id = NEW.id LOOP
    PERFORM public.upsert_portal_invoice_exception(NEW.id, v_bl.bl_id);
  END LOOP;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_portal_invoice_exception_open ON public.invoices;
CREATE TRIGGER trg_portal_invoice_exception_open
AFTER INSERT OR UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.portal_invoice_exception_on_issue();

CREATE OR REPLACE FUNCTION public.portal_invoice_exception_on_invoice_bl()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM public.invoices WHERE id = NEW.invoice_id;
  IF v_status = 'issued' THEN PERFORM public.upsert_portal_invoice_exception(NEW.invoice_id, NEW.bl_id); END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_portal_invoice_exception_invoice_bl ON public.invoice_bls;
CREATE TRIGGER trg_portal_invoice_exception_invoice_bl
AFTER INSERT ON public.invoice_bls
FOR EACH ROW EXECUTE FUNCTION public.portal_invoice_exception_on_invoice_bl();

CREATE OR REPLACE FUNCTION public.portal_invoice_exception_on_close()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_bl RECORD;
BEGIN
  IF NEW.status IN ('paid', 'partially_paid', 'cancelled', 'obsolete') AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.bl_id IS NOT NULL THEN PERFORM public.block521_resolve_alert('portal_excecao_critica_fatura', 'bl', NEW.bl_id, 'documentacao', 'portal_invoice_status'); END IF;
    FOR v_bl IN SELECT ib.bl_id FROM public.invoice_bls ib WHERE ib.invoice_id = NEW.id LOOP
      PERFORM public.block521_resolve_alert('portal_excecao_critica_fatura', 'bl', v_bl.bl_id, 'documentacao', 'portal_invoice_status');
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_portal_invoice_exception_close ON public.invoices;
CREATE TRIGGER trg_portal_invoice_exception_close
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.portal_invoice_exception_on_close();

CREATE OR REPLACE FUNCTION public.enforce_portal_invoice_gate()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_gate JSONB;
  v_bl RECORD;
BEGIN
  IF NEW.status = 'issued' THEN
    IF NEW.bl_id IS NOT NULL THEN
      v_gate := public.portal_billing_gate(NEW.bl_id);
      IF NOT COALESCE((v_gate->>'allowed')::boolean, false) THEN
        RAISE EXCEPTION 'Faturamento bloqueado pelo Portal: %', v_gate->>'reason' USING ERRCODE = 'P0003';
      END IF;
    END IF;
    FOR v_bl IN SELECT ib.bl_id FROM public.invoice_bls ib WHERE ib.invoice_id = NEW.id LOOP
      v_gate := public.portal_billing_gate(v_bl.bl_id);
      IF NOT COALESCE((v_gate->>'allowed')::boolean, false) THEN
        RAISE EXCEPTION 'Faturamento bloqueado pelo Portal para B/L %: %', v_bl.bl_id, v_gate->>'reason' USING ERRCODE = 'P0003';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_portal_invoice_gate ON public.invoices;
CREATE TRIGGER trg_enforce_portal_invoice_gate
BEFORE INSERT OR UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.enforce_portal_invoice_gate();

CREATE OR REPLACE FUNCTION public.enforce_portal_invoice_bl_gate()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_status TEXT;
  v_gate JSONB;
BEGIN
  SELECT status INTO v_status FROM public.invoices WHERE id = NEW.invoice_id;
  IF v_status = 'issued' THEN
    v_gate := public.portal_billing_gate(NEW.bl_id);
    IF NOT COALESCE((v_gate->>'allowed')::boolean, false) THEN
      RAISE EXCEPTION 'Faturamento bloqueado pelo Portal para B/L %: %', NEW.bl_id, v_gate->>'reason' USING ERRCODE = 'P0003';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_portal_invoice_bl_gate ON public.invoice_bls;
CREATE TRIGGER trg_enforce_portal_invoice_bl_gate
BEFORE INSERT ON public.invoice_bls
FOR EACH ROW EXECUTE FUNCTION public.enforce_portal_invoice_bl_gate();

CREATE OR REPLACE FUNCTION public.reprocess_customer_billing_after_portal_activation(p_customer_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor UUID;
  v_bl RECORD;
  v_issued INTEGER := 0;
  v_blocked INTEGER := 0;
  v_failed INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_actor FROM public.user_profiles WHERE active AND role IN ('admin', 'administrativo') ORDER BY created_at, id LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Não há usuário Administrativo ativo para reprocessar faturamento.' USING ERRCODE = 'P0002'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  FOR v_bl IN
    SELECT b.id, b.customer_id, b.customer_reconciliation_status
    FROM public.bls b
    WHERE b.customer_id = p_customer_id
      AND b.financial_status IS DISTINCT FROM 'cancelled'
      AND COALESCE(b.financial_status, 'pending') = 'pending'
      AND b.customer_reconciliation_status IN ('matched_document', 'reconciled')
    ORDER BY b.id
  LOOP
    BEGIN
      PERFORM public.mark_bl_ready_and_create_invoice(v_bl.id, p_customer_id, NULL, 'Reprocessamento idempotente após ativação do Portal.', v_actor);
      v_issued := v_issued + 1;
      PERFORM public.block521_resolve_alert('portal_reprocessamento_falhou', 'bl', v_bl.id, 'documentacao', 'portal_activation');
    EXCEPTION WHEN OTHERS THEN
      IF SQLSTATE IN ('P0003', '22023', 'P0002', 'P0004') THEN
        v_blocked := v_blocked + 1;
      ELSE
        v_failed := v_failed + 1;
        PERFORM public.block521_upsert_alert('portal_reprocessamento_falhou', 'bl', v_bl.id, 'Falha técnica ao reprocessar faturamento após ativação do Portal.', 'portal_activation', 'documentacao', jsonb_build_object('sqlstate', SQLSTATE, 'error', SQLERRM), '/manifestos/' || v_bl.id || '?tab=faturamento');
      END IF;
    END;
  END LOOP;
  RETURN jsonb_build_object('customer_id', p_customer_id, 'issued', v_issued, 'blocked', v_blocked, 'failed', v_failed);
END;
$function$;

REVOKE ALL ON FUNCTION public.reprocess_customer_billing_after_portal_activation(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reprocess_customer_billing_after_portal_activation(BIGINT) TO service_role;

-- Backfill da exceção crítica: a função de origem agora trabalha por B/L, e
-- não por número textual de invoice. Executar como service_role evita fan-out
-- de eventos históricos; a notificação nasce apenas de ocorrências futuras.
DO $backfill$
DECLARE
  v_invoice RECORD;
  v_bl RECORD;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('alerts.foundation_backfill', 'on', true);
  FOR v_invoice IN SELECT id, bl_id FROM public.invoices WHERE status = 'issued' LOOP
    IF v_invoice.bl_id IS NOT NULL THEN PERFORM public.upsert_portal_invoice_exception(v_invoice.id, v_invoice.bl_id); END IF;
    FOR v_bl IN SELECT ib.bl_id FROM public.invoice_bls ib WHERE ib.invoice_id = v_invoice.id LOOP
      PERFORM public.upsert_portal_invoice_exception(v_invoice.id, v_bl.bl_id);
    END LOOP;
  END LOOP;
  PERFORM set_config('alerts.foundation_backfill', '', true);
END;
$backfill$;

-- ---------------------------------------------------------------------------
-- 4. Dispute: conversa, mensagens, anexos, reabertura e RLS.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.demurrage_disputes (
  id BIGSERIAL PRIMARY KEY,
  demurrage_invoice_id BIGINT NOT NULL REFERENCES public.demurrage_invoices(id) ON DELETE RESTRICT,
  customer_id BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'aberta' CHECK (state IN ('aberta', 'resolvida', 'cancelada')),
  next_responder TEXT NOT NULL DEFAULT 'equipamentos' CHECK (next_responder IN ('cliente', 'equipamentos', 'ninguem')),
  subject TEXT,
  opened_by TEXT NOT NULL CHECK (opened_by IN ('cliente', 'equipamentos', 'sistema')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_demurrage_dispute_open_invoice
  ON public.demurrage_disputes(demurrage_invoice_id) WHERE state = 'aberta';
CREATE INDEX IF NOT EXISTS idx_demurrage_disputes_customer ON public.demurrage_disputes(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.demurrage_dispute_messages (
  id BIGSERIAL PRIMARY KEY,
  dispute_id BIGINT NOT NULL REFERENCES public.demurrage_disputes(id) ON DELETE RESTRICT,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_type TEXT NOT NULL CHECK (author_type IN ('cliente', 'equipamentos', 'sistema')),
  body TEXT NOT NULL CHECK (char_length(btrim(body)) >= 1),
  next_responder TEXT NOT NULL CHECK (next_responder IN ('cliente', 'equipamentos', 'ninguem')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.demurrage_dispute_attachments (
  id BIGSERIAL PRIMARY KEY,
  message_id BIGINT NOT NULL REFERENCES public.demurrage_dispute_messages(id) ON DELETE RESTRICT,
  dispute_id BIGINT NOT NULL REFERENCES public.demurrage_disputes(id) ON DELETE RESTRICT,
  customer_id BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  storage_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispute_messages_dispute ON public.demurrage_dispute_messages(dispute_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dispute_attachments_message ON public.demurrage_dispute_attachments(message_id);

DROP TRIGGER IF EXISTS set_demurrage_disputes_updated_at ON public.demurrage_disputes;
CREATE TRIGGER set_demurrage_disputes_updated_at BEFORE UPDATE ON public.demurrage_disputes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.demurrage_dispute_messages_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN RAISE EXCEPTION 'Mensagens de Dispute são imutáveis.' USING ERRCODE = '42501'; END;
$function$;
DROP TRIGGER IF EXISTS demurrage_dispute_messages_immutable ON public.demurrage_dispute_messages;
CREATE TRIGGER demurrage_dispute_messages_immutable BEFORE UPDATE OR DELETE ON public.demurrage_dispute_messages
FOR EACH ROW EXECUTE FUNCTION public.demurrage_dispute_messages_immutable();

ALTER TABLE public.demurrage_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demurrage_dispute_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demurrage_dispute_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS demurrage_disputes_internal_read ON public.demurrage_disputes;
CREATE POLICY demurrage_disputes_internal_read ON public.demurrage_disputes FOR SELECT TO authenticated USING (public.is_active_user());
DROP POLICY IF EXISTS demurrage_disputes_portal_read ON public.demurrage_disputes;
CREATE POLICY demurrage_disputes_portal_read ON public.demurrage_disputes FOR SELECT TO authenticated USING (customer_id = public.current_portal_customer_id());
DROP POLICY IF EXISTS demurrage_dispute_messages_internal_read ON public.demurrage_dispute_messages;
CREATE POLICY demurrage_dispute_messages_internal_read ON public.demurrage_dispute_messages FOR SELECT TO authenticated USING (public.is_active_user());
DROP POLICY IF EXISTS demurrage_dispute_messages_portal_read ON public.demurrage_dispute_messages;
CREATE POLICY demurrage_dispute_messages_portal_read ON public.demurrage_dispute_messages FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.demurrage_disputes d WHERE d.id = dispute_id AND d.customer_id = public.current_portal_customer_id()));
DROP POLICY IF EXISTS demurrage_dispute_attachments_internal_read ON public.demurrage_dispute_attachments;
CREATE POLICY demurrage_dispute_attachments_internal_read ON public.demurrage_dispute_attachments FOR SELECT TO authenticated USING (public.is_active_user());
DROP POLICY IF EXISTS demurrage_dispute_attachments_portal_read ON public.demurrage_dispute_attachments;
CREATE POLICY demurrage_dispute_attachments_portal_read ON public.demurrage_dispute_attachments FOR SELECT TO authenticated USING (customer_id = public.current_portal_customer_id());

REVOKE INSERT, UPDATE, DELETE ON public.demurrage_disputes, public.demurrage_dispute_messages, public.demurrage_dispute_attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.demurrage_disputes, public.demurrage_dispute_messages, public.demurrage_dispute_attachments TO authenticated;
REVOKE ALL ON FUNCTION public.demurrage_dispute_messages_immutable() FROM PUBLIC, anon, authenticated;

-- Storage is managed by Supabase and therefore absent from the disposable
-- vanilla Postgres shim. The guarded block still applies the bucket and RLS
-- policies in Supabase while allowing the local migration replay to validate
-- the relational contract.
DO $storage$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
      VALUES ('demurrage-disputes', 'demurrage-disputes', false, 10485760, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'text/plain'])
      ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760
    $sql$;
    EXECUTE 'DROP POLICY IF EXISTS demurrage_dispute_objects_read ON storage.objects';
    EXECUTE $sql$
      CREATE POLICY demurrage_dispute_objects_read ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'demurrage-disputes' AND (public.is_active_user() OR (name LIKE (public.current_portal_customer_id()::text || '/%'))))
    $sql$;
    EXECUTE 'DROP POLICY IF EXISTS demurrage_dispute_objects_insert ON storage.objects';
    EXECUTE $sql$
      CREATE POLICY demurrage_dispute_objects_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'demurrage-disputes' AND (public.is_active_user() OR (name LIKE (public.current_portal_customer_id()::text || '/%'))))
    $sql$;
  END IF;
END;
$storage$;

CREATE OR REPLACE FUNCTION public.ensure_demurrage_dispute(p_invoice_id BIGINT, p_customer_id BIGINT, p_opened_by TEXT, p_subject TEXT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_id BIGINT;
BEGIN
  SELECT id INTO v_id FROM public.demurrage_disputes WHERE demurrage_invoice_id = p_invoice_id AND state = 'aberta' FOR UPDATE;
  IF v_id IS NULL THEN
    INSERT INTO public.demurrage_disputes(demurrage_invoice_id, customer_id, opened_by, subject, state, next_responder)
    VALUES (p_invoice_id, p_customer_id, p_opened_by, p_subject, 'aberta', 'equipamentos')
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.ensure_demurrage_dispute(BIGINT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_demurrage_dispute(BIGINT, BIGINT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.portal_add_dispute_message(p_demurrage_invoice_id BIGINT, p_body TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_invoice RECORD;
  v_dispute_id BIGINT;
  v_message_id BIGINT;
BEGIN
  IF NULLIF(btrim(p_body), '') IS NULL THEN RAISE EXCEPTION 'Informe a mensagem da disputa.' USING ERRCODE = '22023'; END IF;
  SELECT id, customer_id, doc_number INTO v_invoice FROM public.demurrage_invoices WHERE id = p_demurrage_invoice_id AND customer_id = v_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fatura de demurrage não encontrada.' USING ERRCODE = 'P0002'; END IF;
  v_dispute_id := public.ensure_demurrage_dispute(v_invoice.id, v_customer_id, 'cliente', NULL);
  INSERT INTO public.demurrage_dispute_messages(dispute_id, author_id, author_type, body, next_responder, metadata)
  VALUES (v_dispute_id, auth.uid(), 'cliente', btrim(p_body), 'equipamentos', jsonb_build_object('channel', 'portal'))
  RETURNING id INTO v_message_id;
  UPDATE public.demurrage_disputes SET next_responder = 'equipamentos' WHERE id = v_dispute_id;
  UPDATE public.demurrage_invoices SET dispute_open = true, dispute_status = 'aberto', dispute_reason = COALESCE(dispute_reason, btrim(p_body)) WHERE id = v_invoice.id;
  PERFORM public.block521_upsert_alert('portal_dispute_opened', 'demurrage_invoice', v_invoice.id::text, 'Cliente enviou mensagem na Dispute ' || v_invoice.doc_number || '; resposta de Equipamentos pendente.', 'portal_dispute_message', 'equipamentos', jsonb_build_object('dispute_id', v_dispute_id, 'message_id', v_message_id), '/demurrage?dispute=' || v_dispute_id);
  RETURN jsonb_build_object('dispute_id', v_dispute_id, 'message_id', v_message_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.portal_open_demurrage_dispute(p_demurrage_invoice_id BIGINT, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
BEGIN
  RETURN public.portal_add_dispute_message(p_demurrage_invoice_id, p_reason);
END;
$function$;

REVOKE ALL ON FUNCTION public.portal_add_dispute_message(BIGINT, TEXT), public.portal_open_demurrage_dispute(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_add_dispute_message(BIGINT, TEXT), public.portal_open_demurrage_dispute(BIGINT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_demurrage_dispute_message(p_dispute_id BIGINT, p_body TEXT, p_next_responder TEXT DEFAULT 'cliente')
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_dispute public.demurrage_disputes%ROWTYPE;
  v_message_id BIGINT;
BEGIN
  IF v_role <> 'equipamentos' THEN RAISE EXCEPTION 'Apenas Equipamentos pode responder a Dispute.' USING ERRCODE = '42501'; END IF;
  IF p_next_responder NOT IN ('cliente', 'equipamentos', 'ninguem') THEN RAISE EXCEPTION 'Responsável inválido.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_dispute FROM public.demurrage_disputes WHERE id = p_dispute_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dispute não encontrada.' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.demurrage_dispute_messages(dispute_id, author_id, author_type, body, next_responder, metadata)
  VALUES (p_dispute_id, auth.uid(), 'equipamentos', btrim(p_body), p_next_responder, jsonb_build_object('channel', 'internal'))
  RETURNING id INTO v_message_id;
  UPDATE public.demurrage_disputes SET next_responder = p_next_responder WHERE id = p_dispute_id;
  IF p_next_responder = 'cliente' THEN
    PERFORM public.block521_resolve_alert('portal_dispute_opened', 'demurrage_invoice', v_dispute.demurrage_invoice_id::text, 'equipamentos', 'portal_dispute_message');
  ELSIF p_next_responder = 'equipamentos' THEN
    PERFORM public.block521_upsert_alert('portal_dispute_opened', 'demurrage_invoice', v_dispute.demurrage_invoice_id::text, 'Nova resposta na Dispute; ação de Equipamentos pendente.', 'portal_dispute_message', 'equipamentos', jsonb_build_object('dispute_id', p_dispute_id, 'message_id', v_message_id), '/demurrage?dispute=' || p_dispute_id);
  ELSE
    PERFORM public.block521_resolve_alert('portal_dispute_opened', 'demurrage_invoice', v_dispute.demurrage_invoice_id::text, 'equipamentos', 'portal_dispute_message');
  END IF;
  RETURN jsonb_build_object('dispute_id', p_dispute_id, 'message_id', v_message_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_demurrage_dispute(p_dispute_id BIGINT, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_dispute public.demurrage_disputes%ROWTYPE;
BEGIN
  IF v_role <> 'equipamentos' THEN RAISE EXCEPTION 'Apenas Equipamentos pode reabrir a Dispute.' USING ERRCODE = '42501'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_dispute FROM public.demurrage_disputes WHERE id = p_dispute_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dispute não encontrada.' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.demurrage_disputes SET state = 'aberta', next_responder = 'equipamentos', resolved_at = NULL, cancelled_at = NULL WHERE id = p_dispute_id;
  INSERT INTO public.demurrage_dispute_messages(dispute_id, author_id, author_type, body, next_responder, metadata)
  VALUES (p_dispute_id, auth.uid(), 'equipamentos', btrim(p_reason), 'equipamentos', jsonb_build_object('action', 'reopen'));
  UPDATE public.demurrage_invoices SET dispute_open = true, dispute_status = 'aberto' WHERE id = v_dispute.demurrage_invoice_id;
  PERFORM public.block521_upsert_alert('portal_dispute_opened', 'demurrage_invoice', v_dispute.demurrage_invoice_id::text, 'Dispute reaberta; análise de Equipamentos pendente.', 'portal_dispute_reopened', 'equipamentos', jsonb_build_object('dispute_id', p_dispute_id), '/demurrage?dispute=' || p_dispute_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.portal_request_dispute_reopen(p_dispute_id BIGINT, p_body TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_dispute public.demurrage_disputes%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_body), '') IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_dispute FROM public.demurrage_disputes WHERE id = p_dispute_id AND customer_id = v_customer_id;
  IF NOT FOUND OR v_dispute.state <> 'resolvida' THEN RAISE EXCEPTION 'Dispute não está disponível para solicitação de reabertura.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.demurrage_dispute_messages(dispute_id, author_id, author_type, body, next_responder, metadata)
  VALUES (p_dispute_id, auth.uid(), 'cliente', btrim(p_body), 'equipamentos', jsonb_build_object('action', 'reopen_request'));
  PERFORM public.block521_upsert_alert('portal_dispute_opened', 'demurrage_invoice', v_dispute.demurrage_invoice_id::text, 'Cliente solicitou reabertura de uma Dispute; decisão de Equipamentos pendente.', 'portal_dispute_reopen_request', 'equipamentos', jsonb_build_object('dispute_id', p_dispute_id), '/demurrage?dispute=' || p_dispute_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.add_demurrage_dispute_message(BIGINT, TEXT, TEXT), public.reopen_demurrage_dispute(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_demurrage_dispute_message(BIGINT, TEXT, TEXT), public.reopen_demurrage_dispute(BIGINT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.portal_request_dispute_reopen(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_request_dispute_reopen(BIGINT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.portal_list_disputes()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $function$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', d.id, 'demurrage_invoice_id', d.demurrage_invoice_id,
      'doc_number', di.doc_number, 'state', d.state,
      'next_responder', d.next_responder, 'subject', d.subject,
      'created_at', d.created_at, 'updated_at', d.updated_at,
      'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'author_type', m.author_type, 'body', m.body, 'next_responder', m.next_responder, 'created_at', m.created_at, 'attachments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type, 'storage_path', a.storage_path)) FROM public.demurrage_dispute_attachments a WHERE a.message_id = m.id), '[]'::jsonb)) ORDER BY m.created_at) FROM public.demurrage_dispute_messages m WHERE m.dispute_id = d.id), '[]'::jsonb)
    ) ORDER BY d.created_at DESC)
    FROM public.demurrage_disputes d
    JOIN public.demurrage_invoices di ON di.id = d.demurrage_invoice_id
    WHERE d.customer_id = public.current_portal_customer_id()
  ), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.portal_list_disputes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_list_disputes() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_demurrage_disputes_internal(p_state TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $function$
BEGIN
  IF public._portal_actor_role() <> 'equipamentos' THEN
    RAISE EXCEPTION 'Apenas Equipamentos pode consultar a fila de Disputes.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', d.id, 'demurrage_invoice_id', d.demurrage_invoice_id,
      'doc_number', di.doc_number, 'customer_id', d.customer_id,
      'customer_name', c.name, 'state', d.state,
      'next_responder', d.next_responder, 'subject', d.subject,
      'created_at', d.created_at, 'updated_at', d.updated_at,
      'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'author_type', m.author_type, 'body', m.body, 'next_responder', m.next_responder, 'created_at', m.created_at) ORDER BY m.created_at) FROM public.demurrage_dispute_messages m WHERE m.dispute_id = d.id), '[]'::jsonb)
    ) ORDER BY d.updated_at DESC)
    FROM public.demurrage_disputes d
    JOIN public.demurrage_invoices di ON di.id = d.demurrage_invoice_id
    JOIN public.customers c ON c.id = d.customer_id
    WHERE p_state IS NULL OR d.state = p_state
  ), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.list_demurrage_disputes_internal(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_demurrage_disputes_internal(TEXT) TO authenticated;

-- Dados legados viram uma conversa mínima; nunca removemos o texto original.
DO $dispute_backfill$
DECLARE
  v_invoice RECORD;
  v_dispute BIGINT;
BEGIN
  FOR v_invoice IN SELECT id, customer_id, dispute_subject, dispute_reason, dispute_notes FROM public.demurrage_invoices WHERE dispute_open OR dispute_status IS NOT NULL LOOP
    v_dispute := public.ensure_demurrage_dispute(v_invoice.id, v_invoice.customer_id, 'sistema', v_invoice.dispute_subject);
    IF NOT EXISTS (SELECT 1 FROM public.demurrage_dispute_messages WHERE dispute_id = v_dispute) THEN
      INSERT INTO public.demurrage_dispute_messages(dispute_id, author_type, body, next_responder, metadata)
      VALUES (v_dispute, 'sistema', COALESCE(v_invoice.dispute_reason, v_invoice.dispute_notes, 'Dispute migrada do histórico legado.'), CASE WHEN v_invoice.dispute_status IN ('resolvido', 'cancelado') THEN 'ninguem' ELSE 'equipamentos' END, jsonb_build_object('source', 'legacy_backfill'));
    END IF;
    IF v_invoice.dispute_status = 'resolvido' THEN UPDATE public.demurrage_disputes SET state = 'resolvida', next_responder = 'ninguem', resolved_at = COALESCE(resolved_at, now()) WHERE id = v_dispute; END IF;
    IF v_invoice.dispute_status = 'cancelado' THEN UPDATE public.demurrage_disputes SET state = 'cancelada', next_responder = 'ninguem', cancelled_at = COALESCE(cancelled_at, now()) WHERE id = v_dispute; END IF;
  END LOOP;
END;
$dispute_backfill$;

-- Reconciliadores e notificações server-side passam pela mesma função. O
-- executor 319 continua sendo o único cron; não há polling de tela.
CREATE OR REPLACE FUNCTION public.run_alert_detectors()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_actor UUID;
  v_portal JSONB;
  v_overdue INTEGER := 0;
  v_adr_pending INTEGER := 0;
  v_adr_deadline INTEGER := 0;
  v_bl_review INTEGER := 0;
  v_granite_review INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_actor FROM public.user_profiles WHERE active AND role <> 'equipamentos' ORDER BY CASE WHEN role IN ('admin', 'administrativo') THEN 0 ELSE 1 END, created_at, id LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Não há usuário interno ativo para executar os detectores.' USING ERRCODE = 'P0002'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('alerts.detector_runner', 'on', true);
  v_overdue := public.detect_overdue_invoices();
  v_adr_pending := public.detect_agency_report_pending();
  v_adr_deadline := public.detect_agency_report_deadline_missed();
  v_bl_review := public.detect_bl_review_pendencies();
  v_granite_review := public.detect_granite_bl_review_pendencies();
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v_portal := public.reconcile_client_portal_alerts();
  RETURN jsonb_build_object(
    'overdue_invoices', v_overdue,
    'agency_report_pending', v_adr_pending,
    'agency_report_deadline_missed', v_adr_deadline,
    'bl_review_pendencies', v_bl_review,
    'granite_bl_review_pendencies', v_granite_review,
    'client_portal', v_portal
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.run_alert_detectors() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_alert_detectors() TO service_role;

