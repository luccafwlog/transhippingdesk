-- Keep container date changes and their audit trail in the same transaction.
CREATE OR REPLACE FUNCTION public.update_container_demurrage_dates(
  p_container_id BIGINT,
  p_discharge_date DATE,
  p_return_date DATE,
  p_demurrage_status TEXT,
  p_justification TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before public.bl_containers%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario inativo ou nao autenticado.' USING ERRCODE = '42501';
  END IF;

  IF p_demurrage_status NOT IN ('within_free_time', 'overdue', 'returned') THEN
    RAISE EXCEPTION 'Status de demurrage invalido.' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_before
  FROM public.bl_containers
  WHERE id = p_container_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % nao encontrado.', p_container_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.bl_containers
  SET
    discharge_date = p_discharge_date,
    return_date = p_return_date,
    demurrage_status = p_demurrage_status
  WHERE id = p_container_id;

  INSERT INTO public.audit_logs (
      entity_type,
      entity_id,
      field_name,
      old_value,
      new_value,
      changed_by,
      changed_at,
      justification
  )
  SELECT
    'bl_container',
    p_container_id::TEXT,
    change.field_name,
    change.old_value,
    change.new_value,
    auth.uid(),
    now(),
    NULLIF(TRIM(COALESCE(p_justification, '')), '')
  FROM (
    VALUES
      ('discharge_date', v_before.discharge_date::TEXT, p_discharge_date::TEXT),
      ('return_date', v_before.return_date::TEXT, p_return_date::TEXT),
      ('demurrage_status', v_before.demurrage_status, p_demurrage_status)
  ) AS change(field_name, old_value, new_value)
  WHERE change.old_value IS DISTINCT FROM change.new_value;
END;
$$;

REVOKE ALL ON FUNCTION public.update_container_demurrage_dates(BIGINT, DATE, DATE, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_container_demurrage_dates(BIGINT, DATE, DATE, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_container_demurrage_dates(BIGINT, DATE, DATE, TEXT, TEXT) TO authenticated;

-- Correct only dates derived from the voyage ATA. Manually imported/edited dates
-- remain untouched when ATA changes.
CREATE OR REPLACE FUNCTION public.propagate_voyage_ata_to_containers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  WITH candidates AS (
    SELECT c.id, c.discharge_date AS old_discharge
    FROM public.bl_containers AS c
    JOIN public.bls AS b ON b.id = c.bl_id
    WHERE b.voyage_id = NEW.id
      AND (c.discharge_date IS NULL OR c.discharge_date = OLD.ata::date)
    FOR UPDATE OF c
  ),
  updated AS (
    UPDATE public.bl_containers AS c
    SET discharge_date = NEW.ata::date
    FROM candidates AS candidate
    WHERE c.id = candidate.id
      AND candidate.old_discharge IS DISTINCT FROM NEW.ata::date
    RETURNING c.id, candidate.old_discharge
  )
  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    changed_at,
    justification
  )
  SELECT
    'bl_container',
    updated.id::TEXT,
    'discharge_date',
    updated.old_discharge::TEXT,
    NEW.ata::date::TEXT,
    auth.uid(),
    now(),
    'Data de descarga sincronizada apos correcao da ATA da viagem.'
  FROM updated;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_voyage_ata_to_containers ON public.voyages;
CREATE TRIGGER trg_propagate_voyage_ata_to_containers
AFTER UPDATE OF ata ON public.voyages
FOR EACH ROW
WHEN (OLD.ata IS DISTINCT FROM NEW.ata)
EXECUTE FUNCTION public.propagate_voyage_ata_to_containers();

REVOKE ALL ON FUNCTION public.propagate_voyage_ata_to_containers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.propagate_voyage_ata_to_containers() FROM anon;
REVOKE ALL ON FUNCTION public.propagate_voyage_ata_to_containers() FROM authenticated;
