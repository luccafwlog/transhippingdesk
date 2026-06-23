-- Keep vessel schedule archive and manual ordering changes atomic.
-- SECURITY INVOKER preserves the existing table RLS policies.

CREATE OR REPLACE FUNCTION public.archive_vessel_schedule(
  p_vessel_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_vessel public.vessel_schedules%ROWTYPE;
  v_ended_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para encerrar navio.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_vessel
  FROM public.vessel_schedules
  WHERE id = p_vessel_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Navio ativo nao encontrado.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.ended_vessels (
    original_id,
    vessel_name,
    voyage,
    imo_number,
    qingdao_etd,
    shanghai_etd,
    taicang_etd,
    ningbo_etd,
    nansha_etd,
    salvador_eta,
    vitoria_eta,
    pecem_eta
  )
  VALUES (
    v_vessel.id,
    v_vessel.vessel_name,
    v_vessel.voyage,
    v_vessel.imo_number,
    v_vessel.qingdao_etd,
    v_vessel.shanghai_etd,
    v_vessel.taicang_etd,
    v_vessel.ningbo_etd,
    v_vessel.nansha_etd,
    v_vessel.salvador_eta,
    v_vessel.vitoria_eta,
    v_vessel.pecem_eta
  )
  RETURNING id INTO v_ended_id;

  DELETE FROM public.vessel_schedules
  WHERE id = p_vessel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Navio ativo mudou durante o encerramento.'
      USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object('archived_id', v_ended_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_vessel_schedules(
  p_order JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_requested_count INTEGER;
  v_locked_count INTEGER;
  v_updated_count INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas para reordenar navios.'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_order) <> 'array' OR jsonb_array_length(p_order) = 0 THEN
    RAISE EXCEPTION 'Ordem de navios invalida.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT item.id), COUNT(DISTINCT item.display_order)
  INTO v_requested_count, v_locked_count, v_updated_count
  FROM jsonb_to_recordset(p_order) AS item(id UUID, display_order INTEGER);

  IF v_requested_count <> v_locked_count
     OR v_requested_count <> v_updated_count THEN
    RAISE EXCEPTION 'A ordem contem navios ou posicoes duplicadas.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM vessel.id
  FROM public.vessel_schedules AS vessel
  JOIN jsonb_to_recordset(p_order) AS item(id UUID, display_order INTEGER)
    ON item.id = vessel.id
  FOR UPDATE OF vessel;

  GET DIAGNOSTICS v_locked_count = ROW_COUNT;
  IF v_locked_count <> v_requested_count THEN
    RAISE EXCEPTION 'A lista de navios mudou; recarregue antes de reordenar.'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.vessel_schedules AS vessel
  SET display_order = item.display_order
  FROM jsonb_to_recordset(p_order) AS item(id UUID, display_order INTEGER)
  WHERE vessel.id = item.id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> v_requested_count THEN
    RAISE EXCEPTION 'Nem todos os navios foram reordenados.'
      USING ERRCODE = '40001';
  END IF;

  RETURN v_updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_vessel_schedule(UUID)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_vessel_schedule(UUID)
TO authenticated;

REVOKE ALL ON FUNCTION public.reorder_vessel_schedules(JSONB)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_vessel_schedules(JSONB)
TO authenticated;
