-- 381: automação server-side e leitura de cobertura do canal de Comunicados.
-- O runner é o único consumidor da lista de candidatos; a claim evita que
-- execuções concorrentes criem o mesmo comunicado.

ALTER TABLE public.customer_communications
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE public.customer_communications
  DROP CONSTRAINT IF EXISTS customer_communications_origin_check;
ALTER TABLE public.customer_communications
  ADD CONSTRAINT customer_communications_origin_check CHECK (origin IN ('manual', 'automatico'));
CREATE INDEX IF NOT EXISTS idx_customer_communications_origin ON public.customer_communications (origin, created_at DESC);

CREATE TABLE IF NOT EXISTS public.customer_communication_automation_claims (
  claim_key TEXT PRIMARY KEY,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.customer_communication_automation_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_communication_automation_claims FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.customer_communication_automation_claims TO service_role;

CREATE OR REPLACE FUNCTION public.evaluate_and_dispatch_automatic_communications(
  p_as_of TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row RECORD;
  v_candidates JSONB := '[]'::JSONB;
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

  -- Escalas são auditadas como voyage_id::PORT. Ler o último valor mantém a
  -- automação compatível com o modelo histórico e com a escala terminalizada.
  FOR v_row IN
    WITH entities AS (
      SELECT DISTINCT entity_id
      FROM public.audit_logs
      WHERE entity_type = 'voyage_pod_schedule'
        AND entity_id ~ '^[0-9]+::[^:]+$'
    ), latest AS (
      SELECT e.entity_id,
        (SELECT a.new_value FROM public.audit_logs a WHERE a.entity_type='voyage_pod_schedule' AND a.entity_id=e.entity_id AND a.field_name='eta' ORDER BY a.changed_at DESC,a.id DESC LIMIT 1) AS eta,
        (SELECT a.new_value FROM public.audit_logs a WHERE a.entity_type='voyage_pod_schedule' AND a.entity_id=e.entity_id AND a.field_name='ata' ORDER BY a.changed_at DESC,a.id DESC LIMIT 1) AS ata,
        COALESCE((SELECT lower(a.new_value)='true' FROM public.audit_logs a WHERE a.entity_type='voyage_pod_schedule' AND a.entity_id=e.entity_id AND a.field_name='deleted' ORDER BY a.changed_at DESC,a.id DESC LIMIT 1),false) AS deleted,
        COALESCE((SELECT lower(a.new_value)='true' FROM public.audit_logs a WHERE a.entity_type='voyage_pod_schedule' AND a.entity_id=e.entity_id AND a.field_name='omitted' ORDER BY a.changed_at DESC,a.id DESC LIMIT 1),false) AS omitted
      FROM entities e
    )
    SELECT v.id AS voyage_id, v.voyage_number, vs.name AS vessel_name,
      split_part(l.entity_id,'::',2) AS port,
      NULLIF(l.eta,'')::timestamptz AS eta, NULLIF(l.ata,'')::timestamptz AS ata
    FROM latest l
    JOIN public.voyages v ON v.id = split_part(l.entity_id,'::',1)::bigint
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE NOT l.deleted AND NOT l.omitted
      AND ((NULLIF(l.eta,'')::timestamptz BETWEEN p_as_of - interval '30 days' AND p_as_of + interval '5 days')
        OR (NULLIF(l.ata,'')::timestamptz BETWEEN p_as_of - interval '30 days' AND p_as_of))
  LOOP
    v_voyage_id := v_row.voyage_id;
    v_vessel_name := v_row.vessel_name;
    v_voyage_number := v_row.voyage_number;
    v_port := v_row.port;
    v_kind := CASE WHEN v_row.ata IS NOT NULL THEN 'aviso_prontidao_nor' ELSE 'aviso_chegada_noa' END;
    v_milestone := CASE WHEN v_kind = 'aviso_prontidao_nor' THEN v_row.ata ELSE v_row.eta END;
    IF v_kind = 'aviso_chegada_noa' AND p_as_of < v_row.eta - interval '5 days' THEN CONTINUE; END IF;
    FOR v_row IN
      SELECT b.customer_id, array_agg(b.id ORDER BY b.id) AS bl_ids,
        c.name AS customer_name, c.cnpj_cpf,
        array_agg(DISTINCT NULLIF(btrim(cc.email),'') ORDER BY NULLIF(btrim(cc.email),'')) FILTER (WHERE cc.email IS NOT NULL) AS emails
      FROM public.bls b JOIN public.customers c ON c.id=b.customer_id
      LEFT JOIN public.customer_contacts cc ON cc.customer_id=b.customer_id
      WHERE b.voyage_id=v_voyage_id AND upper(btrim(b.pod))=upper(btrim(v_port))
        AND b.customer_id IS NOT NULL AND COALESCE(b.financial_status,'pending') <> 'cancelled'
        AND COALESCE(cc.email,'') <> ''
        AND NOT EXISTS (SELECT 1 FROM public.customer_contact_preferences cp WHERE cp.contact_id=cc.id AND cp.nature='avisos_operacionais' AND cp.enabled=false)
      GROUP BY b.customer_id,c.name,c.cnpj_cpf
    LOOP
      v_key := v_kind||':'||v_row.customer_id||':'||v_voyage_id||':'||upper(v_port);
      INSERT INTO public.customer_communication_automation_claims(claim_key) VALUES(v_key)
        ON CONFLICT DO NOTHING;
      IF FOUND THEN
        v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
          'kind',v_kind,'customer_id',v_row.customer_id,'customer_name',v_row.customer_name,
          'customer_cnpj',v_row.cnpj_cpf,'voyage_id',v_voyage_id,'vessel_name',v_vessel_name,
          'voyage_number',v_voyage_number,'port',upper(v_port),'milestone_at',v_milestone,
          'bl_ids',to_jsonb(v_row.bl_ids),'emails',to_jsonb(v_row.emails)
        ));
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_candidates;
END;
$function$;

REVOKE ALL ON FUNCTION public.evaluate_and_dispatch_automatic_communications(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_and_dispatch_automatic_communications(TIMESTAMPTZ) TO service_role;
GRANT SELECT ON public.customer_communications TO authenticated;

DO $$
DECLARE
  v_url TEXT := current_setting('app.settings.supabase_url', true);
  v_secret TEXT := current_setting('app.settings.customer_communication_automation_secret', true);
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'net') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'customer-communication-auto-runner') THEN
      PERFORM cron.unschedule('customer-communication-auto-runner');
    END IF;
    PERFORM cron.schedule(
      'customer-communication-auto-runner', '*/15 * * * *',
      $job$SELECT net.http_post(url := COALESCE(NULLIF(current_setting('app.settings.supabase_url', true), ''), 'https://invalid-communication-config.invalid') || '/functions/v1/customer-communication-auto-runner', headers := jsonb_build_object('X-Communication-Automation-Secret', COALESCE(NULLIF(current_setting('app.settings.customer_communication_automation_secret', true), ''), 'missing-secret'), 'Content-Type', 'application/json'), body := '{}'::jsonb);$job$
    );
  END IF;
END;
$$;
