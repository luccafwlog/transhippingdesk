-- 383: correções de revisão dos comunicados financeiros e automação.
--
-- 1. Otimiza o payload de taxas locais (customer_local_charges_communication_payload)
--    restringindo a agregação de invoice_bls e invoice_receivable_links aos B/Ls
--    da viagem e cliente em vez de escanear toda a base.
-- 2. Filtra supressões permanentes e contatos desativados em
--    evaluate_and_dispatch_automatic_communications, evitando loops de claim
--    infinito para destinatários com bounce permanente.
-- 3. Considera disparos com status 'simulado' como fechamento do alvo lógico
--    da automação, impedindo re-execuções a cada 15 minutos em modo simulação.

CREATE OR REPLACE FUNCTION public.customer_local_charges_communication_payload(
  p_voyage_id BIGINT,
  p_customer_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  RETURN (
    WITH base_bls AS (
      SELECT b.id AS bl_id, b.ce_mercante, b.pod, c.name AS customer_name,
             v.eta, v.voyage_number, vs.name AS vessel_name
      FROM public.bls b
      JOIN public.customers c ON c.id = b.customer_id
      JOIN public.voyages v ON v.id = b.voyage_id
      LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
      WHERE b.voyage_id = p_voyage_id
        AND b.customer_id = p_customer_id
        AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
    ), direct_totals AS (
      SELECT ib.bl_id, sum(COALESCE(ib.subtotal_brl, 0)) AS total_brl
      FROM public.invoice_bls ib
      JOIN base_bls b ON b.bl_id = ib.bl_id
      JOIN public.invoices i ON i.id = ib.invoice_id
      WHERE i.status IN ('issued', 'partially_paid', 'paid', 'covered')
      GROUP BY ib.bl_id
    ), ledger_totals AS (
      SELECT rl.bl_id, sum(COALESCE(rl.subtotal_brl, 0)) AS total_brl
      FROM public.invoice_receivable_links rl
      JOIN base_bls b ON b.bl_id = rl.bl_id
      JOIN public.invoices i ON i.id = rl.invoice_id
      WHERE COALESCE(rl.status, '') <> 'obsolete'
        AND i.status IN ('issued', 'partially_paid', 'paid', 'covered')
        AND NOT EXISTS (SELECT 1 FROM direct_totals d WHERE d.bl_id = rl.bl_id)
      GROUP BY rl.bl_id
    )
    SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_build_object(
      'customer_id', p_customer_id,
      'customer_name', max(customer_name),
      'vessel_name', max(vessel_name),
      'voyage_number', max(voyage_number),
      'port', (array_agg(COALESCE(pod, '—') ORDER BY bl_id))[1],
      'milestone_at', max(COALESCE(eta::TEXT, '')),
      'bls', jsonb_agg(jsonb_build_object(
        'bl_id', base_bls.bl_id,
        'ce_mercante', NULLIF(btrim(base_bls.ce_mercante), ''),
        'total_brl', COALESCE(direct_totals.total_brl, ledger_totals.total_brl, 0)
      ) ORDER BY base_bls.bl_id)
    ) END
    FROM base_bls
    LEFT JOIN direct_totals ON direct_totals.bl_id = base_bls.bl_id
    LEFT JOIN ledger_totals ON ledger_totals.bl_id = base_bls.bl_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.customer_local_charges_communication_payload(BIGINT, BIGINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_local_charges_communication_payload(BIGINT, BIGINT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.evaluate_and_dispatch_automatic_communications(
  p_as_of TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_schedule RECORD;
  v_customer_bl RECORD;
  v_candidates JSONB := '[]'::JSONB;
  v_as_of TIMESTAMPTZ := COALESCE(p_as_of, now());
  v_kind TEXT;
  v_milestone TIMESTAMPTZ;
  v_key TEXT;
  v_voyage_id BIGINT;
  v_vessel_name TEXT;
  v_voyage_number TEXT;
  v_port TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  FOR v_schedule IN
    WITH entities AS (
      SELECT DISTINCT entity_id
      FROM public.audit_logs
      WHERE entity_type = 'voyage_pod_schedule'
        AND entity_id ~ '^[0-9]+::[^:]+$'
    ), latest AS (
      SELECT e.entity_id,
        public.customer_communication_safe_timestamptz((SELECT a.new_value FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'eta' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1)) AS eta,
        public.customer_communication_safe_timestamptz((SELECT a.new_value FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'ata' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1)) AS ata,
        COALESCE((SELECT lower(a.new_value) = 'true' FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'deleted' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), false) AS deleted,
        COALESCE((SELECT lower(a.new_value) = 'true' FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'omitted' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), false) AS omitted
      FROM entities e
    )
    SELECT v.id AS voyage_id, v.voyage_number, vs.name AS vessel_name,
      split_part(l.entity_id, '::', 2) AS port, l.eta, l.ata
    FROM latest l
    JOIN public.voyages v ON v.id = split_part(l.entity_id, '::', 1)::bigint
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE NOT l.deleted AND NOT l.omitted
      -- NOA só é válida antes do ETA; NOR usa exclusivamente a janela do ATA.
      AND ((l.ata IS NULL AND v_as_of < l.eta AND l.eta BETWEEN v_as_of - interval '30 days' AND v_as_of + interval '5 days')
        OR (l.ata IS NOT NULL AND l.ata BETWEEN v_as_of - interval '30 days' AND v_as_of))
  LOOP
    v_voyage_id := v_schedule.voyage_id;
    v_vessel_name := v_schedule.vessel_name;
    v_voyage_number := v_schedule.voyage_number;
    v_port := v_schedule.port;
    v_kind := CASE WHEN v_schedule.ata IS NOT NULL THEN 'aviso_prontidao_nor' ELSE 'aviso_chegada_noa' END;
    v_milestone := CASE WHEN v_kind = 'aviso_prontidao_nor' THEN v_schedule.ata ELSE v_schedule.eta END;

    FOR v_customer_bl IN
      SELECT b.customer_id, array_agg(b.id ORDER BY b.id) AS bl_ids,
        c.name AS customer_name, c.cnpj_cpf,
        array_agg(DISTINCT NULLIF(btrim(cc.email), '') ORDER BY NULLIF(btrim(cc.email), '')) FILTER (WHERE cc.email IS NOT NULL) AS emails
      FROM public.bls b
      JOIN public.customers c ON c.id = b.customer_id
      LEFT JOIN public.customer_contacts cc ON cc.customer_id = b.customer_id
      WHERE b.voyage_id = v_voyage_id
        AND upper(btrim(b.pod)) = upper(btrim(v_port))
        AND b.customer_id IS NOT NULL
        AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
        AND COALESCE(cc.email, '') <> ''
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_contact_preferences cp
          WHERE cp.contact_id = cc.id AND cp.nature = 'avisos_operacionais' AND cp.enabled = false
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.portal_suppressed_emails pse
          WHERE lower(btrim(pse.email)) = lower(btrim(cc.email))
            AND pse.reason = 'bounce_permanente'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.customer_communication_suppressions ccs
          WHERE lower(btrim(ccs.email)) = lower(btrim(cc.email))
        )
        -- Um envio manual ou simulado já fecha o mesmo alvo lógico.
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communications sent
          WHERE sent.customer_id = b.customer_id
            AND sent.kind = v_kind
            AND sent.nature = 'avisos_operacionais'
            AND sent.status IN ('enviado', 'simulado')
            AND sent.anchor_voyage_id = v_voyage_id
            AND upper(btrim(sent.anchor_port)) = upper(btrim(v_port))
        )
      GROUP BY b.customer_id, c.name, c.cnpj_cpf
      HAVING count(DISTINCT NULLIF(btrim(cc.email), '')) FILTER (WHERE cc.email IS NOT NULL) > 0
    LOOP
      v_key := v_kind || ':' || v_customer_bl.customer_id || ':' || v_voyage_id || ':' || upper(v_port);
      INSERT INTO public.customer_communication_automation_claims (claim_key)
      VALUES (v_key)
      ON CONFLICT (claim_key) DO UPDATE
        SET claimed_at = now(), released_at = NULL
        WHERE customer_communication_automation_claims.released_at IS NOT NULL
           OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes';
      IF FOUND THEN
        v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
          'claim_key', v_key, 'kind', v_kind, 'customer_id', v_customer_bl.customer_id,
          'customer_name', v_customer_bl.customer_name, 'customer_cnpj', v_customer_bl.cnpj_cpf,
          'voyage_id', v_voyage_id, 'vessel_name', v_vessel_name, 'voyage_number', v_voyage_number,
          'port', upper(v_port), 'milestone_at', v_milestone,
          'bl_ids', to_jsonb(v_customer_bl.bl_ids), 'emails', to_jsonb(v_customer_bl.emails)
        ));
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_candidates;
END;
$function$;

REVOKE ALL ON FUNCTION public.evaluate_and_dispatch_automatic_communications(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_and_dispatch_automatic_communications(TIMESTAMPTZ) TO service_role;
