ALTER TABLE public.vehicles
ADD COLUMN IF NOT EXISTS model TEXT;

UPDATE public.vehicles
SET model = COALESCE(NULLIF(trim(model), ''), 'NAO INFORMADO')
WHERE model IS NULL OR trim(model) = '';

ALTER TABLE public.vehicles
ALTER COLUMN model SET NOT NULL;

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
  NEW.model := trim(NEW.model);

  IF NEW.chassis = '' THEN
    RAISE EXCEPTION 'Chassi obrigatorio';
  END IF;

  IF NEW.brand = '' THEN
    RAISE EXCEPTION 'Marca obrigatoria';
  END IF;

  IF NEW.model = '' THEN
    RAISE EXCEPTION 'Modelo obrigatorio';
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
