-- 378: régua de cobrança de Demurrage no canal de Comunicados.
--
-- A claim é separada do comunicado para que duas execuções concorrentes do
-- cron não reservem a mesma cobrança. O discriminador representa a posição
-- na régua, não a quantidade de tentativas do provider.

CREATE TABLE IF NOT EXISTS public.demurrage_dunning_claims (
  demurrage_invoice_id BIGINT NOT NULL
    REFERENCES public.demurrage_invoices(id) ON DELETE CASCADE,
  attempt_discriminator INTEGER NOT NULL CHECK (attempt_discriminator > 0),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (demurrage_invoice_id, attempt_discriminator)
);

CREATE INDEX IF NOT EXISTS idx_demurrage_dunning_claims_invoice
  ON public.demurrage_dunning_claims (demurrage_invoice_id, claimed_at DESC);

ALTER TABLE public.demurrage_dunning_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.demurrage_dunning_claims FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.demurrage_dunning_claims TO service_role;

CREATE OR REPLACE FUNCTION public.claim_demurrage_dunning_candidates(
  p_as_of TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_invoice RECORD;
  v_interval_days INTEGER;
  v_claim_count INTEGER;
  v_inserted INTEGER;
  v_candidates JSONB := '[]'::JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

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
      COALESCE(di.updated_at::DATE, di.doc_date, CURRENT_DATE)::TEXT AS roe_reference_date,
      COALESCE(claims.attempt_count, 0)::INTEGER + 1 AS attempt_discriminator
    FROM public.demurrage_invoices AS di
    LEFT JOIN LATERAL (
      SELECT count(*)::INTEGER AS attempt_count
      FROM public.demurrage_dunning_claims AS prior_claim
      WHERE prior_claim.demurrage_invoice_id = di.id
    ) AS claims ON true
    WHERE COALESCE(di.status, 'issued') IN ('issued', 'overdue')
      AND di.first_billed_at IS NOT NULL
      AND di.paid_at IS NULL
      AND COALESCE(di.dispute_open, false) = false
      -- A disputa aberta pausa a régua por sua origem de estado; manter a
      -- condição explícita aqui protege o cron de alterações posteriores.
      AND NOT EXISTS (
        SELECT 1
        FROM public.alert_items AS ai
        JOIN public.alerts AS a ON a.id = ai.alert_id
        WHERE a.type = 'cliente_contato_bounced_sem_alternativa'
          AND a.entity_type = 'customer'
          AND a.entity_id = di.customer_id::TEXT
          AND a.status <> 'closed'
          AND ai.status = 'active'
      )
      -- Sem contato válido a claim não avança. Complaint é específico do
      -- canal de Comunicados; bounce permanente é a supressão compartilhada.
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
    FOR UPDATE OF di SKIP LOCKED
  LOOP
    v_inserted := 0;
    INSERT INTO public.demurrage_dunning_claims (
      demurrage_invoice_id, attempt_discriminator
    )
    VALUES (v_invoice.id, v_invoice.attempt_discriminator)
    ON CONFLICT (demurrage_invoice_id, attempt_discriminator) DO NOTHING;

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
        'roe_reference_date', v_invoice.roe_reference_date,
        'attempt_discriminator', v_invoice.attempt_discriminator
      ));
    END IF;
  END LOOP;

  RETURN v_candidates;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_demurrage_dunning_candidates(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_demurrage_dunning_candidates(TIMESTAMPTZ) TO service_role;

-- O job segue o padrão dos detectores: o cron só chama uma Edge Function
-- protegida por segredo e o trabalho de dados roda sob service_role.
DO $$
DECLARE
  v_url TEXT := current_setting('app.settings.supabase_url', true);
  v_secret TEXT := current_setting('app.settings.demurrage_dunning_secret', true);
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'net') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'demurrage-dunning') THEN
      PERFORM cron.unschedule('demurrage-dunning');
    END IF;
    IF NULLIF(v_url, '') IS NULL OR NULLIF(v_secret, '') IS NULL THEN
      RAISE WARNING 'demurrage-dunning será agendado sem URL/segredo completos; a execução falhará visivelmente até app.settings.* ser configurado.';
    END IF;
    PERFORM cron.schedule(
      'demurrage-dunning',
      '0 * * * *',
      $job$SELECT net.http_post(url := COALESCE(NULLIF(current_setting('app.settings.supabase_url', true), ''), 'https://invalid-demurrage-dunning-config.invalid') || '/functions/v1/demurrage-dunning', headers := jsonb_build_object('Authorization', 'Bearer ' || COALESCE(NULLIF(current_setting('app.settings.demurrage_dunning_secret', true), ''), 'missing-demurrage-dunning-secret'), 'Content-Type', 'application/json'), body := '{}'::jsonb);$job$
    );
  END IF;
END;
$$;
