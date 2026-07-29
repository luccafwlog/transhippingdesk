-- ADR 0033: Lista de Unidades Embarcadas. A lista da escala e substituida no import.

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
  ADD COLUMN IF NOT EXISTS condition TEXT;

ALTER TABLE public.vazios_bookings
  ALTER COLUMN local_id SET NOT NULL;

ALTER TABLE public.vazios_bookings
  DROP CONSTRAINT IF EXISTS vazios_bookings_condition_check,
  ADD CONSTRAINT vazios_bookings_condition_check CHECK (condition IN ('vazio', 'material'));

DROP FUNCTION IF EXISTS public.import_vazios_bookings_transactional(BIGINT, TEXT, UUID, JSONB);

CREATE OR REPLACE FUNCTION public.import_vazios_bookings_transactional(
  p_voyage_id BIGINT, p_port TEXT, p_uploaded_by UUID, p_bookings JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_manifest_id UUID;
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
  LEFT JOIN public.depots d ON lower(d.code) = lower(btrim(r.local_code)) AND d.active
  WHERE NULLIF(btrim(r.container_number), '') IS NULL
     OR r.container_number !~ '^[A-Za-z]{4}[0-9]{7}$'
     OR NULLIF(btrim(r.local_code), '') IS NULL
     OR (d.id IS NOT NULL AND d.tipo = 'depot' AND (r.hand_in_date IS NULL OR r.hand_out_date IS NULL))
     OR (d.id IS NOT NULL AND d.tipo = 'depot' AND r.hand_out_date < r.hand_in_date)
     OR (d.id IS NOT NULL AND d.tipo = 'terminal_portuario' AND (r.hand_in_date IS NOT NULL OR r.hand_out_date IS NOT NULL))
     OR r.condition NOT IN ('vazio', 'material')
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Planilha invalida: corrija todas as linhas e importe novamente.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.vazios_manifests (voyage_id, description, total_bookings, imported_by)
  VALUES (p_voyage_id, p_port, v_total, p_uploaded_by) RETURNING id INTO v_manifest_id;

  INSERT INTO public.depots (code, name, tipo, free_time_vazio_days, free_time_material_days)
  SELECT DISTINCT btrim(local_code), btrim(local_code), 'depot', 0, 0
  FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS item(
    container_number TEXT, container_type TEXT, local_code TEXT, condition TEXT,
    hand_in_date DATE, hand_out_date DATE, movement_date DATE
  )
  WHERE NULLIF(btrim(local_code), '') IS NOT NULL
  ON CONFLICT (code) DO NOTHING;

  DELETE FROM public.vazios_bookings WHERE voyage_id = p_voyage_id;
  INSERT INTO public.vazios_bookings (voyage_id, manifest_id, container_number, container_type,
    local_id, condition, hand_in_date, hand_out_date, movement_date)
  SELECT p_voyage_id, v_manifest_id, upper(btrim(r.container_number)), r.container_type, d.id,
    r.condition, r.hand_in_date, r.hand_out_date, r.movement_date
  FROM (
    SELECT DISTINCT ON (upper(btrim(container_number))) *
    FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS item(
      container_number TEXT, container_type TEXT, local_code TEXT, condition TEXT,
      hand_in_date DATE, hand_out_date DATE, movement_date DATE
    ) ORDER BY upper(btrim(container_number))
  ) r JOIN public.depots d ON lower(d.code) = lower(btrim(r.local_code)) AND d.active;

  RETURN jsonb_build_object('manifest_id', v_manifest_id, 'total', v_total, 'replaced', TRUE);
END;
$function$;

REVOKE ALL ON FUNCTION public.import_vazios_bookings_transactional(BIGINT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_vazios_bookings_transactional(BIGINT, TEXT, UUID, JSONB) TO authenticated;
