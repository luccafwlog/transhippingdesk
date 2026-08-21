-- 332: Consolidação transversal de run_alert_detectors()
--
-- Unifica todos os detectores dos blocos 520 a 524 em um único orquestrador server-only.

CREATE OR REPLACE FUNCTION public.run_alert_detectors()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor UUID;
  v_overdue INTEGER := 0;
  v_adr_pending INTEGER := 0;
  v_adr_deadline INTEGER := 0;
  v_bl_review INTEGER := 0;
  v_granite_review INTEGER := 0;
  v_voyage_ops INTEGER := 0;
  v_portal JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_actor
  FROM public.user_profiles
  WHERE active = true AND role <> 'equipamentos'
  ORDER BY CASE WHEN role IN ('admin', 'administrativo') THEN 0 ELSE 1 END, created_at, id
  LIMIT 1;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Não há usuário interno ativo para executar os detectores.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor::TEXT, true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('alerts.detector_runner', 'on', true);

  -- 1. Faturas Vencidas (Bloco 3)
  v_overdue := public.detect_overdue_invoices();

  -- 2. ADR - Relatório de Saída da Agência (Bloco 5)
  v_adr_pending := public.detect_agency_report_pending();
  v_adr_deadline := public.detect_agency_report_deadline_missed();

  -- 3. Revisão Manual de B/L e Granito (Bloco 1)
  v_bl_review := public.detect_bl_review_pendencies();
  v_granite_review := public.detect_granite_bl_review_pendencies();

  -- 4. Operação e Viagens (Bloco 4)
  v_voyage_ops := public.detect_voyage_operation_alerts();

  -- 5. Portal do Cliente e Disputas (Bloco 2)
  v_portal := public.reconcile_client_portal_alerts();

  RETURN jsonb_build_object(
    'overdue_invoices', v_overdue,
    'agency_report_pending', v_adr_pending,
    'agency_report_deadline_missed', v_adr_deadline,
    'bl_review_pendencies', v_bl_review,
    'granite_bl_review_pendencies', v_granite_review,
    'voyage_operation_alerts', v_voyage_ops,
    'client_portal', v_portal
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.run_alert_detectors() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_alert_detectors() TO service_role;
