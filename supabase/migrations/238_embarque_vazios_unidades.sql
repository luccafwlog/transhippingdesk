-- ADR 0033: Lista de Unidades Embarcadas. A lista da escala e substituida no import.

ALTER TABLE public.depots
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'depot',
  ADD COLUMN IF NOT EXISTS free_time_vazio_days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_time_material_days INTEGER NOT NULL DEFAULT 0,
  DROP COLUMN IF EXISTS free_time_days,
  DROP COLUMN IF EXISTS pol_port;

ALTER TABLE public.depots
  ADD CONSTRAINT depots_tipo_check CHECK (tipo IN ('depot', 'terminal_portuario')),
  ADD CONSTRAINT depots_free_time_check CHECK (
    free_time_vazio_days >= 0 AND free_time_material_days >= 0
    AND (tipo = 'depot' OR (free_time_vazio_days = 0 AND free_time_material_days = 0))
  );

ALTER TABLE public.vazios_bookings
  DROP COLUMN IF EXISTS booking_number,
  DROP COLUMN IF EXISTS destination,
  DROP COLUMN IF EXISTS origin_terminal,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS overtime_pct,
  DROP COLUMN IF EXISTS material,
  DROP COLUMN IF EXISTS depot,
  DROP COLUMN IF EXISTS depot_id,
  DROP COLUMN IF EXISTS embark_port,
  DROP COLUMN IF EXISTS os_number;

ALTER TABLE public.vazios_bookings
  ADD COLUMN IF NOT EXISTS local_id UUID REFERENCES public.depots(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS condition TEXT,
  ADD COLUMN IF NOT EXISTS operation_id UUID REFERENCES public.vazios_export_operations(id) ON DELETE CASCADE;

ALTER TABLE public.vazios_bookings
  ALTER COLUMN local_id SET NOT NULL,
  ALTER COLUMN condition SET NOT NULL,
  ALTER COLUMN operation_id SET NOT NULL;

ALTER TABLE public.vazios_bookings
  DROP CONSTRAINT IF EXISTS vazios_bookings_condition_check,
  ADD CONSTRAINT vazios_bookings_condition_check CHECK (condition IN ('vazio', 'material'));

ALTER TABLE public.vazios_bookings
  DROP CONSTRAINT IF EXISTS vazios_bookings_voyage_id_container_number_key;
CREATE UNIQUE INDEX uq_vazios_bookings_operation_container
  ON public.vazios_bookings(operation_id, container_number);
CREATE INDEX idx_vazios_bookings_operation_id ON public.vazios_bookings(operation_id);

CREATE OR REPLACE FUNCTION public.validate_vazios_booking_operation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_operation_voyage_id BIGINT;
BEGIN
  SELECT voyage_id INTO v_operation_voyage_id FROM public.vazios_export_operations WHERE id = NEW.operation_id;
  IF v_operation_voyage_id IS NULL OR v_operation_voyage_id <> NEW.voyage_id THEN
    RAISE EXCEPTION 'Unidade deve pertencer a uma operacao da mesma viagem.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.validate_vazios_booking_operation() FROM PUBLIC, anon;
CREATE TRIGGER validate_vazios_booking_operation
  BEFORE INSERT OR UPDATE ON public.vazios_bookings
  FOR EACH ROW EXECUTE FUNCTION public.validate_vazios_booking_operation();

DROP FUNCTION IF EXISTS public.import_vazios_bookings_transactional(BIGINT, TEXT, UUID, JSONB);

CREATE OR REPLACE FUNCTION public.import_vazios_bookings_transactional(
  p_voyage_id BIGINT, p_port TEXT, p_uploaded_by UUID, p_bookings JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_manifest_id UUID;
  v_operation_id UUID;
  v_total INTEGER := jsonb_array_length(COALESCE(p_bookings, '[]'::JSONB));
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_active_user() OR public.is_equipamentos_user())
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar unidades.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_port), '') IS NULL THEN
    RAISE EXCEPTION 'Porto de embarque obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.vazios_export_operations (voyage_id, embark_port, updated_at)
  VALUES (p_voyage_id, upper(btrim(p_port)), now())
  ON CONFLICT (voyage_id, embark_port) DO UPDATE SET updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_operation_id;

  -- ponytail: validacao no RPC e tudo-ou-nada para nao subestimar pagamento por erro de uma linha.
  WITH raw AS (
    SELECT item.*
    FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) WITH ORDINALITY AS item(
      container_number, container_type, local_code, condition,
      hand_in_date, hand_out_date, movement_date, row_ordinal
    )
  ), deduped AS (
    SELECT DISTINCT ON (upper(btrim(container_number))) *
    FROM raw ORDER BY upper(btrim(container_number)), row_ordinal DESC
  )
  SELECT 1
  FROM deduped r
  LEFT JOIN public.depots d ON lower(d.code) = lower(btrim(r.local_code))
  WHERE NULLIF(btrim(r.container_number), '') IS NULL
     OR r.container_number !~ '^[A-Za-z]{4}[0-9]{7}$'
     OR NULLIF(btrim(r.local_code), '') IS NULL
     OR d.id IS NULL
     OR (d.id IS NOT NULL AND NOT d.active)
     OR (COALESCE(d.tipo, 'depot') = 'depot' AND (r.hand_in_date IS NULL OR r.hand_out_date IS NULL))
     OR (COALESCE(d.tipo, 'depot') = 'depot' AND r.hand_out_date < r.hand_in_date)
     OR (d.id IS NOT NULL AND d.tipo = 'terminal_portuario' AND (r.hand_in_date IS NOT NULL OR r.hand_out_date IS NOT NULL))
     OR r.condition IS NULL OR r.condition NOT IN ('vazio', 'material')
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Planilha invalida: corrija todas as linhas e importe novamente.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.vazios_manifests (voyage_id, description, total_bookings, imported_by)
  VALUES (p_voyage_id, p_port, v_total, p_uploaded_by) RETURNING id INTO v_manifest_id;

  DELETE FROM public.vazios_bookings WHERE operation_id = v_operation_id;
  INSERT INTO public.vazios_bookings (voyage_id, operation_id, manifest_id, container_number, container_type,
    local_id, condition, hand_in_date, hand_out_date, movement_date)
  SELECT p_voyage_id, v_operation_id, v_manifest_id, upper(btrim(r.container_number)), r.container_type, d.id,
    r.condition, r.hand_in_date, r.hand_out_date, r.movement_date
  FROM (
    SELECT DISTINCT ON (upper(btrim(container_number))) *
    FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS item(
      container_number TEXT, container_type TEXT, local_code TEXT, condition TEXT,
      hand_in_date DATE, hand_out_date DATE, movement_date DATE
    ) ORDER BY upper(btrim(container_number))
  ) r JOIN public.depots d ON lower(d.code) = lower(btrim(r.local_code)) AND d.active;

  RETURN jsonb_build_object('manifest_id', v_manifest_id, 'operation_id', v_operation_id, 'total', v_total, 'replaced', TRUE);
END;
$function$;

REVOKE ALL ON FUNCTION public.import_vazios_bookings_transactional(BIGINT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_vazios_bookings_transactional(BIGINT, TEXT, UUID, JSONB) TO authenticated;
