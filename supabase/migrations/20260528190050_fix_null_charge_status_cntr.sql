-- Ensure CNTR BLs never stay with NULL charge_status after import/billing orchestration.
-- Backfill existing rows and add trigger guard for future writes.

UPDATE public.bls AS b
SET charge_status = 'not_calculated'
WHERE b.cargo_mode = 'container'
  AND b.charge_status IS NULL;

CREATE OR REPLACE FUNCTION public.ensure_container_bl_charge_status_default()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(NEW.cargo_mode, 'container') = 'container' AND NEW.charge_status IS NULL THEN
    NEW.charge_status := 'not_calculated';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_container_bl_charge_status_default ON public.bls;
CREATE TRIGGER trg_ensure_container_bl_charge_status_default
BEFORE INSERT OR UPDATE OF cargo_mode, charge_status
ON public.bls
FOR EACH ROW
EXECUTE FUNCTION public.ensure_container_bl_charge_status_default();
