-- 374: alertas de Comunicados pendentes e falha de contato alternativo.
--
-- O produtor roda no mesmo runner server-only dos demais detectores. Escala
-- continua sendo o grão de NOA/NOR; Atracação continua sendo o grão de NOB.
-- Ensaios (`simulado`) não encerram pendência: somente comunicado `enviado`
-- representa uma comunicação efetivamente entregue ao provider.

INSERT INTO public.alert_type_catalog (
  type, severity, responsible_department, audience_departments, default_destination
)
VALUES
  ('comunicado_noa_pendente', 'normal', 'documentacao', ARRAY['documentacao'], '/clientes/comunicacao'),
  ('comunicado_nor_pendente', 'normal', 'documentacao', ARRAY['documentacao'], '/clientes/comunicacao'),
  ('comunicado_nob_pendente', 'normal', 'documentacao', ARRAY['documentacao'], '/clientes/comunicacao'),
  ('cliente_contato_bounced_sem_alternativa', 'critical', 'documentacao', ARRAY['documentacao', 'administrativo'], '/clientes')
ON CONFLICT (type) DO UPDATE SET
  severity = EXCLUDED.severity,
  responsible_department = EXCLUDED.responsible_department,
  audience_departments = EXCLUDED.audience_departments,
  default_destination = EXCLUDED.default_destination,
  active = true;

-- audit_logs armazena os valores de data como texto porque também preserva
-- valores legados. Um valor inválido não pode derrubar o ciclo inteiro de
-- alertas; ele equivale a uma data ausente para este detector.
CREATE OR REPLACE FUNCTION public.customer_communication_safe_timestamptz(p_value TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NULLIF(btrim(p_value), '') IS NULL
     OR btrim(p_value) !~ '^\d{4}-\d{2}-\d{2}' THEN
    RETURN NULL;
  END IF;
  RETURN btrim(p_value)::TIMESTAMPTZ;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.customer_communication_safe_timestamptz(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_communication_safe_timestamptz(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.detect_customer_communication_alerts()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_source TEXT := 'customer_communication_detector';
  v_scale RECORD;
  v_terminal RECORD;
  v_customer RECORD;
  v_stale RECORD;
  v_scale_entity_id TEXT;
  v_terminal_entity_id TEXT;
  v_is_deleted BOOLEAN;
  v_is_omitted BOOLEAN;
  v_eta TIMESTAMPTZ;
  v_ata TIMESTAMPTZ;
  v_has_bounced_contact BOOLEAN;
  v_valid_contacts INTEGER;
  v_scales_evaluated INTEGER := 0;
  v_terminals_evaluated INTEGER := 0;
  v_noa_pending INTEGER := 0;
  v_nor_pending INTEGER := 0;
  v_nob_pending INTEGER := 0;
  v_bounce_pending INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  -- A escala é identificada pelo mesmo par usado por
  -- customer_communications.anchor_voyage_id/anchor_port. O filtro evita
  -- casts sobre entity_ids históricos fora do formato esperado.
  FOR v_scale IN
    SELECT DISTINCT
      split_part(entity_id, '::', 1)::BIGINT AS voyage_id,
      upper(btrim(split_part(entity_id, '::', 2))) AS port
    FROM public.audit_logs
    WHERE entity_type = 'voyage_pod_schedule'
      AND entity_id ~ '^[0-9]+::[^:]+$'
  LOOP
    v_scales_evaluated := v_scales_evaluated + 1;
    v_scale_entity_id := v_scale.voyage_id || '::' || v_scale.port;

    SELECT
      COALESCE((
        SELECT lower(btrim(a.new_value)) = 'true'
        FROM public.audit_logs a
        WHERE a.entity_type = 'voyage_pod_schedule'
          AND a.entity_id = v_scale_entity_id
          AND a.field_name = 'deleted'
        ORDER BY a.changed_at DESC, a.id DESC
        LIMIT 1
      ), false),
      COALESCE((
        SELECT lower(btrim(a.new_value)) = 'true'
        FROM public.audit_logs a
        WHERE a.entity_type = 'voyage_pod_schedule'
          AND a.entity_id = v_scale_entity_id
          AND a.field_name = 'omitted'
        ORDER BY a.changed_at DESC, a.id DESC
        LIMIT 1
      ), false),
      public.customer_communication_safe_timestamptz((
        SELECT a.new_value
        FROM public.audit_logs a
        WHERE a.entity_type = 'voyage_pod_schedule'
          AND a.entity_id = v_scale_entity_id
          AND a.field_name = 'eta'
        ORDER BY a.changed_at DESC, a.id DESC
        LIMIT 1
      )),
      public.customer_communication_safe_timestamptz((
        SELECT a.new_value
        FROM public.audit_logs a
        WHERE a.entity_type = 'voyage_pod_schedule'
          AND a.entity_id = v_scale_entity_id
          AND a.field_name = 'ata'
        ORDER BY a.changed_at DESC, a.id DESC
        LIMIT 1
      ))
    INTO v_is_deleted, v_is_omitted, v_eta, v_ata;

    IF v_is_deleted OR v_is_omitted THEN
      PERFORM public.resolve_alert_item(
        'comunicado_noa_pendente', 'voyage_pod_schedule', v_scale_entity_id,
        v_source, jsonb_build_object('reason', 'scale_deleted_or_omitted')
      );
      PERFORM public.resolve_alert_item(
        'comunicado_nor_pendente', 'voyage_pod_schedule', v_scale_entity_id,
        v_source, jsonb_build_object('reason', 'scale_deleted_or_omitted')
      );
      CONTINUE;
    END IF;

    -- NOA só existe entre D-5 e o instante anterior ao ETA. A janela
    -- fechada no lado passado impede um alerta por cada escala histórica.
    IF v_eta IS NOT NULL
       AND v_eta - interval '5 days' <= v_now
       AND v_now < v_eta
       AND NOT EXISTS (
         SELECT 1
         FROM public.customer_communications c
         WHERE c.kind = 'aviso_chegada_noa'
           AND c.status = 'enviado'
           AND c.anchor_voyage_id = v_scale.voyage_id
           AND upper(btrim(c.anchor_port)) = v_scale.port
       ) THEN
      v_noa_pending := v_noa_pending + 1;
      PERFORM public.upsert_alert_item(
        'comunicado_noa_pendente', 'voyage_pod_schedule', v_scale_entity_id,
        'NOA pendente para a escala ' || v_scale.port ||
          ' (ETA ' || to_char(v_eta AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || ')',
        v_source, 'documentacao',
        jsonb_build_object(
          'voyage_id', v_scale.voyage_id,
          'port', v_scale.port,
          'milestone', 'eta',
          'eta', v_eta,
          'window_days', 5
        ),
        '/clientes/comunicacao'
      );
    ELSE
      PERFORM public.resolve_alert_item(
        'comunicado_noa_pendente', 'voyage_pod_schedule', v_scale_entity_id,
        v_source, jsonb_build_object('reason', 'sent_or_outside_eta_window')
      );
    END IF;

    -- NOR é reativo à ATA e só permanece acionável por 30 dias.
    IF v_ata IS NOT NULL
       AND v_ata >= v_now - interval '30 days'
       AND v_ata <= v_now
       AND NOT EXISTS (
         SELECT 1
         FROM public.customer_communications c
         WHERE c.kind = 'aviso_prontidao_nor'
           AND c.status = 'enviado'
           AND c.anchor_voyage_id = v_scale.voyage_id
           AND upper(btrim(c.anchor_port)) = v_scale.port
       ) THEN
      v_nor_pending := v_nor_pending + 1;
      PERFORM public.upsert_alert_item(
        'comunicado_nor_pendente', 'voyage_pod_schedule', v_scale_entity_id,
        'NOR pendente para a escala ' || v_scale.port ||
          ' (ATA ' || to_char(v_ata AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || ')',
        v_source, 'documentacao',
        jsonb_build_object(
          'voyage_id', v_scale.voyage_id,
          'port', v_scale.port,
          'milestone', 'ata',
          'ata', v_ata,
          'window_days', 30
        ),
        '/clientes/comunicacao'
      );
    ELSE
      PERFORM public.resolve_alert_item(
        'comunicado_nor_pendente', 'voyage_pod_schedule', v_scale_entity_id,
        v_source, jsonb_build_object('reason', 'sent_or_outside_ata_window')
      );
    END IF;
  END LOOP;

  -- Cada estado de terminal tem identidade própria. O ID UUID da linha é a
  -- âncora de NOB; o código do depot é apenas a chave humana do alerta.
  FOR v_terminal IN
    SELECT
      s.id AS state_id,
      s.voyage_id,
      upper(btrim(s.port)) AS port,
      s.terminal_id,
      public.voyage_terminal_code(s.terminal_id) AS terminal_code,
      s.terminal_atb
    FROM public.voyage_escala_terminal_state s
    WHERE s.terminal_id IS NOT NULL
  LOOP
    v_terminals_evaluated := v_terminals_evaluated + 1;
    v_terminal_entity_id := v_terminal.voyage_id || '::' || v_terminal.port || '::' || v_terminal.terminal_code;
    v_scale_entity_id := v_terminal.voyage_id || '::' || v_terminal.port;

    SELECT
      COALESCE((
        SELECT lower(btrim(a.new_value)) = 'true'
        FROM public.audit_logs a
        WHERE a.entity_type = 'voyage_pod_schedule'
          AND a.entity_id = v_scale_entity_id
          AND a.field_name = 'deleted'
        ORDER BY a.changed_at DESC, a.id DESC
        LIMIT 1
      ), false),
      COALESCE((
        SELECT lower(btrim(a.new_value)) = 'true'
        FROM public.audit_logs a
        WHERE a.entity_type = 'voyage_pod_schedule'
          AND a.entity_id = v_scale_entity_id
          AND a.field_name = 'omitted'
        ORDER BY a.changed_at DESC, a.id DESC
        LIMIT 1
      ), false)
    INTO v_is_deleted, v_is_omitted;

    IF v_terminal.terminal_code IS NULL THEN
      CONTINUE;
    END IF;

    IF v_is_deleted
       OR v_is_omitted
       OR v_terminal.terminal_atb IS NULL
       OR v_terminal.terminal_atb < v_now - interval '30 days'
       OR v_terminal.terminal_atb > v_now
       OR EXISTS (
         SELECT 1
         FROM public.customer_communications c
         WHERE c.kind = 'aviso_atracacao_nob'
           AND c.status = 'enviado'
           AND c.anchor_voyage_id = v_terminal.voyage_id
           AND upper(btrim(c.anchor_port)) = v_terminal.port
           AND c.anchor_atracacao_id = v_terminal.state_id
       ) THEN
      PERFORM public.resolve_alert_item(
        'comunicado_nob_pendente', 'voyage_escala_terminal', v_terminal_entity_id,
        v_source, jsonb_build_object('reason', 'sent_or_outside_atb_window')
      );
    ELSE
      v_nob_pending := v_nob_pending + 1;
      PERFORM public.upsert_alert_item(
        'comunicado_nob_pendente', 'voyage_escala_terminal', v_terminal_entity_id,
        'NOB pendente no terminal ' || v_terminal.terminal_code ||
          ' para a escala ' || v_terminal.port ||
          ' (ATB ' || to_char(v_terminal.terminal_atb AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || ')',
        v_source, 'documentacao',
        jsonb_build_object(
          'voyage_id', v_terminal.voyage_id,
          'port', v_terminal.port,
          'terminal_id', v_terminal.terminal_id,
          'terminal_code', v_terminal.terminal_code,
          'state_id', v_terminal.state_id,
          'milestone', 'atb',
          'atb', v_terminal.terminal_atb,
          'window_days', 30
        ),
        '/clientes/comunicacao'
      );
    END IF;
  END LOOP;

  -- Um terminal removido fisicamente não volta no loop acima; feche o alerta
  -- que ficou apontando para a antiga chave, preservando sua ocorrência.
  FOR v_stale IN
    SELECT DISTINCT a.entity_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'comunicado_nob_pendente'
      AND i.status = 'active'
      AND a.entity_type = 'voyage_escala_terminal'
      AND a.entity_id ~ '^[0-9]+::[^:]+::[^:]+$'
  LOOP
    IF NOT EXISTS (
         SELECT 1
         FROM public.voyage_escala_terminal_state s
         WHERE s.voyage_id = split_part(v_stale.entity_id, '::', 1)::BIGINT
           AND upper(btrim(s.port)) = upper(btrim(split_part(v_stale.entity_id, '::', 2)))
           AND public.voyage_terminal_code(s.terminal_id) = split_part(v_stale.entity_id, '::', 3)
       ) THEN
      PERFORM public.resolve_alert_item(
        'comunicado_nob_pendente', 'voyage_escala_terminal', v_stale.entity_id,
        v_source, jsonb_build_object('reason', 'terminal_deleted')
      );
    END IF;
  END LOOP;

  -- A cascata de bounce é o produtor imediato, mas a varredura também fecha
  -- a pendência quando um novo contato válido é cadastrado na Ficha.
  FOR v_customer IN
    SELECT c.id, c.cnpj_cpf
    FROM public.customers c
  LOOP
    SELECT
      EXISTS (
        SELECT 1
        FROM public.customer_contacts cc
        JOIN public.portal_suppressed_emails pse
          ON lower(btrim(pse.email)) = lower(btrim(cc.email))
         AND pse.reason = 'bounce_permanente'
        WHERE cc.customer_id = v_customer.id
          AND NULLIF(btrim(cc.email), '') IS NOT NULL
      ),
      COUNT(*) FILTER (
        WHERE NULLIF(btrim(cc.email), '') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM public.portal_suppressed_emails pse
            WHERE lower(btrim(pse.email)) = lower(btrim(cc.email))
          )
      )::INTEGER
    INTO v_has_bounced_contact, v_valid_contacts
    FROM public.customer_contacts cc
    WHERE cc.customer_id = v_customer.id;

    IF v_has_bounced_contact AND v_valid_contacts = 0 THEN
      v_bounce_pending := v_bounce_pending + 1;
      -- Encerra apenas o carrier legado; o item catalogado abaixo passa a ser
      -- a fonte única da fila para esta regra.
      UPDATE public.alerts
      SET status = 'closed', closed_at = COALESCE(closed_at, now())
      WHERE type = 'cliente_contato_bounced_sem_alternativa'
        AND entity_type = 'customer'
        AND entity_id = v_customer.id::TEXT
        AND NOT EXISTS (
          SELECT 1
          FROM public.alert_items i
          WHERE i.alert_id = public.alerts.id
            AND i.item_type = 'cliente_contato_bounced_sem_alternativa'
        )
        AND status <> 'closed';

      PERFORM public.upsert_alert_item(
        'cliente_contato_bounced_sem_alternativa', 'customer', v_customer.id::TEXT,
        'Cliente sem contato alternativo válido após bounce permanente; atualize o cadastro.',
        v_source, 'documentacao',
        jsonb_build_object(
          'customer_id', v_customer.id,
          'customer_cnpj', v_customer.cnpj_cpf,
          'reason', 'all_contacts_bounced_or_suppressed'
        ),
        '/clientes'
      );
    ELSE
      PERFORM public.resolve_alert_item(
        'cliente_contato_bounced_sem_alternativa', 'customer', v_customer.id::TEXT,
        v_source, jsonb_build_object('reason', 'valid_contact_available')
      );
      UPDATE public.alerts
      SET status = 'closed', closed_at = COALESCE(closed_at, now())
      WHERE type = 'cliente_contato_bounced_sem_alternativa'
        AND entity_type = 'customer'
        AND entity_id = v_customer.id::TEXT
        AND NOT EXISTS (
          SELECT 1
          FROM public.alert_items i
          WHERE i.alert_id = public.alerts.id
            AND i.item_type = 'cliente_contato_bounced_sem_alternativa'
        )
        AND status <> 'closed';
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'scales_evaluated', v_scales_evaluated,
    'terminals_evaluated', v_terminals_evaluated,
    'noa_pending', v_noa_pending,
    'nor_pending', v_nor_pending,
    'nob_pending', v_nob_pending,
    'bounced_without_alternative', v_bounce_pending
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.detect_customer_communication_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_customer_communication_alerts() TO service_role;

-- A nova alternativa encerra a pendência sem esperar o próximo ciclo do
-- detector. O detector continua sendo a rede de segurança para supressões e
-- alterações feitas fora da Ficha.
CREATE OR REPLACE FUNCTION public.resolve_customer_contact_bounce_alert_on_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NULLIF(btrim(NEW.email), '') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.portal_suppressed_emails pse
       WHERE lower(btrim(pse.email)) = lower(btrim(NEW.email))
     ) THEN
    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    PERFORM public.resolve_alert_item(
      'cliente_contato_bounced_sem_alternativa', 'customer', NEW.customer_id::TEXT,
      'customer_contact_change', jsonb_build_object('contact_id', NEW.id)
    );
    PERFORM set_config('alerts.foundation_trigger', 'off', true);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RAISE WARNING 'Reconciliação de alerta de bounce ignorada para customer_contacts.id=%: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS resolve_customer_contact_bounce_alert_on_change ON public.customer_contacts;
CREATE TRIGGER resolve_customer_contact_bounce_alert_on_change
  AFTER INSERT OR UPDATE OF email ON public.customer_contacts
  FOR EACH ROW EXECUTE FUNCTION public.resolve_customer_contact_bounce_alert_on_change();

REVOKE ALL ON FUNCTION public.resolve_customer_contact_bounce_alert_on_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_customer_contact_bounce_alert_on_change() TO service_role;

-- O runner é redefinido na migration 348; esta cópia preserva seus detectores
-- vigentes e acrescenta o produtor de Comunicados no final do ciclo.
CREATE OR REPLACE FUNCTION public.run_alert_detectors()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor UUID;
  v_adr_pending INTEGER := 0;
  v_adr_deadline INTEGER := 0;
  v_bl_review INTEGER := 0;
  v_granite_review INTEGER := 0;
  v_voyage_ops INTEGER := 0;
  v_portal JSONB;
  v_customer_communications JSONB;
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

  -- Faturas vencidas saíram do runner: taxa local não tem vencimento praticado
  -- (issue #605). O Demurrage nunca teve (ADR 0014).

  -- ADR - Relatório de Saída da Agência (Bloco 5)
  v_adr_pending := public.detect_agency_report_pending();
  v_adr_deadline := public.detect_agency_report_deadline_missed();

  -- Revisão Manual de B/L e Granito (Bloco 1)
  v_bl_review := public.detect_bl_review_pendencies();
  v_granite_review := public.detect_granite_bl_review_pendencies();

  -- Operação e Viagens (Bloco 4)
  v_voyage_ops := public.detect_voyage_operation_alerts();

  -- Portal do Cliente e Disputas (Bloco 2)
  v_portal := public.reconcile_client_portal_alerts();

  -- Comunicados ao Cliente: NOA/NOR/NOB e falha de contato alternativo.
  v_customer_communications := public.detect_customer_communication_alerts();

  RETURN jsonb_build_object(
    'agency_report_pending', v_adr_pending,
    'agency_report_deadline_missed', v_adr_deadline,
    'bl_review_pendencies', v_bl_review,
    'granite_bl_review_pendencies', v_granite_review,
    'voyage_operation_alerts', v_voyage_ops,
    'client_portal', v_portal,
    'customer_communications', v_customer_communications
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.run_alert_detectors() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_alert_detectors() TO service_role;
