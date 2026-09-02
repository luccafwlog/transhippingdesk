-- 379: recuperação de claims e leitura da régua de cobrança de Demurrage.
--
-- A migration 378 já foi aplicada. Esta migration corrige o contrato sem
-- reescrever o histórico: claims sem envio concluído são liberadas, o RPC
-- passa a trabalhar em lotes e a Edge Function pode devolver uma claim quando
-- a cobrança não foi efetivamente registrada como enviada.

ALTER TABLE public.demurrage_dunning_claims
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;

DROP INDEX IF EXISTS public.idx_demurrage_dunning_claims_invoice;
CREATE INDEX idx_demurrage_dunning_claims_invoice
  ON public.demurrage_dunning_claims (
    demurrage_invoice_id,
    released_at,
    claimed_at DESC
  );

-- Não deixar uma execução anterior, que reservou mas não enviou, bloquear a
-- régua para sempre. Claims com envio concluído continuam representando uma
-- posição já consumida.
UPDATE public.demurrage_dunning_claims AS claim
SET released_at = now()
WHERE claim.released_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.customer_communications AS communication
    WHERE communication.kind = 'cobranca_demurrage'
      AND communication.anchor_invoice_id = claim.demurrage_invoice_id
      AND communication.attempt_discriminator = claim.attempt_discriminator
      AND communication.status = 'enviado'
  );

-- A assinatura mudou para incluir o limite do lote; remover a função antiga
-- evita manter um caminho server-only sem limite disponível no catálogo.
DROP FUNCTION IF EXISTS public.claim_demurrage_dunning_candidates(TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.claim_demurrage_dunning_candidates(
  p_as_of TIMESTAMPTZ DEFAULT now(),
  p_limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
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

  SELECT GREATEST(COALESCE(demurrage_dunning_interval_days, 7), 1)
    INTO v_interval_days
  FROM public.app_settings
  WHERE id = 1;
  v_interval_days := COALESCE(v_interval_days, 7);

  -- `first_billed_at` é a origem imutável da régua. `billed_at` muda quando
  -- PTAX/refaturamento atualiza a fatura e não pode reiniciar a cobrança.
  FOR v_invoice IN
    SELECT
      di.id,
      di.customer_id,
      di.bl_id,
      di.doc_number,
      di.total_usd,
      di.current_total_brl,
      di.current_roe,
      di.roe_source,
      di.first_billed_at,
      COALESCE(claims.claimed_at, now()) AS claimed_at,
      COALESCE(di.updated_at::DATE, di.doc_date, CURRENT_DATE)::TEXT AS roe_reference_date,
      COALESCE(claims.attempt_count, 0)::INTEGER + 1 AS attempt_discriminator
    FROM public.demurrage_invoices AS di
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE prior_claim.released_at IS NULL)::INTEGER AS attempt_count,
        max(prior_claim.claimed_at) FILTER (WHERE prior_claim.released_at IS NULL) AS claimed_at
      FROM public.demurrage_dunning_claims AS prior_claim
      WHERE prior_claim.demurrage_invoice_id = di.id
    ) AS claims ON true
    WHERE COALESCE(di.status, 'issued') IN ('issued', 'overdue')
      AND di.first_billed_at IS NOT NULL
      AND di.paid_at IS NULL
      AND COALESCE(di.dispute_open, false) = false
      AND NOT EXISTS (
        SELECT 1
        FROM public.alert_items AS ai
        JOIN public.alerts AS a ON a.id = ai.alert_id
        WHERE a.type = 'aggregate'
          AND a.entity_type = 'customer'
          AND a.entity_id = di.customer_id::TEXT
          AND a.status <> 'closed'
          AND ai.item_type = 'cliente_contato_bounced_sem_alternativa'
          AND ai.status = 'active'
      )
      AND EXISTS (
        SELECT 1
        FROM public.customer_contacts AS cc
        WHERE cc.customer_id = di.customer_id
          AND NULLIF(btrim(cc.email), '') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM public.portal_suppressed_emails AS pse
            WHERE lower(btrim(pse.email)) = lower(btrim(cc.email))
              AND pse.reason = 'bounce_permanente'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.customer_communication_suppressions AS ccs
            WHERE lower(btrim(ccs.email)) = lower(btrim(cc.email))
          )
          AND COALESCE((
            SELECT ccp.enabled
            FROM public.customer_contact_preferences AS ccp
            WHERE ccp.contact_id = cc.id
              AND ccp.nature = 'demurrage'
          ), true)
      )
      AND COALESCE(p_as_of, now()) >= (
        di.first_billed_at::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo'
        + make_interval(days => v_interval_days * COALESCE(claims.attempt_count, 0))
      )
    ORDER BY di.id
    LIMIT v_limit
    FOR UPDATE OF di SKIP LOCKED
  LOOP
    v_inserted := 0;
    v_claimed_at := NULL;
    INSERT INTO public.demurrage_dunning_claims (
      demurrage_invoice_id,
      attempt_discriminator
    )
    VALUES (v_invoice.id, v_invoice.attempt_discriminator)
    ON CONFLICT (demurrage_invoice_id, attempt_discriminator) DO UPDATE
      SET claimed_at = now(), released_at = NULL
      WHERE demurrage_dunning_claims.released_at IS NOT NULL
    RETURNING claimed_at INTO v_claimed_at;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 1 THEN
      v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
        'invoice_id', v_invoice.id,
        'customer_id', v_invoice.customer_id,
        'bl_id', v_invoice.bl_id,
        'doc_number', v_invoice.doc_number,
        'total_usd', v_invoice.total_usd,
        'current_total_brl', v_invoice.current_total_brl,
        'current_roe', v_invoice.current_roe,
        'roe_source', v_invoice.roe_source,
        'first_billed_at', v_invoice.first_billed_at,
        'claimed_at', v_claimed_at,
        'roe_reference_date', v_invoice.roe_reference_date,
        'attempt_discriminator', v_invoice.attempt_discriminator
      ));
    END IF;
  END LOOP;

  RETURN v_candidates;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_demurrage_dunning_candidates(TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_demurrage_dunning_candidates(TIMESTAMPTZ, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.release_demurrage_dunning_claim(
  p_demurrage_invoice_id BIGINT,
  p_attempt_discriminator INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.release_demurrage_dunning_claim(BIGINT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_demurrage_dunning_claim(BIGINT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.list_demurrage_dunning_claim_statuses(
  p_invoice_ids BIGINT[]
)
RETURNS TABLE (
  invoice_id BIGINT,
  attempt_count INTEGER,
  last_attempt_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_active_read_user()) THEN
    RAISE EXCEPTION 'Usuário interno ativo é obrigatório.' USING ERRCODE = '42501';
  END IF;

  IF p_invoice_ids IS NULL OR cardinality(p_invoice_ids) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    claim.demurrage_invoice_id,
    count(*)::INTEGER,
    max(claim.claimed_at)
  FROM public.demurrage_dunning_claims AS claim
  WHERE claim.demurrage_invoice_id = ANY(p_invoice_ids)
    AND claim.released_at IS NULL
  GROUP BY claim.demurrage_invoice_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_demurrage_dunning_claim_statuses(BIGINT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_demurrage_dunning_claim_statuses(BIGINT[]) TO authenticated, service_role;
