-- S10: a prontidão de CE Mercante é revalidada na criação, no claim e
-- imediatamente antes do dispatch. A conta do Portal continua sendo gate de
-- emissão; o comunicado exige CE, revisão liberada e financeiro concluído para
-- todos os B/Ls ativos do cliente na viagem.

CREATE OR REPLACE FUNCTION public.customer_local_charges_communication_dispatch_ready(
  p_voyage_id bigint,
  p_customer_id bigint,
  p_raise boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_readiness jsonb;
  v_ready boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  IF p_voyage_id IS NULL OR p_customer_id IS NULL THEN
    IF p_raise THEN
      RAISE EXCEPTION 'Viagem e cliente são obrigatórios para o comunicado financeiro.'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('ready', false, 'reason_code', 'invalid_scope');
  END IF;

  -- Serializa dispatches da mesma unidade e conserva os B/Ls estáveis até a
  -- leitura do veredito. A janela com o provedor continua explicitamente
  -- auditável: não há transação SQL atravessando uma chamada HTTP externa.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(format('customer-local-charges:%s:%s', p_voyage_id, p_customer_id), 0)
  );
  PERFORM 1
  FROM public.bls AS b
  WHERE b.voyage_id = p_voyage_id
    AND b.customer_id = p_customer_id
    AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
  ORDER BY b.id
  FOR UPDATE;

  v_readiness := public.customer_local_charges_communication_readiness(p_voyage_id, p_customer_id);
  v_ready := COALESCE((v_readiness ->> 'ready')::boolean, false);
  IF NOT v_ready AND p_raise THEN
    RAISE EXCEPTION 'Prontidão financeira bloqueada para este cliente e viagem (%).',
      COALESCE(v_readiness ->> 'reason_code', 'readiness_blocked')
      USING ERRCODE = 'P0003', DETAIL = v_readiness::text;
  END IF;
  RETURN v_readiness;
END;
$$;

REVOKE ALL ON FUNCTION public.customer_local_charges_communication_dispatch_ready(bigint, bigint, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_local_charges_communication_dispatch_ready(bigint, bigint, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_customer_communication_readiness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  IF NEW.kind = 'ce_mercante_taxas' THEN
    PERFORM public.customer_local_charges_communication_dispatch_ready(
      NEW.anchor_voyage_id,
      NEW.customer_id,
      true
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_customer_communication_readiness() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_customer_communication_readiness() TO service_role;

DROP TRIGGER IF EXISTS customer_communications_ce_mercante_readiness
  ON public.customer_communications;
CREATE TRIGGER customer_communications_ce_mercante_readiness
  BEFORE INSERT OR UPDATE OF customer_id, kind, anchor_voyage_id
  ON public.customer_communications
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_customer_communication_readiness();

CREATE OR REPLACE FUNCTION public.enforce_customer_communication_automation_claim_readiness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_customer_text text;
  v_voyage_text text;
  v_readiness jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  IF NEW.claim_key LIKE 'ce_mercante_taxas:%' THEN
    -- A liberação de claim não pode ficar presa por uma mudança de readiness;
    -- somente a aquisição (insert ou released_at -> NULL) é revalidada.
    IF TG_OP = 'UPDATE' AND NEW.released_at IS NOT NULL THEN
      RETURN NEW;
    END IF;

    v_customer_text := split_part(NEW.claim_key, ':', 2);
    v_voyage_text := split_part(NEW.claim_key, ':', 3);
    IF v_customer_text !~ '^[0-9]+$' OR v_voyage_text !~ '^[0-9]+$' THEN
      RETURN NULL;
    END IF;

    v_readiness := public.customer_local_charges_communication_dispatch_ready(
      v_voyage_text::bigint,
      v_customer_text::bigint,
      false
    );
    IF COALESCE((v_readiness ->> 'ready')::boolean, false) IS NOT TRUE THEN
      RETURN NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_customer_communication_automation_claim_readiness()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_customer_communication_automation_claim_readiness() TO service_role;

DROP TRIGGER IF EXISTS customer_communication_automation_claims_ce_mercante_readiness
  ON public.customer_communication_automation_claims;
CREATE TRIGGER customer_communication_automation_claims_ce_mercante_readiness
  BEFORE INSERT OR UPDATE OF claim_key, claimed_at, released_at
  ON public.customer_communication_automation_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_customer_communication_automation_claim_readiness();
