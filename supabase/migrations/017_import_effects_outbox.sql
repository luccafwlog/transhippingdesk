-- 017: fila duravel dos efeitos pos-commit de imports (S05).
--
-- A migracao 015 criou uma tabela estreita para que os RPCs de origem nunca
-- perdessem o sinal de faturamento/flags depois do commit. Aqui a fila ganha
-- identidade de revisao, dependencias, lease e historico append-only. O
-- navegador continua sem qualquer caminho de escrita direta.

ALTER TABLE public.import_pending_effects
  ADD COLUMN IF NOT EXISTS source_revision bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS depends_on_effect_id bigint,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS leased_by text,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS last_error_message text,
  ADD COLUMN IF NOT EXISTS result jsonb,
  ADD COLUMN IF NOT EXISTS superseded_by_effect_id bigint,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.import_pending_effects
   SET source_snapshot = COALESCE(source_snapshot, '{}'::jsonb),
       next_attempt_at = COALESCE(next_attempt_at, created_at, now()),
       updated_at = COALESCE(updated_at, created_at, now())
 WHERE source_snapshot IS NULL
    OR next_attempt_at IS NULL
    OR updated_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.import_pending_effects'::regclass
      AND conname = 'import_pending_effects_source_revision_chk'
  ) THEN
    ALTER TABLE public.import_pending_effects
      ADD CONSTRAINT import_pending_effects_source_revision_chk
      CHECK (source_revision > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.import_pending_effects'::regclass
      AND conname = 'import_pending_effects_source_snapshot_chk'
  ) THEN
    ALTER TABLE public.import_pending_effects
      ADD CONSTRAINT import_pending_effects_source_snapshot_chk
      CHECK (jsonb_typeof(source_snapshot) = 'object');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.import_pending_effects'::regclass
      AND conname = 'import_pending_effects_depends_fk'
  ) THEN
    ALTER TABLE public.import_pending_effects
      ADD CONSTRAINT import_pending_effects_depends_fk
      FOREIGN KEY (depends_on_effect_id)
      REFERENCES public.import_pending_effects(id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.import_pending_effects'::regclass
      AND conname = 'import_pending_effects_superseded_by_fk'
  ) THEN
    ALTER TABLE public.import_pending_effects
      ADD CONSTRAINT import_pending_effects_superseded_by_fk
      FOREIGN KEY (superseded_by_effect_id)
      REFERENCES public.import_pending_effects(id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS import_pending_effects_claim_idx
  ON public.import_pending_effects(status, next_attempt_at, created_at, id);
CREATE INDEX IF NOT EXISTS import_pending_effects_entity_idx
  ON public.import_pending_effects(entity_id, effect_kind, source_revision, status);

-- O lease e persistente; este indice impede dois workers de processarem a
-- mesma entidade ao mesmo tempo, inclusive quando os efeitos sao de tipos
-- diferentes.
CREATE UNIQUE INDEX IF NOT EXISTS import_pending_effects_one_running_entity_idx
  ON public.import_pending_effects(entity_id)
  WHERE status = 'running';

CREATE TABLE IF NOT EXISTS public.import_effect_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  effect_id bigint NOT NULL REFERENCES public.import_pending_effects(id) ON DELETE CASCADE,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  event_kind text NOT NULL CHECK (event_kind IN (
    'claimed', 'completed', 'lease_expired', 'dependency_blocked'
  )),
  worker_id text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'pending', 'running', 'retry_wait', 'blocked', 'succeeded', 'superseded'
  )),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  result jsonb,
  error_code text,
  error_message text,
  CONSTRAINT import_effect_attempts_worker_chk CHECK (char_length(worker_id) BETWEEN 1 AND 128),
  CONSTRAINT import_effect_attempts_error_code_chk CHECK (error_code IS NULL OR char_length(error_code) <= 200),
  CONSTRAINT import_effect_attempts_error_message_chk CHECK (error_message IS NULL OR char_length(error_message) <= 2000)
);

CREATE INDEX IF NOT EXISTS import_effect_attempts_effect_idx
  ON public.import_effect_attempts(effect_id, attempt_no, occurred_at, id);

CREATE OR REPLACE FUNCTION public.prevent_import_effect_attempt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Historico de efeitos e append-only.' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS import_effect_attempts_append_only ON public.import_effect_attempts;
CREATE TRIGGER import_effect_attempts_append_only
  BEFORE UPDATE OR DELETE ON public.import_effect_attempts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_import_effect_attempt_mutation();

ALTER TABLE public.import_pending_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_effect_attempts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'import_effect_attempts'
      AND policyname = 'import_effect_attempts_select_active'
  ) THEN
    CREATE POLICY import_effect_attempts_select_active
      ON public.import_effect_attempts FOR SELECT TO authenticated
      USING (public.is_active_read_user());
  END IF;
END
$$;

REVOKE ALL ON TABLE public.import_pending_effects FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.import_pending_effects TO authenticated, service_role;
GRANT ALL ON TABLE public.import_pending_effects TO service_role;
REVOKE ALL ON TABLE public.import_effect_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.import_effect_attempts TO authenticated, service_role;
GRANT ALL ON TABLE public.import_effect_attempts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.import_effect_attempts_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public._import_effect_priority(p_effect_kind text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_effect_kind
    WHEN 'physical_flags' THEN 10
    WHEN 'provisional_charges' THEN 20
    WHEN 'local_billing' THEN 30
    WHEN 'granite_billing' THEN 30
    WHEN 'demurrage_billing' THEN 40
    WHEN 'vehicle_followup' THEN 50
    ELSE 100
  END;
$$;

-- Enfileira uma revisao sem permitir que uma importacao mais antiga volte a
-- executar depois de uma nova. A mesma identidade logica e idempotente.
CREATE OR REPLACE FUNCTION public.enqueue_import_effect(
  p_source_action_id uuid,
  p_effect_kind text,
  p_entity_id text,
  p_created_by uuid,
  p_source_revision bigint DEFAULT 1,
  p_depends_on_effect_id bigint DEFAULT NULL,
  p_source_snapshot jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_existing public.import_pending_effects%ROWTYPE;
  v_new public.import_pending_effects%ROWTYPE;
  v_entity text := NULLIF(btrim(COALESCE(p_entity_id, '')), '');
  v_snapshot jsonb := COALESCE(p_source_snapshot, '{}'::jsonb);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR p_created_by IS DISTINCT FROM auth.uid() OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_source_action_id IS NULL OR p_effect_kind IS NULL OR v_entity IS NULL THEN
    RAISE EXCEPTION 'Identidade do efeito incompleta.' USING ERRCODE = '22023';
  END IF;
  IF p_source_revision IS NULL OR p_source_revision < 1 THEN
    RAISE EXCEPTION 'Revisao de origem invalida.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'Snapshot de origem invalido.' USING ERRCODE = '22023';
  END IF;
  IF p_depends_on_effect_id IS NOT NULL THEN
    PERFORM 1 FROM public.import_pending_effects WHERE id = p_depends_on_effect_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Dependencia de efeito inexistente.' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO v_existing
  FROM public.import_pending_effects
  WHERE source_action_id = p_source_action_id
    AND effect_kind = p_effect_kind
    AND entity_id = v_entity
  FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('effect', to_jsonb(v_existing), 'idempotent', true);
  END IF;

  INSERT INTO public.import_pending_effects(
    source_action_id, effect_kind, entity_id, status, attempts, created_by,
    source_revision, source_snapshot, depends_on_effect_id, next_attempt_at, updated_at
  ) VALUES (
    p_source_action_id, p_effect_kind, v_entity, 'pending', 0, p_created_by,
    p_source_revision, v_snapshot, p_depends_on_effect_id, now(), now()
  ) RETURNING * INTO v_new;

  UPDATE public.import_pending_effects AS old
     SET status = 'superseded',
         superseded_by_effect_id = v_new.id,
         lease_until = NULL,
         leased_by = NULL,
         result = COALESCE(old.result, '{}'::jsonb)
           || jsonb_build_object('superseded_by_effect_id', v_new.id),
         updated_at = now()
   WHERE old.id <> v_new.id
     AND old.entity_id = v_entity
     AND old.effect_kind = p_effect_kind
     AND old.source_revision < p_source_revision
     AND old.status IN ('pending', 'running', 'retry_wait');

  RETURN jsonb_build_object('effect', to_jsonb(v_new), 'idempotent', false);
END;
$$;

-- O worker e o unico ator que pode tomar leases. O limite de cinco tentativas
-- e aplicado no banco, inclusive quando um lease expira sem resposta.
CREATE OR REPLACE FUNCTION public.claim_import_effects(
  p_worker_id text,
  p_limit integer DEFAULT 20,
  p_lease_seconds integer DEFAULT 300
) RETURNS SETOF public.import_pending_effects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_worker text := NULLIF(btrim(COALESCE(p_worker_id, '')), '');
  -- Opcionalmente restringe uma execução interna a um prefixo de entidade.
  -- O runner normal não define o GUC; ele existe para replay/diagnóstico
  -- controlado sem permitir que um teste capture efeitos de outra unidade.
  v_entity_prefix text := NULLIF(current_setting('import_effects.entity_prefix', true), '');
  v_row record;
  v_next_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF v_worker IS NULL OR char_length(v_worker) > 128 THEN
    RAISE EXCEPTION 'Worker invalido.' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Limite de claim invalido.' USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'Lease invalido.' USING ERRCODE = '22023';
  END IF;

  -- Recupera workers que morreram. A transicao e registrada sem editar o
  -- historico anterior; somente o estado corrente da fila e mutavel.
  FOR v_row IN
    SELECT id, attempts, entity_id
    FROM public.import_pending_effects
    WHERE status = 'running'
      AND (v_entity_prefix IS NULL OR entity_id LIKE v_entity_prefix)
      AND lease_until IS NOT NULL
      AND lease_until <= now()
    ORDER BY lease_until, id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_next_status := CASE WHEN v_row.attempts >= 5 THEN 'blocked' ELSE 'retry_wait' END;
    UPDATE public.import_pending_effects
       SET status = v_next_status,
           next_attempt_at = CASE WHEN v_next_status = 'retry_wait' THEN now() ELSE next_attempt_at END,
           lease_until = NULL,
           leased_by = NULL,
           last_error_code = 'lease_expired',
           last_error_message = 'Lease expirada antes da confirmacao do worker.',
           updated_at = now()
     WHERE id = v_row.id;
    INSERT INTO public.import_effect_attempts(
      effect_id, attempt_no, event_kind, worker_id, status, error_code, error_message
    ) VALUES (
      v_row.id, GREATEST(v_row.attempts, 1), 'lease_expired', 'lease-recovery',
      v_next_status, 'lease_expired', 'Lease expirada antes da confirmacao do worker.'
    );
  END LOOP;

  -- Uma dependencia bloqueada bloqueia seus descendentes, evitando uma fila
  -- que parece pendente indefinidamente depois de uma falha permanente.
  FOR v_row IN
    SELECT e.id, e.attempts
    FROM public.import_pending_effects AS e
    JOIN public.import_pending_effects AS dependency
      ON dependency.id = e.depends_on_effect_id
    WHERE e.status IN ('pending', 'retry_wait')
      AND (v_entity_prefix IS NULL OR e.entity_id LIKE v_entity_prefix)
      AND dependency.status IN ('blocked', 'superseded')
    FOR UPDATE OF e SKIP LOCKED
  LOOP
    UPDATE public.import_pending_effects
       SET status = 'blocked',
           lease_until = NULL,
           leased_by = NULL,
           last_error_code = 'dependency_blocked',
           last_error_message = 'Efeito dependente bloqueado ou superado.',
           updated_at = now()
     WHERE id = v_row.id;
    INSERT INTO public.import_effect_attempts(
      effect_id, attempt_no, event_kind, worker_id, status, error_code, error_message
    ) VALUES (
      v_row.id, GREATEST(v_row.attempts, 1), 'dependency_blocked', 'dependency-guard',
      'blocked', 'dependency_blocked', 'Efeito dependente bloqueado ou superado.'
    );
  END LOOP;

  RETURN QUERY
  WITH eligible_ranked AS (
    SELECT DISTINCT ON (e.entity_id)
      e.id,
      e.entity_id,
      public._import_effect_priority(e.effect_kind) AS priority
    FROM public.import_pending_effects AS e
    WHERE e.status IN ('pending', 'retry_wait')
      AND (v_entity_prefix IS NULL OR e.entity_id LIKE v_entity_prefix)
      AND e.attempts < 5
      AND e.next_attempt_at <= now()
      AND (e.depends_on_effect_id IS NULL OR EXISTS (
        SELECT 1 FROM public.import_pending_effects AS dependency
        WHERE dependency.id = e.depends_on_effect_id
          AND dependency.status = 'succeeded'
      ))
      AND NOT EXISTS (
        SELECT 1 FROM public.import_pending_effects AS prior
        WHERE prior.entity_id = e.entity_id
          AND public._import_effect_priority(prior.effect_kind)
              < public._import_effect_priority(e.effect_kind)
          AND prior.status IN ('pending', 'running', 'retry_wait')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.import_pending_effects AS running
        WHERE running.entity_id = e.entity_id
          AND running.status = 'running'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.import_pending_effects AS newer
        WHERE newer.entity_id = e.entity_id
          AND newer.effect_kind = e.effect_kind
          AND newer.source_revision > e.source_revision
          AND newer.status <> 'superseded'
      )
    ORDER BY e.entity_id, public._import_effect_priority(e.effect_kind), e.next_attempt_at, e.id
  ),
  claimable AS (
    SELECT e.id
    FROM public.import_pending_effects AS e
    JOIN eligible_ranked AS ranked ON ranked.id = e.id
    WHERE pg_try_advisory_xact_lock(hashtextextended(e.entity_id, 174017))
    ORDER BY ranked.priority, e.next_attempt_at, e.id
    FOR UPDATE OF e SKIP LOCKED
    LIMIT p_limit
  ),
  claimed AS (
    UPDATE public.import_pending_effects AS e
       SET status = 'running',
           attempts = e.attempts + 1,
           lease_until = now() + make_interval(secs => p_lease_seconds),
           leased_by = v_worker,
           updated_at = now(),
           last_error_code = NULL,
           last_error_message = NULL
      FROM claimable AS c
     WHERE e.id = c.id
     RETURNING e.*
  ),
  recorded AS (
    INSERT INTO public.import_effect_attempts(
      effect_id, attempt_no, event_kind, worker_id, status
    )
    SELECT id, attempts, 'claimed', v_worker, 'running'
    FROM claimed
    RETURNING effect_id
  )
  SELECT claimed.*
  FROM claimed
  JOIN recorded ON recorded.effect_id = claimed.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_import_effect(
  p_effect_id bigint,
  p_worker_id text,
  p_status text,
  p_result jsonb DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_retry_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.import_pending_effects%ROWTYPE;
  v_final_status text := p_status;
  v_result jsonb := COALESCE(p_result, '{}'::jsonb);
  v_error_code text := NULLIF(left(COALESCE(p_error_code, ''), 200), '');
  v_error_message text := NULLIF(left(COALESCE(p_error_message, ''), 2000), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_effect_id IS NULL OR NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Identidade de conclusao incompleta.' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('succeeded', 'retry_wait', 'blocked', 'superseded') THEN
    RAISE EXCEPTION 'Estado final invalido.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_result) <> 'object' THEN
    RAISE EXCEPTION 'Resultado de efeito invalido.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.import_pending_effects
  WHERE id = p_effect_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Efeito % nao encontrado.', p_effect_id USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status IN ('succeeded', 'blocked', 'superseded') THEN
    RETURN jsonb_build_object('effect', to_jsonb(v_row), 'idempotent', true);
  END IF;
  IF v_row.status IS DISTINCT FROM 'running'
     OR v_row.leased_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Lease do efeito nao pertence ao worker.' USING ERRCODE = '42501';
  END IF;
  IF v_row.lease_until IS NULL OR v_row.lease_until <= now() THEN
    RAISE EXCEPTION 'Lease do efeito expirou.' USING ERRCODE = '40001';
  END IF;

  IF v_final_status = 'retry_wait' AND v_row.attempts >= 5 THEN
    v_final_status := 'blocked';
    v_error_code := COALESCE(v_error_code, 'retry_exhausted');
    v_error_message := COALESCE(v_error_message, 'Numero maximo de tentativas atingido.');
  END IF;

  UPDATE public.import_pending_effects
     SET status = v_final_status,
         lease_until = NULL,
         leased_by = NULL,
         next_attempt_at = CASE
           WHEN v_final_status = 'retry_wait' THEN COALESCE(p_retry_at, now() + interval '5 minutes')
           ELSE next_attempt_at
         END,
         result = v_result,
         last_error_code = CASE WHEN v_final_status = 'succeeded' THEN NULL ELSE v_error_code END,
         last_error_message = CASE WHEN v_final_status = 'succeeded' THEN NULL ELSE v_error_message END,
         updated_at = now()
   WHERE id = v_row.id;

  INSERT INTO public.import_effect_attempts(
    effect_id, attempt_no, event_kind, worker_id, status,
    result, error_code, error_message
  ) VALUES (
    v_row.id, v_row.attempts, 'completed', p_worker_id, v_final_status,
    v_result, CASE WHEN v_final_status = 'succeeded' THEN NULL ELSE v_error_code END,
    CASE WHEN v_final_status = 'succeeded' THEN NULL ELSE v_error_message END
  );

  SELECT * INTO v_row FROM public.import_pending_effects WHERE id = p_effect_id;
  RETURN jsonb_build_object('effect', to_jsonb(v_row), 'idempotent', false);
END;
$$;

-- Reabertura manual e deliberada de erro permanente. O operador nao altera
-- payload nem identidade; somente reautoriza uma nova tentativa auditada.
CREATE OR REPLACE FUNCTION public.retry_import_effect(
  p_effect_id bigint,
  p_justification text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.import_pending_effects%ROWTYPE;
  v_actor uuid := auth.uid();
  v_role text := public.current_actor_role();
  v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (v_actor IS NULL OR NOT public.is_active_user()
          OR v_role NOT IN ('admin', 'financeiro', 'operacional', 'documentacao')) THEN
    RAISE EXCEPTION 'Usuario sem permissao para reabrir efeito.' USING ERRCODE = '42501';
  END IF;
  IF v_justification IS NULL OR char_length(v_justification) > 500 THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para retry.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.import_pending_effects
  WHERE id = p_effect_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Efeito % nao encontrado.', p_effect_id USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status IS DISTINCT FROM 'blocked' THEN
    RAISE EXCEPTION 'Somente efeitos bloqueados podem ser reabertos.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.import_pending_effects
     SET status = 'retry_wait',
         attempts = 0,
         next_attempt_at = now(),
         lease_until = NULL,
         leased_by = NULL,
         last_error_code = NULL,
         last_error_message = NULL,
         result = COALESCE(result, '{}'::jsonb)
           || jsonb_build_object('manual_retry_justification', v_justification),
         updated_at = now()
   WHERE id = v_row.id;

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, justification, actor_role, actor_department
  ) VALUES (
    'import_effect', v_row.id::text, 'retry',
    jsonb_build_object('status', 'blocked', 'attempts', v_row.attempts)::text,
    jsonb_build_object('status', 'retry_wait', 'attempts', 0)::text,
    v_actor, v_justification, COALESCE(v_role, 'sistema'), COALESCE(v_role, 'sistema')
  );

  SELECT * INTO v_row FROM public.import_pending_effects WHERE id = p_effect_id;
  RETURN jsonb_build_object('effect', to_jsonb(v_row), 'idempotent', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_import_effects(
  p_entity_id text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 100
) RETURNS SETOF public.import_pending_effects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao de leitura.' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'Limite de consulta invalido.' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT e.*
  FROM public.import_pending_effects AS e
  WHERE (p_entity_id IS NULL OR e.entity_id = p_entity_id)
    AND (p_status IS NULL OR e.status = p_status)
  ORDER BY e.updated_at DESC, e.id DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public._import_effect_priority(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_import_effect_attempt_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_import_effect(uuid, text, text, uuid, bigint, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_import_effects(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_import_effect(bigint, text, text, jsonb, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_import_effect(bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_import_effects(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_import_effect(uuid, text, text, uuid, bigint, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_import_effects(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_import_effect(bigint, text, text, jsonb, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_import_effect(bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_import_effects(text, text, integer) TO authenticated, service_role;
