-- B/L Documental gates
--
-- Business intent: CE Mercante is a release prerequisite for issuing an
-- invoice, regardless of cargo mode. Drafts can be prepared before the CE is
-- available, but an issued individual or consolidated invoice cannot contain
-- a B/L without it. The Portal already uses bl_has_portal_release as its
-- universal CE visibility authority; this migration closes the internal
-- billing boundaries and keeps the two authorities aligned.
--
-- Rollback: drop the three CE triggers and their trigger functions, then
-- restore mark_bl_ready_for_billing from the previous active definition. The
-- assertion function can be dropped after the trigger functions are removed.

CREATE OR REPLACE FUNCTION public.assert_bl_ce_mercante(p_bl_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl_id TEXT;
BEGIN
  v_bl_id := NULLIF(UPPER(BTRIM(p_bl_id)), '');

  IF v_bl_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.bls
    WHERE UPPER(BTRIM(id)) = v_bl_id
      AND NULLIF(BTRIM(ce_mercante), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'B/L % sem CE Mercante. Cadastre o CE antes de faturar.', p_bl_id
      USING ERRCODE = 'P0003';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_bl_ce_mercante(text) FROM PUBLIC, anon, authenticated;

-- The readiness RPC is also used by the internal billing workflow. Keep its
-- existing validation order and side effects, adding only the universal CE
-- prerequisite after the B/L existence check.
CREATE OR REPLACE FUNCTION public.mark_bl_ready_for_billing(p_bl_id text, p_actor uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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

  PERFORM public.assert_bl_ce_mercante(p_bl_id);

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
$$;

REVOKE ALL ON FUNCTION public.mark_bl_ready_for_billing(p_bl_id text, p_actor uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_bl_ready_for_billing(p_bl_id text, p_actor uuid) TO authenticated;

-- Link-level guards cover inserts performed after an invoice is created as
-- issued, including direct individual links and consolidated receivables.
CREATE OR REPLACE FUNCTION public.enforce_invoice_ce_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status
  FROM public.invoices
  WHERE id = NEW.invoice_id;

  IF v_status = 'issued' THEN
    PERFORM public.assert_bl_ce_mercante(NEW.bl_id);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_invoice_ce_gate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_invoice_ce_gate ON public.invoice_bls;
CREATE TRIGGER trg_enforce_invoice_ce_gate
BEFORE INSERT OR UPDATE OF invoice_id, bl_id ON public.invoice_bls
FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_ce_gate();

CREATE OR REPLACE FUNCTION public.enforce_receivable_invoice_ce_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status
  FROM public.invoices
  WHERE id = NEW.invoice_id;

  IF v_status = 'issued' AND NEW.status = 'active' THEN
    PERFORM public.assert_bl_ce_mercante(NEW.bl_id);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_receivable_invoice_ce_gate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_receivable_invoice_ce_gate ON public.invoice_receivable_links;
CREATE TRIGGER trg_enforce_receivable_invoice_ce_gate
BEFORE INSERT OR UPDATE OF invoice_id, bl_id, status ON public.invoice_receivable_links
FOR EACH ROW EXECUTE FUNCTION public.enforce_receivable_invoice_ce_gate();

-- Invoice-level guard covers the inverse order: a draft invoice may receive
-- links first and only later transition to issued. It checks both link tables
-- so the consolidated path cannot bypass the same CE rule.
CREATE OR REPLACE FUNCTION public.enforce_invoice_ce_on_issue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl RECORD;
BEGIN
  IF NEW.status = 'issued' THEN
    IF TG_OP = 'INSERT' THEN
      NULL;
    ELSIF OLD.status IS NOT DISTINCT FROM NEW.status THEN
      RETURN NEW;
    END IF;

    IF NEW.bl_id IS NOT NULL THEN
      PERFORM public.assert_bl_ce_mercante(NEW.bl_id);
    END IF;

    FOR v_bl IN
      SELECT ib.bl_id
      FROM public.invoice_bls AS ib
      WHERE ib.invoice_id = NEW.id
    LOOP
      PERFORM public.assert_bl_ce_mercante(v_bl.bl_id);
    END LOOP;

    FOR v_bl IN
      SELECT irl.bl_id
      FROM public.invoice_receivable_links AS irl
      WHERE irl.invoice_id = NEW.id
        AND irl.status = 'active'
    LOOP
      PERFORM public.assert_bl_ce_mercante(v_bl.bl_id);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_invoice_ce_on_issue() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_invoice_ce_on_issue ON public.invoices;
CREATE TRIGGER trg_enforce_invoice_ce_on_issue
BEFORE INSERT OR UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_ce_on_issue();
