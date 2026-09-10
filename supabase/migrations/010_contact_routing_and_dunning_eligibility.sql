-- 010: roteamento de caixas e elegibilidade da régua (S06 — A1/A3/A9, D04/D11).
--
-- A1: repair_customer_contact_box_fallbacks não escolhe mais contato arbitrário.
-- Sem principal elegível a caixa fica sem destinatário, com alerta cadastral;
-- nunca vincula alternativo apenas-operacional à caixa de Demurrage.
-- A3: claim/sendable exigem a mesma regra canônica (desativação + vínculo de
-- caixa + supressões); pausados não consomem a régua (release reusa o mesmo
-- discriminador) e não voltam como trabalho quente (inelegível nem é claimed).
-- A9: nenhuma leitura de produção a customer_contact_preferences; tabela e
-- coluna purpose preservadas para rollback.
-- D11: agrupamento por cliente/ciclo vive na Edge (uma mensagem por
-- cliente/ciclo/destinatário); o lease recovery abaixo reconhece a mensagem
-- agrupada via bl_links além do anchor_invoice_id.
-- D04: gate da chave global vive no webhook; supressão/reparo/alerta seguem ativos.

-- ===========================================================================
-- 1. repair_customer_contact_box_fallbacks: só o principal religa a caixa
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.repair_customer_contact_box_fallbacks(
  p_customer_id bigint,
  p_kind text DEFAULT NULL,
  p_box_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_box_codes text[] := ARRAY[]::text[];
  v_box text;
  v_primary_id bigint;
  v_relinked_boxes text[] := ARRAY[]::text[];
  v_blocked_boxes text[] := ARRAY[]::text[];
  v_has_recipient boolean;
  v_before_config jsonb;
  v_after_config jsonb;
  v_unlinked_count integer := 0;
  v_action_id uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Permissão negada para reparar caixas de contato.' USING ERRCODE = '42501';
  END IF;

  IF p_customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'customer_id obrigatorio');
  END IF;

  PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;

  v_before_config := public._build_customer_contact_configuration(p_customer_id);

  IF p_box_code IS NOT NULL THEN
    v_box_codes := ARRAY[p_box_code];
  ELSIF p_kind IS NOT NULL THEN
    SELECT COALESCE(array_agg(box_code), ARRAY[]::text[]) INTO v_box_codes
    FROM public.customer_communication_box_kinds
    WHERE kind = p_kind;
  ELSE
    SELECT COALESCE(array_agg(code), ARRAY[]::text[]) INTO v_box_codes
    FROM public.customer_communication_boxes
    WHERE active = true;
  END IF;

  WITH unlinked AS (
    DELETE FROM public.customer_contact_box_links l
    USING public.customer_contacts cc, public.portal_suppressed_emails pse
    WHERE l.contact_id = cc.id
      AND cc.customer_id = p_customer_id
      AND cc.email_normalized = lower(btrim(pse.email))
      AND pse.reason = 'bounce_permanente'
      AND l.box_code = ANY(v_box_codes)
    RETURNING l.*
  )
  SELECT count(*)::integer INTO v_unlinked_count FROM unlinked;

  FOREACH v_box IN ARRAY v_box_codes
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.customer_contacts cc
      JOIN public.customer_contact_box_links l ON l.contact_id = cc.id
      WHERE cc.customer_id = p_customer_id
        AND cc.deactivated_at IS NULL
        AND cc.email_normalized IS NOT NULL
        AND l.box_code = v_box
        AND NOT EXISTS (
          SELECT 1 FROM public.portal_suppressed_emails pse
          WHERE lower(btrim(pse.email)) = cc.email_normalized AND pse.reason = 'bounce_permanente'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communication_suppressions ccs
          WHERE lower(btrim(ccs.email)) = cc.email_normalized
        )
    ) INTO v_has_recipient;

    IF NOT v_has_recipient THEN
      -- S06: somente o principal ativo e elegível religa a caixa. Sem ele,
      -- a caixa permanece sem destinatário (pausa a cobrança) com alerta
      -- cadastral — nunca um alternativo apenas-operacional na Demurrage.
      SELECT cc.id INTO v_primary_id
      FROM public.customer_contacts cc
      WHERE cc.customer_id = p_customer_id
        AND cc.is_primary = true
        AND cc.deactivated_at IS NULL
        AND cc.email_normalized IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.portal_suppressed_emails pse
          WHERE lower(btrim(pse.email)) = cc.email_normalized AND pse.reason = 'bounce_permanente'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communication_suppressions ccs
          WHERE lower(btrim(ccs.email)) = cc.email_normalized
        )
      LIMIT 1;

      IF v_primary_id IS NOT NULL THEN
        INSERT INTO public.customer_contact_box_links (contact_id, box_code)
        VALUES (v_primary_id, v_box)
        ON CONFLICT DO NOTHING;

        v_relinked_boxes := array_append(v_relinked_boxes, v_box);
      ELSE
        v_blocked_boxes := array_append(v_blocked_boxes, v_box);
        PERFORM public.upsert_alert_item(
          'caixa_sem_destinatario',
          'customer',
          p_customer_id::text,
          'A caixa ' || v_box || ' não possui contatos ativos elegíveis.',
          'sistema',
          jsonb_build_object('customer_id', p_customer_id, 'box_code', v_box),
          '/clientes'
        );
      END IF;
    END IF;
  END LOOP;

  v_after_config := public._build_customer_contact_configuration(p_customer_id);
  IF v_unlinked_count > 0 OR cardinality(v_relinked_boxes) > 0 OR cardinality(v_blocked_boxes) > 0 THEN
    INSERT INTO public.customer_contact_change_events (
      action_id, customer_id, source, before_snapshot, after_snapshot, change_summary
    )
    VALUES (
      v_action_id,
      p_customer_id,
      'sistema',
      v_before_config->'contacts',
      v_after_config->'contacts',
      jsonb_build_object(
        'action', 'bounce_fallback_repair',
        'unlinked_count', v_unlinked_count,
        'relinked_boxes', to_jsonb(v_relinked_boxes),
        'blocked_boxes', to_jsonb(v_blocked_boxes)
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'relinked_boxes', to_jsonb(v_relinked_boxes),
    'blocked_boxes', to_jsonb(v_blocked_boxes)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.repair_customer_contact_box_fallbacks(bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_customer_contact_box_fallbacks(bigint, text, text) TO service_role;

-- ===========================================================================
-- 2. customer_communication_recipient_allowed: regra canônica de envio
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.customer_communication_recipient_allowed(
  p_customer_id bigint,
  p_contact_id bigint,
  p_kind text DEFAULT NULL,
  p_audience_mode text DEFAULT 'caixa',
  p_recipient_box_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_contact record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Acesso negado para consultar autorização de destinatário.' USING ERRCODE = '42501';
  END IF;

  IF p_customer_id IS NULL OR p_contact_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT id, customer_id, email_normalized, deactivated_at
  INTO v_contact
  FROM public.customer_contacts
  WHERE id = p_contact_id AND customer_id = p_customer_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_contact.deactivated_at IS NOT NULL OR v_contact.email_normalized IS NULL THEN
    RETURN false;
  END IF;

  IF v_contact.email_normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.portal_suppressed_emails pse
    WHERE lower(btrim(pse.email)) = v_contact.email_normalized AND pse.reason = 'bounce_permanente'
  ) OR EXISTS (
    SELECT 1 FROM public.customer_communication_suppressions ccs
    WHERE lower(btrim(ccs.email)) = v_contact.email_normalized
  ) THEN
    RETURN false;
  END IF;

  IF p_audience_mode = 'todos' OR p_kind = 'institucional' THEN
    RETURN true;
  END IF;

  IF p_recipient_box_code IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM public.customer_contact_box_links l
      JOIN public.customer_communication_boxes b ON b.code = l.box_code
      WHERE l.contact_id = p_contact_id AND l.box_code = p_recipient_box_code AND b.active = true
    );
  END IF;

  IF p_kind IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM public.customer_contact_box_links l
      JOIN public.customer_communication_box_kinds k ON k.box_code = l.box_code
      JOIN public.customer_communication_boxes b ON b.code = l.box_code
      WHERE l.contact_id = p_contact_id AND k.kind = p_kind AND b.active = true
    );
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.customer_communication_recipient_allowed(
  bigint, bigint, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_communication_recipient_allowed(
  bigint, bigint, text, text, text
) TO authenticated, service_role;

-- ===========================================================================
-- 3. claim_demurrage_dunning_candidates: elegibilidade estrita, sem starvation
-- ===========================================================================
-- S06: exige desativação + vínculo demurrage/financeiro + supressões, sem
-- customer_contact_preferences. Inelegível nem entra no lote: 50 inelegíveis
-- à frente não bloqueiam os 10 elegíveis seguintes. Pausado liberado reusa o
-- mesmo discriminador (não consome a régua).

CREATE OR REPLACE FUNCTION public.claim_demurrage_dunning_candidates(
  p_as_of timestamp with time zone DEFAULT now(),
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_invoice RECORD;
  v_interval_days INTEGER;
  v_limit INTEGER;
  v_inserted INTEGER;
  v_claimed_at TIMESTAMPTZ;
  v_candidates JSONB := '[]'::JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NOT NULL AND p_limit < 1 THEN
    RAISE EXCEPTION 'O limite do lote deve ser positivo.' USING ERRCODE = '22023';
  END IF;
  v_limit := LEAST(COALESCE(p_limit, 50), 100);
  SELECT GREATEST(COALESCE(demurrage_dunning_interval_days, 7), 1) INTO v_interval_days FROM public.app_settings WHERE id = 1;
  v_interval_days := COALESCE(v_interval_days, 7);

  -- Libera claims de execuções anteriores que reservaram mas não concluíram o
  -- envio após 30 minutos. Concluído = comunicado enviado/simulado por
  -- anchor_invoice_id (legado por fatura) ou por bl_links (mensagem agrupada
  -- D11 por cliente/ciclo com bl_ids de todas as faturas do grupo).
  UPDATE public.demurrage_dunning_claims AS claim
  SET released_at = COALESCE(p_as_of, now())
  WHERE claim.released_at IS NULL
    AND claim.claimed_at < COALESCE(p_as_of, now()) - interval '30 minutes'
    AND NOT EXISTS (
      SELECT 1
      FROM public.customer_communications AS comm
      WHERE comm.kind = 'cobranca_demurrage'
        AND comm.attempt_discriminator = claim.attempt_discriminator
        AND comm.status IN ('enviado', 'simulado')
        AND (
          comm.anchor_invoice_id = claim.demurrage_invoice_id
          OR EXISTS (
            SELECT 1
            FROM public.customer_communication_bls AS bl
            JOIN public.demurrage_invoices AS di ON di.bl_id = bl.bl_id
            WHERE bl.communication_id = comm.id
              AND di.id = claim.demurrage_invoice_id
          )
        )
    );

  FOR v_invoice IN
    SELECT di.id, di.customer_id, di.bl_id, di.doc_number, di.total_usd, di.current_total_brl,
      di.current_roe, di.roe_source, di.first_billed_at,
      COALESCE(claims.claimed_at, now()) AS claimed_at,
      COALESCE(di.updated_at::DATE, di.doc_date, CURRENT_DATE)::TEXT AS roe_reference_date,
      COALESCE(claims.attempt_count, 0)::INTEGER + 1 AS attempt_discriminator
    FROM public.demurrage_invoices AS di
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE prior_claim.released_at IS NULL)::INTEGER AS attempt_count,
        max(prior_claim.claimed_at) FILTER (WHERE prior_claim.released_at IS NULL) AS claimed_at
      FROM public.demurrage_dunning_claims AS prior_claim
      WHERE prior_claim.demurrage_invoice_id = di.id
    ) AS claims ON true
    WHERE COALESCE(di.status, 'issued') IN ('issued', 'overdue')
      AND di.first_billed_at IS NOT NULL AND di.paid_at IS NULL
      AND COALESCE(di.dispute_open, false) = false
      AND EXISTS (
        SELECT 1 FROM public.customer_contacts AS cc
        JOIN public.customer_contact_box_links AS bl ON bl.contact_id = cc.id
        WHERE cc.customer_id = di.customer_id
          AND cc.deactivated_at IS NULL
          AND cc.email_normalized IS NOT NULL
          AND cc.email_normalized ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
          AND bl.box_code IN ('demurrage', 'financeiro')
          AND NOT EXISTS (
            SELECT 1 FROM public.portal_suppressed_emails pse
            WHERE lower(btrim(pse.email)) = cc.email_normalized AND pse.reason = 'bounce_permanente'
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.customer_communication_suppressions ccs
            WHERE lower(btrim(ccs.email)) = cc.email_normalized
          )
      )
      AND COALESCE(p_as_of, now()) >= (di.first_billed_at::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo' + make_interval(days => v_interval_days * COALESCE(claims.attempt_count, 0)))
    ORDER BY di.id
    LIMIT v_limit
    FOR UPDATE OF di SKIP LOCKED
  LOOP
    v_inserted := 0;
    v_claimed_at := NULL;
    INSERT INTO public.demurrage_dunning_claims (demurrage_invoice_id, attempt_discriminator)
    VALUES (v_invoice.id, v_invoice.attempt_discriminator)
    ON CONFLICT (demurrage_invoice_id, attempt_discriminator) DO UPDATE
      SET claimed_at = now(), released_at = NULL
      WHERE demurrage_dunning_claims.released_at IS NOT NULL
    RETURNING claimed_at INTO v_claimed_at;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 1 THEN
      v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
        'invoice_id', v_invoice.id, 'customer_id', v_invoice.customer_id, 'bl_id', v_invoice.bl_id,
        'doc_number', v_invoice.doc_number, 'total_usd', v_invoice.total_usd,
        'current_total_brl', v_invoice.current_total_brl, 'current_roe', v_invoice.current_roe,
        'roe_source', v_invoice.roe_source, 'first_billed_at', v_invoice.first_billed_at,
        'claimed_at', v_claimed_at, 'roe_reference_date', v_invoice.roe_reference_date,
        'attempt_discriminator', v_invoice.attempt_discriminator
      ));
    END IF;
  END LOOP;
  RETURN v_candidates;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_demurrage_dunning_candidates(timestamp with time zone, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_demurrage_dunning_candidates(timestamp with time zone, integer) TO service_role;

-- ===========================================================================
-- 4. demurrage_dunning_candidate_sendable: revalidação pré-envio
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.demurrage_dunning_candidate_sendable(p_invoice_id bigint)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_customer_id bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  IF p_invoice_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT di.customer_id INTO v_customer_id
  FROM public.demurrage_invoices AS di
  WHERE di.id = p_invoice_id
    AND COALESCE(di.status, 'issued') IN ('issued', 'overdue')
    AND di.first_billed_at IS NOT NULL
    AND di.paid_at IS NULL
    AND COALESCE(di.dispute_open, false) = false;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.customer_contacts AS cc
    JOIN public.customer_contact_box_links AS bl ON bl.contact_id = cc.id
    WHERE cc.customer_id = v_customer_id
      AND cc.deactivated_at IS NULL
      AND cc.email_normalized IS NOT NULL
      AND cc.email_normalized ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      AND bl.box_code IN ('demurrage', 'financeiro')
      AND NOT EXISTS (
        SELECT 1 FROM public.portal_suppressed_emails pse
        WHERE lower(btrim(pse.email)) = cc.email_normalized AND pse.reason = 'bounce_permanente'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_communication_suppressions ccs
        WHERE lower(btrim(ccs.email)) = cc.email_normalized
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.demurrage_dunning_candidate_sendable(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demurrage_dunning_candidate_sendable(bigint) TO service_role;

-- ===========================================================================
-- 5. release_demurrage_dunning_claim: pausa não consome a régua
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.release_demurrage_dunning_claim(
  p_demurrage_invoice_id bigint,
  p_attempt_discriminator integer
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  IF p_demurrage_invoice_id IS NULL
     OR p_attempt_discriminator IS NULL
     OR p_attempt_discriminator < 1 THEN
    RAISE EXCEPTION 'Invoice e posição da régua são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.demurrage_dunning_claims
  SET released_at = COALESCE(released_at, now())
  WHERE demurrage_invoice_id = p_demurrage_invoice_id
    AND attempt_discriminator = p_attempt_discriminator
    AND released_at IS NULL;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.release_demurrage_dunning_claim(bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_demurrage_dunning_claim(bigint, integer) TO service_role;

-- A9: customer_contact_preferences e purpose preservados para rollback; nenhuma
-- leitura de produção restante após esta migration (claim/sendable/automação de
-- Demurrage usam apenas caixas + supressões).
