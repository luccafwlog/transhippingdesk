-- 324: sincronização do ciclo de vida dos alertas de revisão de B/L e Granito (Bloco 1 #520).
--
-- Conecta os B/Ls comuns (public.bls) e B/Ls de Granito (public.granite_bls) à
-- fundação transversal de Alertas e Notificações Internas (migrations 317–321).
--
-- Rollback: remover os triggers e funções desta migration; os itens/ocorrências
-- gerados são preservados para auditoria.

CREATE OR REPLACE FUNCTION public.reconcile_bl_review_alerts(p_bl_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_reasons TEXT[];
BEGIN
  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND THEN
    PERFORM public.resolve_alert_item('review_customer_unlinked', 'bl', p_bl_id, 'bl_deleted', '{}'::jsonb);
    PERFORM public.resolve_alert_item('review_customer_email_missing', 'bl', p_bl_id, 'bl_deleted', '{}'::jsonb);
    PERFORM public.resolve_alert_item('review_breakbulk_weight_missing', 'bl', p_bl_id, 'bl_deleted', '{}'::jsonb);
    RETURN;
  END IF;

  IF v_bl.review_status = 'pending_review' THEN
    v_reasons := public.compute_bl_review_pendencies(v_bl.customer_id, v_bl.cargo_mode, v_bl.bb_weight_ton);

    IF 'Cliente nao vinculado' = ANY(v_reasons) THEN
      PERFORM public.upsert_alert_item(
        'review_customer_unlinked', 'bl', v_bl.id,
        'Cliente não vinculado ao B/L ' || v_bl.id,
        'bl_review_gate',
        jsonb_build_object('bl_id', v_bl.id, 'cargo_mode', v_bl.cargo_mode),
        '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_customer_unlinked', 'bl', v_bl.id, 'bl_review_gate', '{}'::jsonb);
    END IF;

    IF 'Cliente sem e-mail cadastrado' = ANY(v_reasons) THEN
      PERFORM public.upsert_alert_item(
        'review_customer_email_missing', 'bl', v_bl.id,
        'Cliente sem e-mail cadastrado para B/L ' || v_bl.id,
        'bl_review_gate',
        jsonb_build_object('bl_id', v_bl.id, 'customer_id', v_bl.customer_id),
        '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_customer_email_missing', 'bl', v_bl.id, 'bl_review_gate', '{}'::jsonb);
    END IF;

    IF 'Peso BB ausente' = ANY(v_reasons) THEN
      PERFORM public.upsert_alert_item(
        'review_breakbulk_weight_missing', 'bl', v_bl.id,
        'Peso BB ausente no B/L ' || v_bl.id,
        'bl_review_gate',
        jsonb_build_object('bl_id', v_bl.id, 'cargo_mode', v_bl.cargo_mode),
        '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_breakbulk_weight_missing', 'bl', v_bl.id, 'bl_review_gate', '{}'::jsonb);
    END IF;
  ELSE
    PERFORM public.resolve_alert_item('review_customer_unlinked', 'bl', v_bl.id, 'bl_review_resolved', '{}'::jsonb);
    PERFORM public.resolve_alert_item('review_customer_email_missing', 'bl', v_bl.id, 'bl_review_resolved', '{}'::jsonb);
    PERFORM public.resolve_alert_item('review_breakbulk_weight_missing', 'bl', v_bl.id, 'bl_review_resolved', '{}'::jsonb);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_bl_review_alerts(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_bl_review_alerts(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_granite_bl_review_alerts(p_granite_bl_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_gbl public.granite_bls%ROWTYPE;
BEGIN
  SELECT * INTO v_gbl FROM public.granite_bls WHERE id = p_granite_bl_id;
  IF NOT FOUND THEN
    PERFORM public.resolve_alert_item('review_granite_customer_unlinked', 'granite_bl', p_granite_bl_id::TEXT, 'granite_bl_deleted', '{}'::jsonb);
    RETURN;
  END IF;

  IF v_gbl.client_id IS NULL THEN
    PERFORM public.upsert_alert_item(
      'review_granite_customer_unlinked', 'granite_bl', v_gbl.id::TEXT,
      'Cliente não vinculado ao Granito B/L ' || COALESCE(v_gbl.bl_number, v_gbl.id::TEXT),
      'granite_review_gate',
      jsonb_build_object('granite_bl_id', v_gbl.id, 'bl_number', v_gbl.bl_number),
      '/revisao'
    );
  ELSE
    PERFORM public.resolve_alert_item('review_granite_customer_unlinked', 'granite_bl', v_gbl.id::TEXT, 'granite_review_resolved', '{}'::jsonb);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_granite_bl_review_alerts(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_granite_bl_review_alerts(BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_reconcile_bl_review_alerts()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    PERFORM public.reconcile_bl_review_alerts(OLD.id);
    PERFORM set_config('alerts.foundation_trigger', 'off', true);
    RETURN OLD;
  ELSE
    IF TG_OP = 'INSERT'
       OR OLD.review_status IS DISTINCT FROM NEW.review_status
       OR OLD.customer_id IS DISTINCT FROM NEW.customer_id
       OR OLD.cargo_mode IS DISTINCT FROM NEW.cargo_mode
       OR OLD.bb_weight_ton IS DISTINCT FROM NEW.bb_weight_ton THEN
      PERFORM set_config('alerts.foundation_trigger', 'on', true);
      PERFORM public.reconcile_bl_review_alerts(NEW.id);
      PERFORM set_config('alerts.foundation_trigger', 'off', true);
    END IF;
    RETURN NEW;
  END IF;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reconcile_bl_review_alerts ON public.bls;
CREATE TRIGGER trg_reconcile_bl_review_alerts
  AFTER INSERT OR UPDATE OF review_status, customer_id, cargo_mode, bb_weight_ton OR DELETE ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.trg_reconcile_bl_review_alerts();

CREATE OR REPLACE FUNCTION public.trg_reconcile_granite_bl_review_alerts()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    PERFORM public.reconcile_granite_bl_review_alerts(OLD.id);
    PERFORM set_config('alerts.foundation_trigger', 'off', true);
    RETURN OLD;
  ELSE
    IF TG_OP = 'INSERT' OR OLD.client_id IS DISTINCT FROM NEW.client_id THEN
      PERFORM set_config('alerts.foundation_trigger', 'on', true);
      PERFORM public.reconcile_granite_bl_review_alerts(NEW.id);
      PERFORM set_config('alerts.foundation_trigger', 'off', true);
    END IF;
    RETURN NEW;
  END IF;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reconcile_granite_bl_review_alerts ON public.granite_bls;
CREATE TRIGGER trg_reconcile_granite_bl_review_alerts
  AFTER INSERT OR UPDATE OF client_id OR DELETE ON public.granite_bls
  FOR EACH ROW EXECUTE FUNCTION public.trg_reconcile_granite_bl_review_alerts();

CREATE OR REPLACE FUNCTION public.detect_bl_review_pendencies()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bl RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_bl IN
    SELECT id FROM public.bls WHERE review_status = 'pending_review'
  LOOP
    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    PERFORM public.reconcile_bl_review_alerts(v_bl.id);
    PERFORM set_config('alerts.foundation_trigger', 'off', true);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.detect_bl_review_pendencies() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_bl_review_pendencies() TO service_role;

CREATE OR REPLACE FUNCTION public.detect_granite_bl_review_pendencies()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_gbl RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_gbl IN
    SELECT id FROM public.granite_bls WHERE client_id IS NULL
  LOOP
    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    PERFORM public.reconcile_granite_bl_review_alerts(v_gbl.id);
    PERFORM set_config('alerts.foundation_trigger', 'off', true);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.detect_granite_bl_review_pendencies() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_granite_bl_review_pendencies() TO service_role;

-- Atualiza o executor do cron periódico (319) para rodar também os detectores de revisão
CREATE OR REPLACE FUNCTION public.run_alert_detectors()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor UUID;
  v_overdue INTEGER := 0;
  v_adr_pending INTEGER := 0;
  v_adr_deadline INTEGER := 0;
  v_bl_review INTEGER := 0;
  v_granite_review INTEGER := 0;
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

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('alerts.detector_runner', 'on', true);

  v_overdue := public.detect_overdue_invoices();
  v_adr_pending := public.detect_agency_report_pending();
  v_adr_deadline := public.detect_agency_report_deadline_missed();
  v_bl_review := public.detect_bl_review_pendencies();
  v_granite_review := public.detect_granite_bl_review_pendencies();

  RETURN jsonb_build_object(
    'overdue_invoices', v_overdue,
    'agency_report_pending', v_adr_pending,
    'agency_report_deadline_missed', v_adr_deadline,
    'bl_review_pendencies', v_bl_review,
    'granite_bl_review_pendencies', v_granite_review
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.run_alert_detectors() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_alert_detectors() TO service_role;

-- Backfill de compatibilidade na migração
DO $$
DECLARE
  v_id TEXT;
  v_gid BIGINT;
BEGIN
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR v_id IN SELECT id FROM public.bls WHERE review_status = 'pending_review' LOOP
    PERFORM public.reconcile_bl_review_alerts(v_id);
  END LOOP;
  FOR v_gid IN SELECT id FROM public.granite_bls WHERE client_id IS NULL LOOP
    PERFORM public.reconcile_granite_bl_review_alerts(v_gid);
  END LOOP;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
END;
$$;
