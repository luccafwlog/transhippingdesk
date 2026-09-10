-- 011: membership exacta das mensagens agrupadas da régua (D11).
--
-- A régua pode receber mais de 50 faturas do mesmo cliente no mesmo ciclo.
-- B/Ls são uma dimensão de comunicação, mas não identificam uma invoice de
-- Demurrage; por isso a recuperação de claim precisa de membership por
-- demurrage_invoice_id + tentativa. O dispatch_id determinístico separa
-- grupos que têm o mesmo cliente/ciclo e torna o retry idempotente sem email na
-- chave.

CREATE TABLE IF NOT EXISTS public.customer_communication_dunning_groups (
  communication_id bigint PRIMARY KEY REFERENCES public.customer_communications(id) ON DELETE CASCADE,
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  attempt_discriminator integer NOT NULL CHECK (attempt_discriminator >= 0),
  group_key text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT customer_communication_dunning_groups_identity_uq
    UNIQUE (customer_id, attempt_discriminator, group_key)
);

CREATE TABLE IF NOT EXISTS public.customer_communication_dunning_invoices (
  communication_id bigint NOT NULL REFERENCES public.customer_communications(id) ON DELETE CASCADE,
  demurrage_invoice_id bigint NOT NULL REFERENCES public.demurrage_invoices(id) ON DELETE RESTRICT,
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  attempt_discriminator integer NOT NULL CHECK (attempt_discriminator >= 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (communication_id, demurrage_invoice_id),
  CONSTRAINT customer_communication_dunning_invoice_attempt_uq
    UNIQUE (demurrage_invoice_id, attempt_discriminator)
);

ALTER TABLE public.customer_communication_dunning_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_communication_dunning_invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customer_communication_dunning_groups FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.customer_communication_dunning_invoices FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.customer_communication_dunning_groups TO service_role;
GRANT ALL ON TABLE public.customer_communication_dunning_invoices TO service_role;

CREATE INDEX IF NOT EXISTS idx_dunning_group_invoices_invoice_attempt
  ON public.customer_communication_dunning_invoices (demurrage_invoice_id, attempt_discriminator);

CREATE OR REPLACE FUNCTION public.create_customer_dunning_group_atomic(
  p_customer_id bigint,
  p_attempt_discriminator integer,
  p_invoice_ids bigint[],
  p_anchor_voyage_id bigint DEFAULT NULL,
  p_anchor_port text DEFAULT NULL,
  p_vessel_name text DEFAULT NULL,
  p_voyage_number text DEFAULT NULL,
  p_terminal_name text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_invoice_ids bigint[];
  v_invoice_count integer;
  v_bl_ids text[];
  v_group_key text;
  v_dispatch_id uuid;
  v_communication_id bigint;
  v_existing bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_customer_id IS NULL OR p_attempt_discriminator IS NULL OR p_attempt_discriminator < 0
     OR p_invoice_ids IS NULL OR cardinality(p_invoice_ids) = 0 THEN
    RAISE EXCEPTION 'Cliente, tentativa e invoices são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  -- Serializa grupos do mesmo cliente e evita duas comunicações diferentes
  -- durante o primeiro claim do mesmo ciclo.
  PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT array_agg(invoice_id ORDER BY invoice_id), count(*)::integer
    INTO v_invoice_ids, v_invoice_count
  FROM (SELECT DISTINCT value AS invoice_id FROM unnest(p_invoice_ids) AS requested(value)) AS distinct_ids;
  IF v_invoice_count <> cardinality(p_invoice_ids) THEN
    RAISE EXCEPTION 'A composição do grupo contém invoice duplicada.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::integer, array_agg(di.bl_id ORDER BY di.id)
    INTO v_invoice_count, v_bl_ids
  FROM public.demurrage_invoices AS di
  WHERE di.id = ANY(v_invoice_ids) AND di.customer_id = p_customer_id;
  IF v_invoice_count <> cardinality(v_invoice_ids) THEN
    RAISE EXCEPTION 'Invoice fora do cliente do comunicado.' USING ERRCODE = '42501';
  END IF;

  v_group_key := md5(format('%s:%s:%s', p_customer_id, p_attempt_discriminator, array_to_string(v_invoice_ids, ',')));
  v_dispatch_id := format('%s-%s-%s-%s-%s',
    substr(v_group_key, 1, 8), substr(v_group_key, 9, 4),
    substr(v_group_key, 13, 4), substr(v_group_key, 17, 4), substr(v_group_key, 21, 12)
  )::uuid;

  SELECT communication_id INTO v_existing
  FROM public.customer_communication_dunning_groups
  WHERE customer_id = p_customer_id
    AND attempt_discriminator = p_attempt_discriminator
    AND group_key = v_group_key
  FOR UPDATE;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_communication_id := public.create_customer_communication_atomic(
    p_customer_id,
    'cobranca_demurrage',
    'demurrage',
    p_anchor_voyage_id,
    p_anchor_port,
    NULL,
    v_invoice_ids[1],
    p_attempt_discriminator,
    v_dispatch_id,
    p_vessel_name,
    p_voyage_number,
    p_terminal_name,
    NULL,
    v_bl_ids
  );

  INSERT INTO public.customer_communication_dunning_groups (
    communication_id, customer_id, attempt_discriminator, group_key
  ) VALUES (
    v_communication_id, p_customer_id, p_attempt_discriminator, v_group_key
  );

  INSERT INTO public.customer_communication_dunning_invoices (
    communication_id, demurrage_invoice_id, customer_id, attempt_discriminator
  )
  SELECT v_communication_id, invoice_id, p_customer_id, p_attempt_discriminator
  FROM unnest(v_invoice_ids) AS requested(invoice_id);

  UPDATE public.customer_communications
  SET origin = 'automatico'
  WHERE id = v_communication_id;

  RETURN v_communication_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_customer_dunning_group_atomic(
  bigint, integer, bigint[], bigint, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_dunning_group_atomic(
  bigint, integer, bigint[], bigint, text, text, text, text
) TO service_role;

-- Recovery de claims deve preferir a membership exata. A compatibilidade com
-- comunicados antigos por B/L só vale quando a mensagem ainda não tem grupo
-- persistido; ela não pode fazer uma invoice de outro grupo parecer entregue.
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

  UPDATE public.demurrage_dunning_claims AS claim
  SET released_at = COALESCE(p_as_of, now())
  WHERE claim.released_at IS NULL
    AND claim.claimed_at < COALESCE(p_as_of, now()) - interval '30 minutes'
    AND NOT EXISTS (
      SELECT 1
      FROM public.customer_communications AS comm
      WHERE comm.kind = 'cobranca_demurrage'
        AND comm.status IN ('enviado', 'simulado')
        AND (
          EXISTS (
            SELECT 1
            FROM public.customer_communication_dunning_invoices AS membership
            WHERE membership.communication_id = comm.id
              AND membership.demurrage_invoice_id = claim.demurrage_invoice_id
              AND membership.attempt_discriminator = claim.attempt_discriminator
          )
          OR (
            NOT EXISTS (
              SELECT 1 FROM public.customer_communication_dunning_groups AS grouped
              WHERE grouped.communication_id = comm.id
            )
            AND comm.attempt_discriminator = claim.attempt_discriminator
            AND (
              comm.anchor_invoice_id = claim.demurrage_invoice_id
              OR EXISTS (
                SELECT 1
                FROM public.customer_communication_bls AS bl
                JOIN public.demurrage_invoices AS di ON di.bl_id = bl.bl_id
                WHERE bl.communication_id = comm.id AND di.id = claim.demurrage_invoice_id
              )
            )
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
          AND NOT EXISTS (SELECT 1 FROM public.portal_suppressed_emails pse WHERE lower(btrim(pse.email)) = cc.email_normalized AND pse.reason = 'bounce_permanente')
          AND NOT EXISTS (SELECT 1 FROM public.customer_communication_suppressions ccs WHERE lower(btrim(ccs.email)) = cc.email_normalized)
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
