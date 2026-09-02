-- Migration 030: Bloquear mark_bl_ready_for_billing se não existe tabela de cobrança
-- vigente para o POD do B/L. Todo POD deve ter tabela configurada.

CREATE OR REPLACE FUNCTION public.mark_bl_ready_for_billing(
  p_bl_id TEXT,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bl            RECORD;
  v_pending_count INTEGER := 0;
  v_table_count   INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  SELECT id, charge_status, pod, cargo_mode
  INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- Validar linhas pendentes de revisão
  SELECT COUNT(*)
  INTO v_pending_count
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id
    AND status = 'review_required';

  IF v_pending_count > 0 THEN
    RAISE EXCEPTION 'Ainda existem linhas com pendencia de revisao' USING ERRCODE = '22023';
  END IF;

  -- Validar existência de tabela de cobrança vigente para o POD
  SELECT COUNT(*)
  INTO v_table_count
  FROM public.charge_tables
  WHERE pod ILIKE v_bl.pod
    AND cargo_mode = v_bl.cargo_mode
    AND active = true
    AND valid_from <= CURRENT_DATE
    AND (valid_to IS NULL OR valid_to >= CURRENT_DATE);

  IF v_table_count = 0 THEN
    RAISE EXCEPTION
      'Nenhuma tabela de cobrança vigente para POD "%" (modo: %). Configure em /taxas-locais antes de prosseguir.',
      v_bl.pod, v_bl.cargo_mode
      USING ERRCODE = 'P0004';
  END IF;

  UPDATE public.charge_calculations
  SET status = 'ready_for_billing'
  WHERE bl_id = p_bl_id
    AND status IN ('calculated', 'reviewed');

  UPDATE public.bls
  SET charge_status = 'ready_for_billing'
  WHERE id = p_bl_id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name,
    old_value, new_value, changed_by, changed_at, justification
  ) VALUES (
    'bl', p_bl_id, 'charge_status',
    COALESCE(v_bl.charge_status, 'null'),
    'ready_for_billing',
    auth.uid(), NOW(),
    'Marcado como pronto para faturar no modulo de Taxas Locais'
  );

  RETURN jsonb_build_object('bl_id', p_bl_id, 'status', 'ready_for_billing', 'changed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_bl_ready_for_billing(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_bl_ready_for_billing(TEXT, UUID) TO authenticated;
