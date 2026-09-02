-- Fix: avoid NULLing voyage schedule snapshots when audit_logs.new_value is NULL
-- Root cause: jsonb_set(target, path, to_jsonb(NULL), true) yields SQL NULL,
-- which violates NOT NULL on voyages.pod_schedule_snapshot/pol_schedule_snapshot.

CREATE OR REPLACE FUNCTION public.trg_voyage_schedule_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_voyage_id  TEXT;
  v_sub_key    TEXT;
  v_parts      TEXT[];
BEGIN
  v_parts     := string_to_array(NEW.entity_id, '::');
  v_voyage_id := v_parts[1];
  v_sub_key   := COALESCE(v_parts[2], '');

  IF v_voyage_id IS NULL OR v_voyage_id = '' THEN
    RETURN NEW;
  END IF;

  IF NEW.entity_type = 'voyage_pod_schedule' THEN
    UPDATE public.voyages
    SET pod_schedule_snapshot = jsonb_set(
      COALESCE(pod_schedule_snapshot, '{}'::jsonb),
      ARRAY[v_sub_key, NEW.field_name],
      COALESCE(to_jsonb(NEW.new_value), 'null'::jsonb),
      true
    )
    WHERE id::TEXT = v_voyage_id;

  ELSIF NEW.entity_type = 'voyage_pol_schedule' THEN
    UPDATE public.voyages
    SET pol_schedule_snapshot = jsonb_set(
      COALESCE(pol_schedule_snapshot, '{}'::jsonb),
      ARRAY[v_sub_key, NEW.field_name],
      COALESCE(to_jsonb(NEW.new_value), 'null'::jsonb),
      true
    )
    WHERE id::TEXT = v_voyage_id;
  END IF;

  RETURN NEW;
END;
$$;
