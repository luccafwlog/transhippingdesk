-- S07/S10: torna a identidade do destinatário estável e mantém falhas de
-- prontidão retryable sem reclassificar silenciosamente o legado.
--
-- Intenção de negócio: o status do cabeçalho deve refletir destinatários
-- distintos, e uma mudança de readiness entre a criação e o dispatch não pode
-- criar um comunicado terminal que suprima a próxima automação.
-- Escopo: customer_communication_attempts, customer_communications e a RPC
-- server-only de bloqueio chamada pela Edge Function de CE Mercante.
-- A alteração é aditiva/forward-only. Rollback operacional: interromper o
-- runner, reconciliar tentativas com dispatch_mode='legado' e só então remover
-- a coluna/funções em uma migration futura após a drenagem do legado.

ALTER TABLE public.customer_communication_attempts
  ADD COLUMN IF NOT EXISTS recipient_key text;

COMMENT ON COLUMN public.customer_communication_attempts.recipient_key IS
  'Identidade SHA-256 do e-mail normalizado; NULL somente durante a transição de dados legados.';

ALTER TABLE public.customer_communication_attempts
  DROP CONSTRAINT IF EXISTS customer_communication_attempts_recipient_key_check;

ALTER TABLE public.customer_communication_attempts
  ADD CONSTRAINT customer_communication_attempts_recipient_key_check
  CHECK (recipient_key IS NULL OR char_length(btrim(recipient_key)) > 0);

ALTER TABLE public.customer_communication_attempts
  DROP CONSTRAINT IF EXISTS customer_communication_attempts_dispatch_mode_check;

ALTER TABLE public.customer_communication_attempts
  ADD CONSTRAINT customer_communication_attempts_dispatch_mode_check
  CHECK (dispatch_mode IN ('real', 'simulado', 'legado'));

-- As chaves antigas de Comunicados carregavam o e-mail normalizado no sufixo;
-- as chaves de Demurrage já carregavam a versão SHA-256 do destinatário.
UPDATE public.customer_communication_attempts AS a
   SET recipient_key = 'sha256:' || encode(
     extensions.digest(
       lower(btrim(substring(a.idempotency_key FROM '^comunicado:[^:]+:[^:]+:(.+)$'))),
       'sha256'
     ),
     'hex'
   )
 WHERE a.recipient_key IS NULL
   AND a.idempotency_key ~ '^comunicado:[^:]+:[^:]+:[^@[:space:]]+@[^@[:space:]]+$';

UPDATE public.customer_communication_attempts AS a
   SET recipient_key = 'sha256:' || lower(substring(a.idempotency_key FROM '([0-9a-f]{64})$'))
 WHERE a.recipient_key IS NULL
   AND lower(a.idempotency_key) ~ '^(demurrage|demurrage:group):.*:[0-9a-f]{64}$';

-- Mantém a semântica de agrupamento do legado que não pode ser reconstituído
-- com segurança, enquanto todas as novas tentativas usam recipient_key.
UPDATE public.customer_communication_attempts AS a
   SET recipient_key = 'legacy:' || lower(btrim(a.recipient_masked))
 WHERE a.recipient_key IS NULL;

CREATE OR REPLACE FUNCTION public.refresh_customer_communication_status(
  p_communication_id bigint
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_current_status text;
  v_real_success integer := 0;
  v_simulated_success integer := 0;
  v_failures integer := 0;
  v_pending integer := 0;
  v_legacy_pending integer := 0;
  v_next_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  SELECT status
    INTO v_current_status
  FROM public.customer_communications
  WHERE id = p_communication_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN NULL; END IF;

  WITH normalized_attempts AS (
    SELECT
      COALESCE(NULLIF(btrim(a.recipient_key), ''), 'legacy:' || lower(btrim(a.recipient_masked))) AS recipient_key,
      a.dispatch_mode,
      a.status,
      a.provider_message_id,
      a.created_at,
      a.id
    FROM public.customer_communication_attempts AS a
    WHERE a.communication_id = p_communication_id
  ), latest_attempts AS (
    SELECT DISTINCT ON (a.recipient_key)
      a.recipient_key,
      a.dispatch_mode,
      a.status,
      a.provider_message_id
    FROM normalized_attempts AS a
    ORDER BY a.recipient_key, a.created_at DESC, a.id DESC
  )
  SELECT
    count(*) FILTER (
      WHERE a.dispatch_mode = 'real'
        AND (a.status = 'entregue' OR (a.status = 'aceito' AND a.provider_message_id IS NOT NULL))
    )::integer,
    count(*) FILTER (
      WHERE a.dispatch_mode = 'simulado'
        AND a.status IN ('aceito', 'entregue')
    )::integer,
    count(*) FILTER (WHERE a.status IN ('bounce', 'complaint', 'falha_transitoria', 'falha_permanente'))::integer,
    count(*) FILTER (
      WHERE a.dispatch_mode = 'real'
        AND a.status = 'aceito'
        AND a.provider_message_id IS NULL
    )::integer,
    count(*) FILTER (WHERE a.dispatch_mode = 'legado')::integer
  INTO v_real_success, v_simulated_success, v_failures, v_pending, v_legacy_pending
  FROM latest_attempts AS a;

  -- Tentativas anteriores à coluna dispatch_mode são inconclusivas: não
  -- podem virar sucesso real nem simulação terminal sem nova confirmação.
  IF v_legacy_pending > 0 THEN
    RETURN v_current_status;
  END IF;

  IF v_failures > 0 AND (v_real_success + v_simulated_success) > 0 THEN
    v_next_status := 'parcial';
  ELSIF v_real_success > 0 AND v_simulated_success > 0 THEN
    v_next_status := 'parcial';
  ELSIF v_failures > 0 AND (v_real_success + v_simulated_success) = 0 AND v_pending = 0 THEN
    v_next_status := 'falha';
  ELSIF v_pending = 0 AND v_failures = 0 AND v_real_success > 0 AND v_simulated_success = 0 THEN
    v_next_status := 'enviado';
  ELSIF v_pending = 0 AND v_failures = 0 AND v_simulated_success > 0 AND v_real_success = 0 THEN
    v_next_status := 'simulado';
  ELSE
    RETURN v_current_status;
  END IF;

  UPDATE public.customer_communications
     SET status = v_next_status
   WHERE id = p_communication_id;

  RETURN v_next_status;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_customer_communication_status(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_customer_communication_status(bigint) TO service_role;

-- O default de 032 marcou tentativas aceitas sem provider como real. Elas são
-- indistinguíveis entre dry-run histórico e janela de crash, portanto ficam
-- explicitamente legadas até uma tentativa atualizá-las com a verdade.
DROP TRIGGER IF EXISTS customer_communication_attempts_refresh_status
  ON public.customer_communication_attempts;

UPDATE public.customer_communication_attempts
   SET dispatch_mode = 'legado'
 WHERE dispatch_mode = 'real'
   AND status = 'aceito'
   AND provider_message_id IS NULL;

-- Um comunicado histórico que contém apenas esse tipo de tentativa não pode
-- continuar em 'simulado', pois isso faria o candidato automático ser pulado.
UPDATE public.customer_communications AS c
   SET status = 'parcial'
 WHERE c.status = 'simulado'
   AND EXISTS (
     SELECT 1
     FROM public.customer_communication_attempts AS a
     WHERE a.communication_id = c.id
       AND a.dispatch_mode = 'legado'
   );

CREATE OR REPLACE FUNCTION public.mark_customer_communication_dispatch_blocked(
  p_communication_id bigint
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_attempt_count integer;
  v_next_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.customer_communications
  WHERE id = p_communication_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*)::integer
    INTO v_attempt_count
  FROM public.customer_communication_attempts
  WHERE communication_id = p_communication_id;

  v_next_status := CASE WHEN v_attempt_count = 0 THEN 'falha' ELSE 'parcial' END;

  UPDATE public.customer_communications
     SET status = v_next_status
   WHERE id = p_communication_id;

  RETURN v_next_status;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_customer_communication_dispatch_blocked(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_customer_communication_dispatch_blocked(bigint) TO service_role;

CREATE TRIGGER customer_communication_attempts_refresh_status
  AFTER INSERT OR UPDATE OF status, provider_message_id, dispatch_mode
  ON public.customer_communication_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public._refresh_customer_communication_status_trigger();
