-- 325: detectores e reconciliação de alertas de operação e viagem (Bloco 4, Issue #523).
-- Intent: implementar a detecção e reconciliação automática dos alertas operacionais de viagem:
--   - voyage_bl_expected: B/L esperado pendente (D-7 ou menor ETA)
--   - voyage_baplie_missing: Baplie ausente (D-7)
--   - voyage_baplie_documentary_coverage: Cobertura Baplie/BL e divergências documentais
--   - voyage_ce_mercante_missing: CE Mercante pendente (D-5)
--   - voyage_schedule_date_pending: Datas da escala compartilhadas pendentes (ATA, ETB, ETD)
--   - voyage_terminal_date_pending: Datas de terminal pendentes (ATB, ATD)
--   - voyage_export_after_atd: Vínculo de exportação pendente após ATD no terminal
-- Consumidores: run_alert_detectors(), triggers operacionais, Alertas UI.
-- Rollback: DROP FUNCTION public.detect_voyage_operation_alerts() e reconcilers associados.

-- 1. Helper: PODs elegíveis da viagem (ativos, não omitidos, não excluídos e com importação ativa)
CREATE OR REPLACE FUNCTION public.get_voyage_eligible_pods(p_voyage_id BIGINT)
RETURNS TABLE(pod TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH latest_states AS (
    SELECT DISTINCT ON (entity_id, field_name)
      entity_id,
      field_name,
      new_value
    FROM public.audit_logs
    WHERE entity_type = 'voyage_pod_schedule'
      AND entity_id LIKE p_voyage_id || '::%'
      AND field_name IN ('deleted', 'omitted', 'tem_importacao', 'eta')
    ORDER BY entity_id, field_name, changed_at DESC
  ),
  aggregated AS (
    SELECT
      upper(btrim(split_part(entity_id, '::', 2))) AS port_code,
      bool_or(field_name = 'deleted' AND new_value = 'true') AS is_deleted,
      bool_or(field_name = 'omitted' AND new_value = 'true') AS is_omitted,
      bool_or(field_name = 'tem_importacao' AND new_value = 'false') AS is_no_import
    FROM latest_states
    GROUP BY upper(btrim(split_part(entity_id, '::', 2)))
  )
  SELECT port_code AS pod
  FROM aggregated
  WHERE NOT COALESCE(is_deleted, false)
    AND NOT COALESCE(is_omitted, false)
    AND NOT COALESCE(is_no_import, false);
$$;

REVOKE ALL ON FUNCTION public.get_voyage_eligible_pods(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_voyage_eligible_pods(BIGINT) TO authenticated, service_role;

-- 2. Helper: Menor ETA brasileiro / indicação de outro 1º porto brasileiro
CREATE OR REPLACE FUNCTION public.get_voyage_first_brazilian_eta(p_voyage_id BIGINT)
RETURNS DATE
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_has_eligible_pod BOOLEAN;
  v_min_own_eta DATE;
  v_indicated_eta DATE;
  v_indicated_port TEXT;
BEGIN
  -- Se não há nenhum POD elegível, importação fica suspensa
  SELECT EXISTS (SELECT 1 FROM public.get_voyage_eligible_pods(p_voyage_id)) INTO v_has_eligible_pod;
  IF NOT v_has_eligible_pod THEN
    RETURN NULL;
  END IF;

  -- Menor ETA das escalas próprias elegíveis
  WITH latest_eta AS (
    SELECT DISTINCT ON (entity_id)
      upper(btrim(split_part(entity_id, '::', 2))) AS port_code,
      NULLIF(btrim(new_value), '')::date AS eta
    FROM public.audit_logs
    WHERE entity_type = 'voyage_pod_schedule'
      AND entity_id LIKE p_voyage_id || '::%'
      AND field_name = 'eta'
    ORDER BY entity_id, changed_at DESC
  )
  SELECT MIN(eta) INTO v_min_own_eta
  FROM latest_eta
  WHERE port_code IN (SELECT pod FROM public.get_voyage_eligible_pods(p_voyage_id));

  -- Indicação de outro 1º porto brasileiro
  SELECT
    (SELECT NULLIF(btrim(new_value), '')::date FROM public.audit_logs WHERE entity_type = 'voyages' AND entity_id = p_voyage_id::text AND field_name = 'indicated_first_brazilian_eta' ORDER BY changed_at DESC LIMIT 1),
    (SELECT NULLIF(btrim(new_value), '') FROM public.audit_logs WHERE entity_type = 'voyages' AND entity_id = p_voyage_id::text AND field_name = 'indicated_first_brazilian_port' ORDER BY changed_at DESC LIMIT 1)
  INTO v_indicated_eta, v_indicated_port;

  IF v_indicated_eta IS NOT NULL AND v_indicated_port IS NOT NULL THEN
    IF v_min_own_eta IS NULL OR v_indicated_eta < v_min_own_eta THEN
      RETURN v_indicated_eta;
    END IF;
  END IF;

  RETURN v_min_own_eta;
END;
$$;

REVOKE ALL ON FUNCTION public.get_voyage_first_brazilian_eta(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_voyage_first_brazilian_eta(BIGINT) TO authenticated, service_role;

-- 3. Reconciliador: voyage_bl_expected
CREATE OR REPLACE FUNCTION public.reconcile_voyage_bl_expected_alerts(
  p_voyage_id BIGINT,
  p_source TEXT DEFAULT 'voyage_operation_detector'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_first_eta DATE;
  v_expected_pol_count INTEGER := 0;
  v_expected_pod_count INTEGER := 0;
  v_missing_pol_count INTEGER := 0;
  v_missing_pod_count INTEGER := 0;
  v_bl_count INTEGER := 0;
  v_covered BOOLEAN := false;
BEGIN
  v_first_eta := public.get_voyage_first_brazilian_eta(p_voyage_id);

  IF v_first_eta IS NULL OR v_today < (v_first_eta - 7) THEN
    PERFORM public.resolve_alert_item('voyage_bl_expected', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  -- Contagem de PODs esperados
  SELECT count(*) INTO v_expected_pod_count
  FROM public.get_voyage_eligible_pods(p_voyage_id);

  -- POLs esperados a partir de audit_logs de pol_schedule
  WITH latest_pol_etd AS (
    SELECT DISTINCT ON (entity_id)
      upper(btrim(split_part(entity_id, '::', 2))) AS pol_code,
      NULLIF(btrim(new_value), '') AS etd
    FROM public.audit_logs
    WHERE entity_type = 'voyage_pol_schedule'
      AND entity_id LIKE p_voyage_id || '::%'
      AND field_name = 'etd'
    ORDER BY entity_id, changed_at DESC
  )
  SELECT count(*) INTO v_expected_pol_count
  FROM latest_pol_etd
  WHERE etd IS NOT NULL;

  -- B/Ls atuais da viagem
  SELECT count(*) INTO v_bl_count
  FROM public.bls
  WHERE voyage_id = p_voyage_id;

  IF v_bl_count > 0 THEN
    IF v_expected_pol_count > 0 THEN
      -- POLs ausentes nos B/Ls
      WITH latest_pol_etd AS (
        SELECT DISTINCT ON (entity_id)
          upper(btrim(split_part(entity_id, '::', 2))) AS pol_code,
          NULLIF(btrim(new_value), '') AS etd
        FROM public.audit_logs
        WHERE entity_type = 'voyage_pol_schedule'
          AND entity_id LIKE p_voyage_id || '::%'
          AND field_name = 'etd'
        ORDER BY entity_id, changed_at DESC
      )
      SELECT count(*) INTO v_missing_pol_count
      FROM latest_pol_etd lp
      WHERE lp.etd IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.bls b
          WHERE b.voyage_id = p_voyage_id AND upper(btrim(b.pol)) = lp.pol_code
        );

      -- PODs ausentes nos B/Ls
      SELECT count(*) INTO v_missing_pod_count
      FROM public.get_voyage_eligible_pods(p_voyage_id) ep
      WHERE NOT EXISTS (
        SELECT 1 FROM public.bls b
        WHERE b.voyage_id = p_voyage_id AND upper(btrim(b.pod)) = ep.pod
      );

      v_covered := (v_missing_pol_count = 0 AND v_missing_pod_count = 0);
    ELSE
      -- Sem POLs planejados, cobriu se houver ao menos 1 B/L para cada POD elegível
      SELECT count(*) INTO v_missing_pod_count
      FROM public.get_voyage_eligible_pods(p_voyage_id) ep
      WHERE NOT EXISTS (
        SELECT 1 FROM public.bls b
        WHERE b.voyage_id = p_voyage_id AND upper(btrim(b.pod)) = ep.pod
      );

      v_covered := (v_missing_pod_count = 0);
    END IF;
  ELSE
    v_covered := false;
  END IF;

  IF v_covered THEN
    PERFORM public.resolve_alert_item('voyage_bl_expected', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
  ELSE
    PERFORM public.upsert_alert_item(
      'voyage_bl_expected',
      'voyage',
      p_voyage_id::text,
      'B/Ls esperados pendentes para a viagem ' || p_voyage_id || ' (D-7 atingido)',
      p_source,
      jsonb_build_object('voyage_id', p_voyage_id, 'first_eta', v_first_eta),
      '/viagens/' || p_voyage_id
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_voyage_bl_expected_alerts(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_bl_expected_alerts(BIGINT, TEXT) TO authenticated, service_role;

-- 4. Reconciliador: voyage_baplie_missing
CREATE OR REPLACE FUNCTION public.reconcile_voyage_baplie_missing_alerts(
  p_voyage_id BIGINT,
  p_source TEXT DEFAULT 'voyage_operation_detector'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_first_eta DATE;
  v_has_baplie BOOLEAN;
BEGIN
  v_first_eta := public.get_voyage_first_brazilian_eta(p_voyage_id);

  IF v_first_eta IS NULL OR v_today < (v_first_eta - 7) THEN
    PERFORM public.resolve_alert_item('voyage_baplie_missing', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.baplie_containers WHERE voyage_id = p_voyage_id
  ) INTO v_has_baplie;

  IF v_has_baplie THEN
    PERFORM public.resolve_alert_item('voyage_baplie_missing', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
  ELSE
    PERFORM public.upsert_alert_item(
      'voyage_baplie_missing',
      'voyage',
      p_voyage_id::text,
      'Baplie ausente para a viagem ' || p_voyage_id || ' (D-7 atingido)',
      p_source,
      jsonb_build_object('voyage_id', p_voyage_id, 'first_eta', v_first_eta),
      '/baplie?voyage=' || p_voyage_id
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_voyage_baplie_missing_alerts(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_baplie_missing_alerts(BIGINT, TEXT) TO authenticated, service_role;

-- 5. Reconciliador: voyage_baplie_documentary_coverage
CREATE OR REPLACE FUNCTION public.reconcile_voyage_baplie_coverage_alerts(
  p_voyage_id BIGINT,
  p_source TEXT DEFAULT 'voyage_operation_detector'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_first_eta DATE;
  v_is_d7 BOOLEAN;
  v_has_baplie BOOLEAN;
  v_edi_route_count INTEGER;
  v_missing_route_count INTEGER;
  v_divergence_count INTEGER := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.baplie_containers WHERE voyage_id = p_voyage_id
  ) INTO v_has_baplie;

  IF NOT v_has_baplie THEN
    PERFORM public.resolve_alert_item('voyage_baplie_documentary_coverage', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  v_first_eta := public.get_voyage_first_brazilian_eta(p_voyage_id);
  v_is_d7 := (v_first_eta IS NOT NULL AND v_today >= (v_first_eta - 7));

  -- Rotas EDI vs Rotas BL
  WITH edi_routes AS (
    SELECT DISTINCT upper(btrim(pol)) AS pol, upper(btrim(pod)) AS pod
    FROM public.baplie_containers
    WHERE voyage_id = p_voyage_id AND pol IS NOT NULL AND pod IS NOT NULL
  ),
  bl_routes AS (
    SELECT DISTINCT upper(btrim(pol)) AS pol, upper(btrim(pod)) AS pod
    FROM public.bls
    WHERE voyage_id = p_voyage_id AND pol IS NOT NULL AND pod IS NOT NULL
  )
  SELECT
    (SELECT count(*) FROM edi_routes),
    (SELECT count(*) FROM (SELECT * FROM edi_routes EXCEPT SELECT * FROM bl_routes) missing)
  INTO v_edi_route_count, v_missing_route_count;

  -- Se não for D-7 e as rotas EDI ainda não foram todas cobertas por B/Ls, não emite divergência (aguardando cobertura)
  IF v_edi_route_count > 0 AND v_missing_route_count > 0 AND NOT v_is_d7 THEN
    PERFORM public.resolve_alert_item('voyage_baplie_documentary_coverage', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  -- Cálculo de divergências de existência de container
  WITH baplie_cntrs AS (
    SELECT DISTINCT regexp_replace(upper(btrim(container_number)), '\s+', '', 'g') AS container_number
    FROM public.baplie_containers
    WHERE voyage_id = p_voyage_id
      AND COALESCE(status, '') <> 'empty'
      AND NULLIF(btrim(container_number), '') IS NOT NULL
  ),
  bl_cntrs AS (
    SELECT DISTINCT regexp_replace(upper(btrim(bc.container_number)), '\s+', '', 'g') AS container_number
    FROM public.bl_containers bc
    JOIN public.bls b ON b.id = bc.bl_id
    WHERE b.voyage_id = p_voyage_id
      AND NULLIF(btrim(bc.container_number), '') IS NOT NULL
  )
  SELECT
    (SELECT count(*) FROM (SELECT container_number FROM baplie_cntrs EXCEPT SELECT container_number FROM bl_cntrs) d1) +
    (SELECT count(*) FROM (SELECT container_number FROM bl_cntrs EXCEPT SELECT container_number FROM baplie_cntrs) d2)
  INTO v_divergence_count;

  IF v_divergence_count > 0 THEN
    PERFORM public.upsert_alert_item(
      'voyage_baplie_documentary_coverage',
      'voyage',
      p_voyage_id::text,
      'Divergência Baplie/BL: ' || v_divergence_count || ' container(s) divergente(s) na viagem ' || p_voyage_id,
      p_source,
      jsonb_build_object('voyage_id', p_voyage_id, 'divergence_count', v_divergence_count),
      '/baplie?voyage=' || p_voyage_id
    );
  ELSE
    PERFORM public.resolve_alert_item('voyage_baplie_documentary_coverage', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_voyage_baplie_coverage_alerts(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_baplie_coverage_alerts(BIGINT, TEXT) TO authenticated, service_role;

-- 6. Reconciliador: voyage_ce_mercante_missing
CREATE OR REPLACE FUNCTION public.reconcile_voyage_ce_mercante_missing_alerts(
  p_voyage_id BIGINT,
  p_source TEXT DEFAULT 'voyage_operation_detector'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_first_eta DATE;
  v_total_bls INTEGER := 0;
  v_missing_ce_count INTEGER := 0;
BEGIN
  v_first_eta := public.get_voyage_first_brazilian_eta(p_voyage_id);

  IF v_first_eta IS NULL OR v_today < (v_first_eta - 5) THEN
    PERFORM public.resolve_alert_item('voyage_ce_mercante_missing', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE ce_mercante IS NULL OR btrim(ce_mercante) = '')
  INTO v_total_bls, v_missing_ce_count
  FROM public.bls
  WHERE voyage_id = p_voyage_id
    AND upper(btrim(pod)) IN (SELECT pod FROM public.get_voyage_eligible_pods(p_voyage_id));

  IF v_total_bls = 0 OR v_missing_ce_count = 0 THEN
    PERFORM public.resolve_alert_item('voyage_ce_mercante_missing', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
  ELSE
    PERFORM public.upsert_alert_item(
      'voyage_ce_mercante_missing',
      'voyage',
      p_voyage_id::text,
      'CE Mercante pendente para ' || v_missing_ce_count || ' B/L(s) da viagem ' || p_voyage_id || ' (D-5 atingido)',
      p_source,
      jsonb_build_object('voyage_id', p_voyage_id, 'missing_ce_count', v_missing_ce_count),
      '/viagens/' || p_voyage_id
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_voyage_ce_mercante_missing_alerts(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_ce_mercante_missing_alerts(BIGINT, TEXT) TO authenticated, service_role;

-- 7. Reconciliador: voyage_schedule_date_pending e voyage_terminal_date_pending
CREATE OR REPLACE FUNCTION public.reconcile_voyage_schedule_date_alerts(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_source TEXT DEFAULT 'voyage_operation_detector'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_port_norm TEXT := upper(btrim(p_port));
  v_scale_entity_id TEXT := p_voyage_id || '::' || v_port_norm;
  v_term_rec RECORD;
  v_term_entity_id TEXT;
  v_is_deleted BOOLEAN := false;
  v_is_omitted BOOLEAN := false;
  v_eta DATE;
  v_ata DATE;
  v_etb DATE;
  v_atb DATE;
  v_etd DATE;
  v_atd DATE;
  v_has_terminal_atb BOOLEAN := false;
BEGIN
  -- Verifica se a escala foi excluída ou omitida
  WITH latest_state AS (
    SELECT DISTINCT ON (field_name)
      field_name,
      new_value
    FROM public.audit_logs
    WHERE entity_type = 'voyage_pod_schedule'
      AND entity_id = v_scale_entity_id
      AND field_name IN ('deleted', 'omitted', 'eta', 'ata', 'etb', 'atb', 'etd', 'atd')
    ORDER BY field_name, changed_at DESC
  )
  SELECT
    COALESCE(bool_or(field_name = 'deleted' AND new_value = 'true'), false),
    COALESCE(bool_or(field_name = 'omitted' AND new_value = 'true'), false),
    MAX(CASE WHEN field_name = 'eta' THEN NULLIF(btrim(new_value), '')::date END),
    MAX(CASE WHEN field_name = 'ata' THEN NULLIF(btrim(new_value), '')::date END),
    MAX(CASE WHEN field_name = 'etb' THEN NULLIF(btrim(new_value), '')::date END),
    MAX(CASE WHEN field_name = 'atb' THEN NULLIF(btrim(new_value), '')::date END),
    MAX(CASE WHEN field_name = 'etd' THEN NULLIF(btrim(new_value), '')::date END),
    MAX(CASE WHEN field_name = 'atd' THEN NULLIF(btrim(new_value), '')::date END)
  INTO v_is_deleted, v_is_omitted, v_eta, v_ata, v_etb, v_atb, v_etd, v_atd
  FROM latest_state;

  IF v_is_deleted OR v_is_omitted THEN
    PERFORM public.resolve_alert_item('voyage_schedule_date_pending', 'voyage_pod_schedule', v_scale_entity_id, p_source, '{}'::jsonb);
    FOR v_term_rec IN
      SELECT terminal_id FROM public.voyage_escala_terminal_state WHERE voyage_id = p_voyage_id AND port = v_port_norm
    LOOP
      v_term_entity_id := p_voyage_id || '::' || v_port_norm || '::' || upper(btrim(v_term_rec.terminal_id::text));
      PERFORM public.resolve_alert_item('voyage_terminal_date_pending', 'voyage_escala_terminal', v_term_entity_id, p_source, '{}'::jsonb);
      PERFORM public.resolve_alert_item('voyage_export_after_atd', 'voyage_escala_terminal', v_term_entity_id, p_source, '{}'::jsonb);
    END LOOP;
    RETURN;
  END IF;

  -- Verifica se há atracação em algum terminal
  SELECT COALESCE(bool_or(terminal_atb IS NOT NULL), false)
  INTO v_has_terminal_atb
  FROM public.voyage_escala_terminal_state
  WHERE voyage_id = p_voyage_id AND port = v_port_norm;

  -- 1. Nível compartilhado da escala: ETA -> ATA -> ETB -> ETD
  IF v_eta IS NOT NULL AND v_eta <= v_today AND v_ata IS NULL THEN
    PERFORM public.upsert_alert_item(
      'voyage_schedule_date_pending',
      'voyage_pod_schedule',
      v_scale_entity_id,
      'ATA pendente para escala ' || v_port_norm || ' (ETA ' || to_char(v_eta, 'DD/MM/YYYY') || ' atingido)',
      p_source,
      jsonb_build_object('voyage_id', p_voyage_id, 'port', v_port_norm, 'milestone', 'ata', 'eta', v_eta),
      '/viagens/' || p_voyage_id || '?escala=' || v_port_norm
    );
  ELSIF v_ata IS NOT NULL AND v_etb IS NULL THEN
    PERFORM public.upsert_alert_item(
      'voyage_schedule_date_pending',
      'voyage_pod_schedule',
      v_scale_entity_id,
      'ETB pendente para escala ' || v_port_norm || ' (ATA informada)',
      p_source,
      jsonb_build_object('voyage_id', p_voyage_id, 'port', v_port_norm, 'milestone', 'etb'),
      '/viagens/' || p_voyage_id || '?escala=' || v_port_norm
    );
  ELSIF (v_has_terminal_atb OR v_atb IS NOT NULL) AND v_etd IS NULL THEN
    PERFORM public.upsert_alert_item(
      'voyage_schedule_date_pending',
      'voyage_pod_schedule',
      v_scale_entity_id,
      'ETD pendente para escala ' || v_port_norm || ' (navio atracado)',
      p_source,
      jsonb_build_object('voyage_id', p_voyage_id, 'port', v_port_norm, 'milestone', 'etd'),
      '/viagens/' || p_voyage_id || '?escala=' || v_port_norm
    );
  ELSE
    PERFORM public.resolve_alert_item('voyage_schedule_date_pending', 'voyage_pod_schedule', v_scale_entity_id, p_source, '{}'::jsonb);
  END IF;

  -- 2. Nível por terminal: ETB -> ATB -> ETD -> ATD
  FOR v_term_rec IN
    SELECT terminal_id, terminal_atb, terminal_atd
    FROM public.voyage_escala_terminal_state
    WHERE voyage_id = p_voyage_id AND port = v_port_norm
  LOOP
    v_term_entity_id := p_voyage_id || '::' || v_port_norm || '::' || upper(btrim(v_term_rec.terminal_id::text));

    IF v_etb IS NOT NULL AND v_etb <= v_today AND v_term_rec.terminal_atb IS NULL THEN
      PERFORM public.upsert_alert_item(
        'voyage_terminal_date_pending',
        'voyage_escala_terminal',
        v_term_entity_id,
        'ATB pendente no terminal para a escala ' || v_port_norm || ' (ETB ' || to_char(v_etb, 'DD/MM/YYYY') || ' atingido)',
        p_source,
        jsonb_build_object('voyage_id', p_voyage_id, 'port', v_port_norm, 'terminal', v_term_rec.terminal_id, 'milestone', 'atb', 'etb', v_etb),
        '/viagens/' || p_voyage_id || '?escala=' || v_port_norm || '&terminal=' || v_term_rec.terminal_id
      );
    ELSIF v_etd IS NOT NULL AND v_etd <= v_today AND v_term_rec.terminal_atb IS NOT NULL AND v_term_rec.terminal_atd IS NULL THEN
      PERFORM public.upsert_alert_item(
        'voyage_terminal_date_pending',
        'voyage_escala_terminal',
        v_term_entity_id,
        'ATD pendente no terminal para a escala ' || v_port_norm || ' (ETD ' || to_char(v_etd, 'DD/MM/YYYY') || ' atingido)',
        p_source,
        jsonb_build_object('voyage_id', p_voyage_id, 'port', v_port_norm, 'terminal', v_term_rec.terminal_id, 'milestone', 'atd', 'etd', v_etd),
        '/viagens/' || p_voyage_id || '?escala=' || v_port_norm || '&terminal=' || v_term_rec.terminal_id
      );
    ELSE
      PERFORM public.resolve_alert_item('voyage_terminal_date_pending', 'voyage_escala_terminal', v_term_entity_id, p_source, '{}'::jsonb);
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_voyage_schedule_date_alerts(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_schedule_date_alerts(BIGINT, TEXT, TEXT) TO authenticated, service_role;

-- 8. Reconciliador: voyage_export_after_atd
CREATE OR REPLACE FUNCTION public.reconcile_voyage_export_after_atd_alerts(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_terminal_id TEXT,
  p_source TEXT DEFAULT 'voyage_operation_detector'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_port_norm TEXT := upper(btrim(p_port));
  v_entity_id TEXT := p_voyage_id || '::' || v_port_norm || '::' || upper(btrim(p_terminal_id));
  v_export_rec RECORD;
  v_terminal_atd TIMESTAMPTZ;
  v_has_granite_link BOOLEAN := true;
  v_has_empty_link BOOLEAN := true;
BEGIN
  -- Declaração de exportação da escala
  SELECT tem_exportacao, has_granite, has_empty
  INTO v_export_rec
  FROM public.voyage_export_schedules
  WHERE voyage_id = p_voyage_id AND upper(btrim(pol)) = v_port_norm;

  IF NOT FOUND OR NOT COALESCE(v_export_rec.tem_exportacao, false) THEN
    PERFORM public.resolve_alert_item('voyage_export_after_atd', 'voyage_escala_terminal', v_entity_id, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  -- ATD do terminal
  SELECT terminal_atd
  INTO v_terminal_atd
  FROM public.voyage_escala_terminal_state
  WHERE voyage_id = p_voyage_id AND port = v_port_norm AND terminal_id::text = p_terminal_id;

  IF v_terminal_atd IS NULL THEN
    PERFORM public.resolve_alert_item('voyage_export_after_atd', 'voyage_escala_terminal', v_entity_id, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  -- Vínculos exigidos
  IF COALESCE(v_export_rec.has_granite, false) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.granite_manifests WHERE voyage_id = p_voyage_id
    ) INTO v_has_granite_link;
  END IF;

  IF COALESCE(v_export_rec.has_empty, false) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.vazios_manifests WHERE voyage_id = p_voyage_id
    ) INTO v_has_empty_link;
  END IF;

  IF (NOT v_has_granite_link) OR (NOT v_has_empty_link) THEN
    PERFORM public.upsert_alert_item(
      'voyage_export_after_atd',
      'voyage_escala_terminal',
      v_entity_id,
      'Exportação pendente de vínculo após saída/ATD no terminal para a escala ' || v_port_norm,
      p_source,
      jsonb_build_object(
        'voyage_id', p_voyage_id,
        'port', v_port_norm,
        'terminal', p_terminal_id,
        'has_granite', v_export_rec.has_granite,
        'has_empty', v_export_rec.has_empty,
        'granite_linked', v_has_granite_link,
        'empty_linked', v_has_empty_link
      ),
      '/viagens/' || p_voyage_id || '?escala=' || v_port_norm || '&terminal=' || p_terminal_id
    );
  ELSE
    PERFORM public.resolve_alert_item('voyage_export_after_atd', 'voyage_escala_terminal', v_entity_id, p_source, '{}'::jsonb);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_voyage_export_after_atd_alerts(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_export_after_atd_alerts(BIGINT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- 9. Reconciliador unificado por viagem
CREATE OR REPLACE FUNCTION public.reconcile_voyage_operation_alerts(
  p_voyage_id BIGINT,
  p_source TEXT DEFAULT 'voyage_operation_detector'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_port_rec RECORD;
  v_term_rec RECORD;
BEGIN
  -- Nível viagem (documentação / BL / Baplie / CE)
  PERFORM public.reconcile_voyage_bl_expected_alerts(p_voyage_id, p_source);
  PERFORM public.reconcile_voyage_baplie_missing_alerts(p_voyage_id, p_source);
  PERFORM public.reconcile_voyage_baplie_coverage_alerts(p_voyage_id, p_source);
  PERFORM public.reconcile_voyage_ce_mercante_missing_alerts(p_voyage_id, p_source);

  -- Nível escala (datas compartilhadas e por terminal)
  FOR v_port_rec IN
    SELECT DISTINCT upper(btrim(split_part(entity_id, '::', 2))) AS port
    FROM public.audit_logs
    WHERE entity_type = 'voyage_pod_schedule' AND entity_id LIKE p_voyage_id || '::%'
    UNION
    SELECT DISTINCT upper(btrim(port)) AS port
    FROM public.voyage_escala_terminal_state
    WHERE voyage_id = p_voyage_id
    UNION
    SELECT DISTINCT upper(btrim(pol)) AS port
    FROM public.voyage_export_schedules
    WHERE voyage_id = p_voyage_id
  LOOP
    IF v_port_rec.port IS NOT NULL AND v_port_rec.port <> '' THEN
      PERFORM public.reconcile_voyage_schedule_date_alerts(p_voyage_id, v_port_rec.port, p_source);

      FOR v_term_rec IN
        SELECT terminal_id
        FROM public.voyage_escala_terminal_state
        WHERE voyage_id = p_voyage_id AND port = v_port_rec.port
      LOOP
        PERFORM public.reconcile_voyage_export_after_atd_alerts(p_voyage_id, v_port_rec.port, v_term_rec.terminal_id::text, p_source);
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_voyage_operation_alerts(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_operation_alerts(BIGINT, TEXT) TO authenticated, service_role;

-- 10. Executor geral dos detectores de viagem e operação
CREATE OR REPLACE FUNCTION public.detect_voyage_operation_alerts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_voyage RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_voyage IN
    SELECT id
    FROM public.voyages
    WHERE status = 'active'
    ORDER BY id
  LOOP
    PERFORM public.reconcile_voyage_operation_alerts(v_voyage.id, 'voyage_operation_detector');
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.detect_voyage_operation_alerts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_voyage_operation_alerts() TO authenticated, service_role;

-- 11. Atualização do executor server-only run_alert_detectors
CREATE OR REPLACE FUNCTION public.run_alert_detectors()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_overdue INTEGER := 0;
  v_adr_pending INTEGER := 0;
  v_adr_deadline INTEGER := 0;
  v_voyage_ops INTEGER := 0;
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
  v_voyage_ops := public.detect_voyage_operation_alerts();

  RETURN jsonb_build_object(
    'overdue_invoices', v_overdue,
    'agency_report_pending', v_adr_pending,
    'agency_report_deadline_missed', v_adr_deadline,
    'voyage_operation_alerts', v_voyage_ops
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_alert_detectors() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_alert_detectors() TO service_role;
