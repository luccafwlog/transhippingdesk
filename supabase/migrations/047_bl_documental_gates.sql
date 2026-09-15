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
-- The Portal projection can be rolled back by restoring the previous body of
-- get_bl_portal_status, which omitted portal_access_ready.

-- Keep the internal B/L lookup as the only source of the customer id passed to
-- the privileged Portal predicate. The response remains scoped to p_bl_id and
-- preserves the existing notification/dispute payload.
CREATE OR REPLACE FUNCTION public.get_bl_portal_status(p_bl_id text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_customer_id BIGINT;
  v_ce_mercante TEXT;
  v_account_situation TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT b.customer_id, b.ce_mercante
  INTO v_customer_id, v_ce_mercante
  FROM public.bls b
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  SELECT a.account_situation
  INTO v_account_situation
  FROM public.customer_portal_accounts a
  WHERE a.customer_id = v_customer_id;

  RETURN jsonb_build_object(
    'customer_id', v_customer_id,
    'ce_mercante', v_ce_mercante,
    'account_situation', v_account_situation,
    'portal_access_ready', public.customer_portal_access_ready(v_customer_id),
    'notifications', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id,
        'type', n.type,
        'title', n.title,
        'created_at', n.created_at,
        'read_at', n.read_at
      ) ORDER BY n.created_at DESC)
      FROM (
        SELECT id, type, title, created_at, read_at
        FROM public.portal_notifications
        WHERE bl_id = p_bl_id
        ORDER BY created_at DESC
        LIMIT 10
      ) n
    ), '[]'::JSONB),
    'open_disputes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id,
        'doc_number', d.doc_number,
        'dispute_status', d.dispute_status
      ) ORDER BY d.id DESC)
      FROM public.demurrage_invoices d
      WHERE d.bl_id = p_bl_id
        AND d.dispute_open = true
    ), '[]'::JSONB)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_bl_portal_status(p_bl_id text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bl_portal_status(p_bl_id text) TO authenticated;

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
  v_scan_links BOOLEAN := false;
BEGIN
  IF NEW.status = 'issued' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.bl_id IS NOT NULL THEN
        PERFORM public.assert_bl_ce_mercante(NEW.bl_id);
      END IF;
      v_scan_links := true;
    ELSE
      IF OLD.status IS DISTINCT FROM NEW.status THEN
        IF NEW.bl_id IS NOT NULL THEN
          PERFORM public.assert_bl_ce_mercante(NEW.bl_id);
        END IF;
        v_scan_links := true;
      ELSIF OLD.bl_id IS DISTINCT FROM NEW.bl_id THEN
        -- A direct invoice.bl_id change is a distinct boundary from issue;
        -- validate only the newly assigned B/L because existing links are
        -- unchanged and were already guarded when they were created/issued.
        IF NEW.bl_id IS NOT NULL THEN
          PERFORM public.assert_bl_ce_mercante(NEW.bl_id);
        END IF;
        RETURN NEW;
      ELSE
        -- UPDATEs of unrelated columns on an issued invoice do not needlessly
        -- rescan the direct and consolidated link tables.
        RETURN NEW;
      END IF;
    END IF;

    -- Inserts and issue transitions must validate every linked B/L because
    -- draft invoices may have acquired links before becoming issued.
    IF v_scan_links THEN
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
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_invoice_ce_on_issue() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_invoice_ce_on_issue ON public.invoices;
CREATE TRIGGER trg_enforce_invoice_ce_on_issue
BEFORE INSERT OR UPDATE OF status, bl_id ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_ce_on_issue();
