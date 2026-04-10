CREATE TABLE IF NOT EXISTS public.vehicles (
  id BIGSERIAL PRIMARY KEY,
  voyage_id BIGINT NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  container_id BIGINT NOT NULL REFERENCES public.bl_containers(id) ON DELETE RESTRICT,
  bl_id TEXT NOT NULL REFERENCES public.bls(id) ON DELETE RESTRICT,
  chassis TEXT NOT NULL,
  brand TEXT NOT NULL,
  weight_kg NUMERIC(12,3) NOT NULL,
  cbm NUMERIC(10,3) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_vehicle_relationships()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  container_bl_id TEXT;
  bl_voyage_id BIGINT;
BEGIN
  NEW.chassis := upper(trim(NEW.chassis));
  NEW.brand := trim(NEW.brand);

  IF NEW.chassis = '' THEN
    RAISE EXCEPTION 'Chassi obrigatorio';
  END IF;

  IF NEW.brand = '' THEN
    RAISE EXCEPTION 'Marca obrigatoria';
  END IF;

  SELECT bl_id
    INTO container_bl_id
  FROM public.bl_containers
  WHERE id = NEW.container_id;

  IF container_bl_id IS NULL THEN
    RAISE EXCEPTION 'Container nao encontrado';
  END IF;

  IF container_bl_id <> NEW.bl_id THEN
    RAISE EXCEPTION 'BL nao pertence ao container informado';
  END IF;

  SELECT voyage_id
    INTO bl_voyage_id
  FROM public.bls
  WHERE id = NEW.bl_id;

  IF bl_voyage_id IS NULL THEN
    RAISE EXCEPTION 'BL nao encontrado';
  END IF;

  IF bl_voyage_id <> NEW.voyage_id THEN
    RAISE EXCEPTION 'BL nao pertence a viagem informada';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_vehicle_relationships ON public.vehicles;
CREATE TRIGGER validate_vehicle_relationships
BEFORE INSERT OR UPDATE ON public.vehicles
FOR EACH ROW
EXECUTE FUNCTION public.validate_vehicle_relationships();

CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_voyage_chassis_unique
  ON public.vehicles(voyage_id, chassis);

CREATE INDEX IF NOT EXISTS idx_vehicles_voyage_id
  ON public.vehicles(voyage_id);

CREATE INDEX IF NOT EXISTS idx_vehicles_bl_id
  ON public.vehicles(bl_id);

CREATE INDEX IF NOT EXISTS idx_vehicles_container_id
  ON public.vehicles(container_id);

CREATE INDEX IF NOT EXISTS idx_vehicles_chassis
  ON public.vehicles(chassis);

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicles_select_authenticated ON public.vehicles;
DROP POLICY IF EXISTS vehicles_insert_authenticated ON public.vehicles;
DROP POLICY IF EXISTS vehicles_update_authenticated ON public.vehicles;
DROP POLICY IF EXISTS vehicles_delete_authenticated ON public.vehicles;

CREATE POLICY vehicles_select_authenticated
ON public.vehicles
FOR SELECT
TO authenticated
USING (auth.role() = 'authenticated');

CREATE POLICY vehicles_insert_authenticated
ON public.vehicles
FOR INSERT
TO authenticated
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY vehicles_update_authenticated
ON public.vehicles
FOR UPDATE
TO authenticated
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY vehicles_delete_authenticated
ON public.vehicles
FOR DELETE
TO authenticated
USING (auth.role() = 'authenticated');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.vehicles_id_seq TO authenticated;
