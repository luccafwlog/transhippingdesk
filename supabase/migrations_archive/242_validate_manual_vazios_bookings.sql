-- ADR 0033: CRUD manual respeita as mesmas regras de local e datas do import.
-- Rollback: restaurar validate_vazios_booking_operation da migration 238.

CREATE OR REPLACE FUNCTION public.validate_vazios_booking_operation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_operation_voyage_id BIGINT;
  v_local_tipo TEXT;
BEGIN
  SELECT voyage_id INTO v_operation_voyage_id FROM public.vazios_export_operations WHERE id = NEW.operation_id;
  SELECT tipo INTO v_local_tipo FROM public.depots WHERE id = NEW.local_id;
  IF v_operation_voyage_id IS NULL OR v_operation_voyage_id <> NEW.voyage_id THEN
    RAISE EXCEPTION 'Unidade deve pertencer a uma operacao da mesma viagem.' USING ERRCODE = '23514';
  END IF;
  IF v_local_tipo IS NULL THEN RAISE EXCEPTION 'Local invalido.' USING ERRCODE = '23514'; END IF;
  IF v_local_tipo = 'depot' AND (NEW.hand_in_date IS NULL OR NEW.hand_out_date IS NULL OR NEW.hand_out_date < NEW.hand_in_date) THEN
    RAISE EXCEPTION 'Depot exige entrada e saida validas.' USING ERRCODE = '23514';
  END IF;
  IF v_local_tipo = 'terminal_portuario' AND (NEW.hand_in_date IS NOT NULL OR NEW.hand_out_date IS NOT NULL) THEN
    RAISE EXCEPTION 'Terminal portuario nao aceita entrada ou saida.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
