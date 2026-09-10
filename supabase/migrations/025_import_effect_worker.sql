-- S05 — consumidores server-only da fila de efeitos pós-commit.
--
-- Claim/lease/append-only continuam em 017. Esta migration adiciona a ponte
-- transacional entre um efeito tomado pelo worker e os núcleos SQL já
-- existentes. O iniciador validado permanece em created_by; worker_id fica
-- no histórico de tentativas. Nenhum JWT de usuário é usado como credencial:
-- o service_role é o executor e o sub do iniciador só é carregado para que os
-- núcleos que exigem actor possam revalidar o usuário que originou o efeito.

CREATE OR REPLACE FUNCTION public._run_import_effect_local_charges(
  p_entity_id text,
  p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bl_id text;
  v_voyage_id bigint;
  v_container_numbers text[];
  v_bl_ids text[];
  v_result jsonb := '[]'::jsonb;
  v_calculated integer := 0;
  v_row record;
  v_one jsonb;
BEGIN
  SELECT b.id, b.voyage_id
    INTO v_bl_id, v_voyage_id
  FROM public.bls AS b
  WHERE b.id = NULLIF(btrim(p_entity_id), '');

  IF v_bl_id IS NOT NULL THEN
    SELECT COALESCE(array_agg(DISTINCT upper(btrim(c.container_number))), ARRAY[]::text[])
      INTO v_container_numbers
    FROM public.bl_containers AS c
    WHERE c.bl_id = v_bl_id
      AND NULLIF(btrim(c.container_number), '') IS NOT NULL;

    IF cardinality(v_container_numbers) = 0 THEN
      v_container_numbers := NULL;
    END IF;
  ELSE
    IF NULLIF(btrim(p_entity_id), '') IS NULL OR p_entity_id !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Entidade de efeito local desconhecida: %.', p_entity_id
        USING ERRCODE = 'P0002';
    END IF;

    SELECT v.id INTO v_voyage_id
    FROM public.voyages AS v
    WHERE v.id = p_entity_id::bigint;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Viagem de efeito local não encontrada: %.', p_entity_id
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT b.id ORDER BY b.id), ARRAY[]::text[])
    INTO v_bl_ids
  FROM public.bls AS b
  WHERE b.voyage_id = v_voyage_id
    AND COALESCE(b.cargo_mode, 'container') = 'container'
    AND COALESCE(b.financial_status, '') NOT IN ('invoiced', 'partially_paid', 'paid')
    AND COALESCE(b.charge_status, '') <> 'ready_for_billing'
    AND (
      v_container_numbers IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.bl_containers AS c
        WHERE c.bl_id = b.id
          AND upper(btrim(c.container_number)) = ANY(v_container_numbers)
      )
    );

  -- Um efeito criado por um B/L sem containers ainda precisa produzir um
  -- resultado de domínio (review/no_containers), em vez de desaparecer.
  IF v_bl_id IS NOT NULL AND cardinality(v_bl_ids) = 0 THEN
    v_bl_ids := ARRAY[v_bl_id];
  END IF;

  IF cardinality(v_bl_ids) = 0 THEN
    RETURN jsonb_build_object('entity_id', p_entity_id, 'calculated', 0, 'results', v_result);
  END IF;

  FOREACH v_bl_id IN ARRAY v_bl_ids LOOP
    v_one := public.calculate_bl_local_charges(v_bl_id, p_actor, true);
    v_result := v_result || jsonb_build_array(v_one);
    v_calculated := v_calculated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'entity_id', p_entity_id,
    'calculated', v_calculated,
    'results', v_result
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._run_import_effect_demurrage(
  p_effect_id bigint,
  p_bl_id text,
  p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_customer_id bigint;
  v_container_ids bigint[];
  v_existing_invoice_id bigint;
  v_result jsonb;
BEGIN
  SELECT b.customer_id INTO v_customer_id
  FROM public.bls AS b
  WHERE b.id = p_bl_id;
  IF NOT FOUND OR v_customer_id IS NULL THEN
    RAISE EXCEPTION 'B/L % sem cliente para emissão de Demurrage.', p_bl_id
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(c.id ORDER BY c.id), ARRAY[]::bigint[])
    INTO v_container_ids
  FROM public.bl_containers AS c
  WHERE c.bl_id = p_bl_id
    AND c.discharge_date IS NOT NULL
    AND c.return_date IS NOT NULL
    AND c.demurrage_status IN ('overdue', 'returned');
  IF cardinality(v_container_ids) = 0 THEN
    RAISE EXCEPTION 'B/L % sem container retornado para emissão de Demurrage.', p_bl_id
      USING ERRCODE = '22023';
  END IF;

  -- Resultado incerto depois do INSERT não pode emitir uma segunda invoice.
  SELECT invoice.id INTO v_existing_invoice_id
  FROM public.demurrage_invoices AS invoice
  WHERE invoice.bl_id = p_bl_id
    AND invoice.status IN ('issued', 'overdue', 'paid')
  ORDER BY invoice.id DESC
  LIMIT 1;
  IF v_existing_invoice_id IS NOT NULL THEN
    RETURN jsonb_build_object('invoice_id', v_existing_invoice_id, 'idempotent', true);
  END IF;

  v_result := public.create_demurrage_invoice_authoritative(
    format('DEM-AUTO-%s', p_effect_id),
    p_bl_id,
    v_customer_id,
    v_container_ids,
    NULL
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object('idempotent', false);
END;
$$;

CREATE OR REPLACE FUNCTION public._record_import_effect_blocked_alert(
  p_effect_id bigint,
  p_effect_kind text,
  p_entity_id text,
  p_error_code text,
  p_error_message text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  BEGIN
    PERFORM public.upsert_alert_item(
      'import_effect_blocked',
      'import_effect',
      p_effect_id::text,
      format('Um efeito de importação (%s) está bloqueado e precisa de investigação.', p_effect_kind),
      'import-effects-runner',
      jsonb_build_object(
        'effect_id', p_effect_id,
        'effect_kind', p_effect_kind,
        'entity_id', p_entity_id,
        'error_code', p_error_code,
        'error_message', left(regexp_replace(COALESCE(p_error_message, ''), '[[:cntrl:]]', ' ', 'g'), 500)
      ),
      '/alertas'
    );
  EXCEPTION WHEN OTHERS THEN
    -- A fila continua concluível mesmo se a infraestrutura de notificação
    -- estiver degradada; a falha fica no histórico do próprio efeito.
    RAISE WARNING 'Não foi possível abrir alerta do efeito %: %', p_effect_id, SQLERRM;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_import_effect(
  p_effect_id bigint,
  p_worker_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_effect public.import_pending_effects%ROWTYPE;
  v_actor uuid;
  v_result jsonb;
  v_status text;
  v_error_code text;
  v_error_message text;
  v_retry_at timestamptz;
  v_sqlstate text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_effect_id IS NULL OR NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL
     OR char_length(p_worker_id) > 128 THEN
    RAISE EXCEPTION 'Identidade de processamento incompleta.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_effect
  FROM public.import_pending_effects
  WHERE id = p_effect_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Efeito % não encontrado.', p_effect_id USING ERRCODE = 'P0002';
  END IF;

  IF v_effect.status IN ('succeeded', 'blocked', 'superseded') THEN
    RETURN jsonb_build_object('effect', to_jsonb(v_effect), 'idempotent', true);
  END IF;
  IF v_effect.status IS DISTINCT FROM 'running'
     OR v_effect.leased_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Lease do efeito não pertence ao worker.' USING ERRCODE = '42501';
  END IF;
  IF v_effect.lease_until IS NULL OR v_effect.lease_until <= now() THEN
    RAISE EXCEPTION 'Lease do efeito expirou.' USING ERRCODE = '40001';
  END IF;
  IF v_effect.created_by IS NULL THEN
    RAISE EXCEPTION 'Efeito sem iniciador validado.' USING ERRCODE = '42501';
  END IF;

  v_actor := v_effect.created_by;
  -- Os núcleos públicos continuam exigindo auth.uid() real. O GUC é carregado
  -- apenas dentro desta função privada, a partir do created_by congelado no
  -- efeito; a autorização de execução continua sendo service_role.
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);

  CASE v_effect.effect_kind
    WHEN 'physical_flags' THEN
      IF v_effect.entity_id !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'Viagem inválida no efeito de flags: %.', v_effect.entity_id
          USING ERRCODE = '22023';
      END IF;
      v_result := public.apply_baplie_physical_flags_atomic(v_effect.entity_id::bigint, NULL, v_actor);
    WHEN 'provisional_charges', 'local_billing' THEN
      v_result := public._run_import_effect_local_charges(v_effect.entity_id, v_actor);
    WHEN 'demurrage_billing' THEN
      v_result := public._run_import_effect_demurrage(v_effect.id, v_effect.entity_id, v_actor);
    WHEN 'granite_billing', 'vehicle_followup' THEN
      RAISE EXCEPTION 'Consumidor ainda não disponível para effect_kind %.', v_effect.effect_kind
        USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION 'effect_kind não suportado: %.', v_effect.effect_kind
        USING ERRCODE = 'P0001';
  END CASE;

  v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'executor', 'import-effects-runner',
    'worker_id', p_worker_id,
    'initiator_id', v_actor
  );
  RETURN public.complete_import_effect(
    v_effect.id,
    p_worker_id,
    'succeeded',
    v_result,
    NULL,
    NULL,
    NULL
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_sqlstate = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;

    v_status := CASE
      WHEN v_sqlstate IN ('40001', '40P01', '55P03') THEN 'retry_wait'
      ELSE 'blocked'
    END;
    v_error_code := CASE
      WHEN v_status = 'retry_wait' THEN 'transient_sql_error'
      WHEN v_sqlstate = '42501' THEN 'authorization_invalid'
      WHEN v_sqlstate = '22023' THEN 'invalid_effect_payload'
      WHEN v_sqlstate = 'P0002' THEN 'effect_domain_missing'
      WHEN v_sqlstate = 'P0001' THEN 'unsupported_effect_kind'
      ELSE 'effect_failed'
    END;
    IF v_status = 'retry_wait' AND v_effect.attempts >= 5 THEN
      v_status := 'blocked';
      v_error_code := 'retry_exhausted';
      v_error_message := 'Número máximo de tentativas atingido.';
    ELSIF v_status = 'retry_wait' THEN
      v_retry_at := now() + CASE v_effect.attempts
        WHEN 1 THEN interval '1 minute'
        WHEN 2 THEN interval '5 minutes'
        WHEN 3 THEN interval '15 minutes'
        ELSE interval '60 minutes'
      END;
    END IF;

    -- Se a falha ocorreu antes de carregar a linha, propaga: não há lease
    -- confiável para concluir. Para qualquer efeito já validado, a conclusão
    -- fica no mesmo caminho idempotente da fila.
    IF v_effect.id IS NULL THEN
      RAISE;
    END IF;
    IF v_status = 'blocked' THEN
      PERFORM public._record_import_effect_blocked_alert(
        v_effect.id,
        v_effect.effect_kind,
        v_effect.entity_id,
        v_error_code,
        v_error_message
      );
    END IF;
    RETURN public.complete_import_effect(
      v_effect.id,
      p_worker_id,
      v_status,
      jsonb_build_object(
        'executor', 'import-effects-runner',
        'worker_id', p_worker_id,
        'initiator_id', v_effect.created_by,
        'sqlstate', v_sqlstate
      ),
      v_error_code,
      v_error_message,
      v_retry_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public._run_import_effect_local_charges(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._run_import_effect_demurrage(bigint, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._record_import_effect_blocked_alert(bigint, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_import_effect(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_import_effect(bigint, text) TO service_role;

-- O consumidor fica agendado, mas a Edge Function permanece fail-closed até
-- que o operador publique IMPORT_EFFECTS_RUNNER_ENABLED=true no ambiente
-- correto. Assim o replay da migration não inicia efeitos financeiros sozinho.
DO $schedule_025$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL
     AND to_regproc('ops.dispatch_edge_job(text,text,text,text)') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'import-effects-runner') THEN
      PERFORM cron.unschedule('import-effects-runner');
    END IF;
    PERFORM cron.schedule(
      'import-effects-runner',
      '*/5 * * * *',
      $job_025$SELECT ops.dispatch_edge_job('import-effects-runner', 'IMPORT_EFFECTS_CRON_SECRET');$job_025$
    );
  ELSE
    RAISE WARNING '025: pg_cron/ops.dispatch_edge_job ausente; agende import-effects-runner no ambiente de produção.';
  END IF;
END;
$schedule_025$;
