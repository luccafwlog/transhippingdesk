-- 038: agrega apenas a tentativa mais recente por destinatário no status do comunicado (S07).
--
-- A migration 032 conta todas as linhas em customer_communication_attempts.
-- Se um destinatário falha transitoriamente e um retry posterior registra uma
-- nova linha com sucesso, a contagem histórica mantém v_failures > 0 e fixa o
-- comunicado em "parcial" mesmo que todos os destinatários tenham sido entregues.
-- Esta migration forward refina a função para selecionar DISTINCT ON (recipient_masked),
-- garantindo que apenas a tentativa mais recente de cada destinatário decida o cabeçalho.

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

  -- Considera apenas a tentativa mais recente de cada destinatário mascareado
  -- para que retries bem-sucedidos sobreponham falhas transitórias anteriores.
  WITH latest_attempts AS (
    SELECT DISTINCT ON (a.recipient_masked)
      a.dispatch_mode,
      a.status,
      a.provider_message_id
    FROM public.customer_communication_attempts AS a
    WHERE a.communication_id = p_communication_id
    ORDER BY a.recipient_masked, a.created_at DESC, a.id DESC
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
    )::integer
  INTO v_real_success, v_simulated_success, v_failures, v_pending
  FROM latest_attempts AS a;

  -- Um resultado misto nunca é achatado para enviado/simulado/falha.
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
