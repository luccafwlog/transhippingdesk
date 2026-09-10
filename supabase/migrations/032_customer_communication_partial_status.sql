-- S07: um comunicado pode ter destinatários com resultados distintos.
-- O status do cabeçalho é uma projeção derivada das tentativas; a tentativa
-- mantém o modo real/simulado para que a mistura não seja perdida.

ALTER TABLE public.customer_communications
  DROP CONSTRAINT IF EXISTS customer_communications_status_check;

ALTER TABLE public.customer_communications
  ADD CONSTRAINT customer_communications_status_check
  CHECK (status IN ('enviado', 'simulado', 'falha', 'parcial'));

ALTER TABLE public.customer_communication_attempts
  ADD COLUMN IF NOT EXISTS dispatch_mode text NOT NULL DEFAULT 'real';

ALTER TABLE public.customer_communication_attempts
  DROP CONSTRAINT IF EXISTS customer_communication_attempts_dispatch_mode_check;

ALTER TABLE public.customer_communication_attempts
  ADD CONSTRAINT customer_communication_attempts_dispatch_mode_check
  CHECK (dispatch_mode IN ('real', 'simulado'));

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
  FROM public.customer_communication_attempts AS a
  WHERE a.communication_id = p_communication_id;

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

CREATE OR REPLACE FUNCTION public._refresh_customer_communication_status_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM public.refresh_customer_communication_status(NEW.communication_id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._refresh_customer_communication_status_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._refresh_customer_communication_status_trigger() TO service_role;

DROP TRIGGER IF EXISTS customer_communication_attempts_refresh_status
  ON public.customer_communication_attempts;
CREATE TRIGGER customer_communication_attempts_refresh_status
  AFTER INSERT OR UPDATE OF status, provider_message_id, dispatch_mode
  ON public.customer_communication_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public._refresh_customer_communication_status_trigger();
