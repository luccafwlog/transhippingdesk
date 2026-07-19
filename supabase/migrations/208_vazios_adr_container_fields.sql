-- Vazios/ADR: campos por container exigidos pelo Agency Departure Report.
-- Intent: o ADR (spec 2026-07-19) deriva embarque de vazios, depot, overtime,
--   material, bundles, hand-in/hand-out e storage de dados por container que
--   hoje nao existem. Vazios descarregados ganham natureza (cama/cover plate)
--   e containers com veiculo ganham local de desova.
-- Escopo: aditivo — colunas novas anulaveis; RPC de import reescrita para
--   aceitar os campos novos (assinatura inalterada: p_bookings JSONB).
-- Rollback: DROP COLUMN das colunas adicionadas e reaplicar a definicao da
--   funcao de 146_import_vazios_transactional.sql.

ALTER TABLE public.vazios_bookings
  ADD COLUMN IF NOT EXISTS embark_port TEXT,
  ADD COLUMN IF NOT EXISTS depot TEXT,
  ADD COLUMN IF NOT EXISTS material BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS bundle BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS transporte BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hand_in_date DATE,
  ADD COLUMN IF NOT EXISTS hand_out_date DATE,
  ADD COLUMN IF NOT EXISTS overtime_handling BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS overtime_transport BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_vazios_bookings_embark_port
  ON public.vazios_bookings(embark_port);

ALTER TABLE public.vazios_importacao_containers
  ADD COLUMN IF NOT EXISTS natureza TEXT
    CHECK (natureza IS NULL OR natureza IN ('cama', 'cover_plate'));

ALTER TABLE public.bl_containers
  ADD COLUMN IF NOT EXISTS unpacking_location TEXT;

CREATE OR REPLACE FUNCTION public.import_vazios_bookings_transactional(
  p_voyage_id BIGINT,
  p_description TEXT,
  p_uploaded_by UUID,
  p_bookings JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_manifest_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar bookings.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.vazios_manifests (voyage_id, description, total_bookings, imported_by)
  VALUES (p_voyage_id, p_description, jsonb_array_length(COALESCE(p_bookings, '[]'::JSONB)), p_uploaded_by)
  RETURNING id INTO v_manifest_id;

  INSERT INTO public.vazios_bookings (
    manifest_id, booking_number, container_number, container_type,
    movement_date, origin_terminal, destination, notes,
    embark_port, depot, material, bundle, transporte,
    hand_in_date, hand_out_date, overtime_handling, overtime_transport
  )
  SELECT
    v_manifest_id, item.booking_number, item.container_number, item.container_type,
    item.movement_date, item.origin_terminal, item.destination, item.notes,
    item.embark_port, item.depot, COALESCE(item.material, FALSE),
    COALESCE(item.bundle, FALSE), COALESCE(item.transporte, FALSE),
    item.hand_in_date, item.hand_out_date,
    COALESCE(item.overtime_handling, FALSE), COALESCE(item.overtime_transport, FALSE)
  FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS item(
    booking_number TEXT,
    container_number TEXT,
    container_type TEXT,
    movement_date DATE,
    origin_terminal TEXT,
    destination TEXT,
    notes TEXT,
    embark_port TEXT,
    depot TEXT,
    material BOOLEAN,
    bundle BOOLEAN,
    transporte BOOLEAN,
    hand_in_date DATE,
    hand_out_date DATE,
    overtime_handling BOOLEAN,
    overtime_transport BOOLEAN
  );

  RETURN jsonb_build_object('manifest_id', v_manifest_id);
END;
$function$;
