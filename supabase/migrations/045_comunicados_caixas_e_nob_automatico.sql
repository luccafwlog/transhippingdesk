-- 045_comunicados_caixas_e_nob_automatico.sql
--
-- Intenção de negócio
--   (1) Avisos automáticos passam a respeitar a Caixa de Comunicação que o
--       Cliente escolheu para cada contato, como o disparo manual já faz.
--   (2) O Aviso de Atracação (NOB) deixa de ser exclusivamente manual e passa a
--       sair pela régua, restrito aos Clientes cuja carga pertence a uma Frente
--       de Operação atribuída àquele terminal.
--   (3) NOR e NOB perdem a guarda de idade de 30 dias sobre o marco. O gatilho
--       dos dois é o registro do fato, não a idade dele; um número fixo é aposta
--       sobre a velocidade de um processo humano e descarta em silêncio o que
--       foi lançado tarde. O NOA mantém a sua janela, que não é guarda de idade
--       e sim a definição do comunicado: aviso de chegada é antecipação.
--
-- Causa raiz de (1)
--   A migration 008 ("12. Atualizar produtoras automaticas para consultar
--   customer_contact_box_links") corrigiu `claim_due_demurrage_dunning_invoices`
--   e `find_due_customer_communication_automations`, mas esta última é código
--   morto: ninguém a chama. A produtora que o cron executa de 15 em 15 minutos é
--   `evaluate_and_dispatch_automatic_communications`, que ficou no modelo antigo
--   de `customer_contact_preferences`. Como a 008 também removeu o trigger que
--   semeava aquelas preferências, todo contato criado depois dela não tem linha
--   nenhuma ali — e o filtro deixou de filtrar. Resultado: o robô alcançava
--   todos os contatos do Cliente, inclusive os que ele vinculou só ao
--   Financeiro, enquanto a conferência manual respeitava a caixa.
--
-- Objetos afetados
--   - `public.bl_operation_front_modalidade(text)` (nova, IMMUTABLE)
--   - `public.evaluate_and_dispatch_automatic_communications(timestamptz)`
--     (substituída; mesma assinatura e mesmo contrato de retorno)
--   - `public.find_due_customer_communication_automations` (apenas COMMENT)
--
-- Aditiva ou quebra-contrato
--   Aditiva no schema: nenhuma tabela, coluna, índice ou policy muda. Quebra de
--   comportamento deliberada em dois pontos: menos destinatários por envio
--   automático (o alcance passa a ser o que o Cliente configurou) e uma nova
--   espécie de envio automático (NOB).
--
-- Consumidores
--   - `supabase/functions/customer-communication-auto-runner/index.ts` (passa a
--     aceitar `aviso_atracacao_nob` e a repassar âncora e terminal)
--   - `supabase/functions/send-customer-communication/index.ts` (já aceitava
--     `anchor_atracacao_id` e `terminal_name`; nada muda)
--   - `src/services/customerCommunications.ts` (conferência manual do NOB passa
--     a aplicar o mesmo filtro de Frente de Operação)
--   - alerta `comunicado_nob_pendente`: continua válido e passa a se resolver
--     sozinho quando a frente está atribuída; segue aberto na Atracação TBC.
--
-- Rollback
--   Reaplicar a definição anterior de
--   `evaluate_and_dispatch_automatic_communications` a partir de
--   `supabase/migrations/002_business_logic_and_security.sql` e executar
--   `DROP FUNCTION IF EXISTS public.bl_operation_front_modalidade(text);`.
--   Nenhum dado é migrado, então o rollback é imediato e sem perda.

-- ---------------------------------------------------------------------------
-- Frente de Operação de um B/L, derivada do seu cargo_mode.
-- Espelho SQL de `operationFrontKindForCargoMode` em
-- src/services/escalaTerminalAllocation.ts; os dois são presos à mesma tabela
-- de casos por src/services/__tests__/escalaOperationFrontKind.test.ts.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bl_operation_front_modalidade(p_cargo_mode text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE lower(btrim(COALESCE(p_cargo_mode, '')))
    WHEN 'carga_solta' THEN 'carga_solta'
    WHEN 'veiculo' THEN 'veiculo'
    WHEN 'veiculos' THEN 'veiculo'
    ELSE 'carga_cheia'
  END;
$$;

REVOKE ALL ON FUNCTION public.bl_operation_front_modalidade(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bl_operation_front_modalidade(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.bl_operation_front_modalidade(text) IS
  'Modalidade da Frente de Operacao de importacao a que um B/L pertence, derivada de bls.cargo_mode. Usada para restringir o NOB aos clientes da frente atribuida ao terminal.';

-- ---------------------------------------------------------------------------
-- Produtora automática: roteamento por caixa + NOB por Atracação.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.evaluate_and_dispatch_automatic_communications(
  p_as_of TIMESTAMPTZ DEFAULT now()
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_schedule RECORD;
  v_customer_bl RECORD;
  v_candidates JSONB := '[]'::JSONB;
  v_as_of TIMESTAMPTZ := COALESCE(p_as_of, now());
  v_kind TEXT;
  v_milestone TIMESTAMPTZ;
  v_key TEXT;
  v_voyage_id BIGINT;
  v_vessel_name TEXT;
  v_voyage_number TEXT;
  v_port TEXT;
  v_atracacao RECORD;
  v_nob_suppressed BOOLEAN;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  -- NOA/NOR: somente D-5 até antes do ETA; NOR a partir do ATA no dia do marco.
  FOR v_schedule IN
    WITH entities AS (
      SELECT DISTINCT entity_id
      FROM public.audit_logs
      WHERE entity_type = 'voyage_pod_schedule'
        AND entity_id ~ '^[0-9]+::[^:]+$'
    ), latest AS (
      SELECT e.entity_id,
        public.customer_communication_safe_timestamptz((SELECT a.new_value FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'eta' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1)) AS eta,
        public.customer_communication_safe_timestamptz((SELECT a.new_value FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'ata' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1)) AS ata,
        COALESCE((SELECT lower(a.new_value) = 'true' FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'deleted' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), false) AS deleted,
        COALESCE((SELECT lower(a.new_value) = 'true' FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = e.entity_id AND a.field_name = 'omitted' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1), false) AS omitted
      FROM entities e
    )
    SELECT v.id AS voyage_id, v.voyage_number, vs.name AS vessel_name,
      split_part(l.entity_id, '::', 2) AS port, l.eta, l.ata
    FROM latest l
    JOIN public.voyages v ON v.id = split_part(l.entity_id, '::', 1)::bigint
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE NOT l.deleted AND NOT l.omitted
      AND ((l.ata IS NULL AND l.eta IS NOT NULL
            AND v_as_of >= l.eta - interval '5 days' AND v_as_of < l.eta)
        OR (l.ata IS NOT NULL AND l.ata <= v_as_of))
  LOOP
    v_voyage_id := v_schedule.voyage_id;
    v_vessel_name := v_schedule.vessel_name;
    v_voyage_number := v_schedule.voyage_number;
    v_port := v_schedule.port;
    v_kind := CASE WHEN v_schedule.ata IS NOT NULL THEN 'aviso_prontidao_nor' ELSE 'aviso_chegada_noa' END;
    v_milestone := CASE WHEN v_kind = 'aviso_prontidao_nor' THEN v_schedule.ata ELSE v_schedule.eta END;

    FOR v_customer_bl IN
      SELECT b.customer_id, array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids,
        c.name AS customer_name, c.cnpj_cpf,
        array_agg(DISTINCT NULLIF(btrim(cc.email), '') ORDER BY NULLIF(btrim(cc.email), ''))
          FILTER (WHERE NULLIF(btrim(cc.email), '') IS NOT NULL
            AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') AS emails
      FROM public.bls b
      JOIN public.customers c ON c.id = b.customer_id
      LEFT JOIN public.customer_contacts cc ON cc.customer_id = b.customer_id
      JOIN public.customer_contact_box_links ccb ON ccb.contact_id = cc.id
      WHERE b.voyage_id = v_voyage_id
        AND upper(btrim(b.pod)) = upper(btrim(v_port))
        AND b.customer_id IS NOT NULL
        AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
        AND cc.deactivated_at IS NULL
        AND ccb.box_code = 'documentacao_operacao'
        AND NULLIF(btrim(cc.email), '') IS NOT NULL
        AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_contact_preferences cp
          WHERE cp.contact_id = cc.id AND cp.nature = 'avisos_operacionais' AND cp.enabled = false
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.portal_suppressed_emails pse
          WHERE lower(btrim(pse.email)) = lower(btrim(cc.email)) AND pse.reason = 'bounce_permanente'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communication_suppressions ccs
          WHERE lower(btrim(ccs.email)) = lower(btrim(cc.email))
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communications sent
          WHERE sent.customer_id = b.customer_id
            AND sent.kind = v_kind
            AND sent.nature = 'avisos_operacionais'
            AND sent.status IN ('enviado', 'simulado')
            AND sent.anchor_voyage_id = v_voyage_id
            AND upper(btrim(sent.anchor_port)) = upper(btrim(v_port))
        )
      GROUP BY b.customer_id, c.name, c.cnpj_cpf
    LOOP
      v_key := v_kind || ':' || v_customer_bl.customer_id || ':' || v_voyage_id || ':' || upper(v_port);
      INSERT INTO public.customer_communication_automation_claims (claim_key)
      VALUES (v_key)
      ON CONFLICT (claim_key) DO UPDATE
        SET claimed_at = now(), released_at = NULL
        WHERE customer_communication_automation_claims.released_at IS NOT NULL
           OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes';
      IF FOUND THEN
        v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
          'claim_key', v_key, 'kind', v_kind, 'nature', 'avisos_operacionais',
          'customer_id', v_customer_bl.customer_id, 'customer_name', v_customer_bl.customer_name,
          'customer_cnpj', v_customer_bl.cnpj_cpf, 'voyage_id', v_voyage_id,
          'vessel_name', v_vessel_name, 'voyage_number', v_voyage_number,
          'port', upper(v_port), 'milestone_at', v_milestone,
          'bl_ids', to_jsonb(v_customer_bl.bl_ids), 'emails', to_jsonb(v_customer_bl.emails)
        ));
      END IF;
    END LOOP;
  END LOOP;

  -- CE Mercante: produtor server-side durável, independente da tela de B/L.
  FOR v_customer_bl IN
    SELECT b.voyage_id, b.customer_id, c.name AS customer_name, c.cnpj_cpf,
      v.voyage_number, vs.name AS vessel_name, min(b.pod) AS port,
      v.eta AS milestone_at, array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids,
      array_agg(DISTINCT NULLIF(btrim(cc.email), '') ORDER BY NULLIF(btrim(cc.email), '')) AS emails
    FROM public.bls b
    JOIN public.customers c ON c.id = b.customer_id
    JOIN public.voyages v ON v.id = b.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    JOIN public.customer_contacts cc ON cc.customer_id = b.customer_id
    JOIN public.customer_contact_box_links ccb ON ccb.contact_id = cc.id
    WHERE b.customer_id IS NOT NULL
      AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
      AND cc.deactivated_at IS NULL
      AND ccb.box_code IN ('documentacao_operacao', 'financeiro')
      AND NULLIF(btrim(cc.email), '') IS NOT NULL
      AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      AND NOT EXISTS (SELECT 1 FROM public.customer_contact_preferences cp WHERE cp.contact_id = cc.id AND cp.nature = 'documentacao' AND cp.enabled = false)
      AND NOT EXISTS (SELECT 1 FROM public.portal_suppressed_emails pse WHERE lower(btrim(pse.email)) = lower(btrim(cc.email)) AND pse.reason = 'bounce_permanente')
      AND NOT EXISTS (SELECT 1 FROM public.customer_communication_suppressions ccs WHERE lower(btrim(ccs.email)) = lower(btrim(cc.email)))
      AND (public.customer_local_charges_communication_readiness(b.voyage_id, b.customer_id)->>'ready')::BOOLEAN
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_communications sent
        WHERE sent.customer_id = b.customer_id AND sent.kind = 'ce_mercante_taxas'
          AND sent.nature = 'documentacao' AND sent.status IN ('enviado', 'simulado')
          AND sent.anchor_voyage_id = b.voyage_id AND sent.attempt_discriminator = 0
      )
    GROUP BY b.voyage_id, b.customer_id, c.name, c.cnpj_cpf, v.voyage_number, vs.name, v.eta
  LOOP
    v_key := 'ce_mercante_taxas:' || v_customer_bl.customer_id || ':' || v_customer_bl.voyage_id;
    INSERT INTO public.customer_communication_automation_claims (claim_key)
    VALUES (v_key)
    ON CONFLICT (claim_key) DO UPDATE
      SET claimed_at = now(), released_at = NULL
      WHERE customer_communication_automation_claims.released_at IS NOT NULL
         OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes';
    IF FOUND THEN
      v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
        'claim_key', v_key, 'kind', 'ce_mercante_taxas', 'nature', 'documentacao',
        'customer_id', v_customer_bl.customer_id, 'customer_name', v_customer_bl.customer_name,
        'customer_cnpj', v_customer_bl.cnpj_cpf, 'voyage_id', v_customer_bl.voyage_id,
        'vessel_name', v_customer_bl.vessel_name, 'voyage_number', v_customer_bl.voyage_number,
        'port', COALESCE(v_customer_bl.port, '—'), 'milestone_at', v_customer_bl.milestone_at,
        'bl_ids', to_jsonb(v_customer_bl.bl_ids), 'emails', to_jsonb(v_customer_bl.emails)
      ));
    END IF;
  END LOOP;

  -- NOB: uma Atracação por vez. O universo não é a escala inteira — é a carga
  -- cujo `cargo_mode` pertence a uma Frente de Operação atribuída a ESTE
  -- terminal. Cliente que só descarregou no outro berço não recebe este NOB.
  --
  -- Sem teto de idade do ATB, deliberadamente. O gatilho do NOB é o REGISTRO do
  -- fato, não a idade dele: atracação de sexta lançada na segunda (ou depois de
  -- um feriado, ou na volta das férias) continua sendo comunicado devido, e
  -- nenhum número fixo separa "lançamento atrasado" de "lançamento normal".
  -- Envio repetido é barrado pela idempotência abaixo, não por janela.
  -- (ponytail: import em massa de histórico depois do go-live dispararia NOB
  -- para viagem já encerrada — nenhuma regra de tempo separa isso de um
  -- lançamento atrasado legítimo. Hoje a contenção é a chave global de envio,
  -- que nasce desligada. Upgrade: barrar por estado da viagem, não por data.)
  FOR v_atracacao IN
    SELECT ts.id AS state_id, ts.voyage_id, upper(btrim(ts.port)) AS port,
      ts.terminal_id, ts.terminal_atb,
      public.voyage_terminal_code(ts.terminal_id) AS terminal_code,
      v.voyage_number, vs.name AS vessel_name
    FROM public.voyage_escala_terminal_state ts
    JOIN public.voyages v ON v.id = ts.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE ts.terminal_id IS NOT NULL
      AND ts.terminal_atb IS NOT NULL
      AND ts.terminal_atb <= v_as_of
      AND public.voyage_terminal_code(ts.terminal_id) IS NOT NULL
  LOOP
    -- (ponytail: escala excluída/omitida relida do audit_logs aqui, como em
    -- detect_customer_communication_alerts e no CTE de NOA/NOR acima — terceira
    -- cópia da mesma leitura. Upgrade: extrair
    -- `voyage_escala_suppressed(voyage_id, port)` e apontar as três para ela.)
    SELECT COALESCE((
        SELECT lower(btrim(a.new_value)) = 'true' FROM public.audit_logs a
        WHERE a.entity_type = 'voyage_pod_schedule'
          AND a.entity_id = v_atracacao.voyage_id || '::' || v_atracacao.port
          AND a.field_name = 'deleted'
        ORDER BY a.changed_at DESC, a.id DESC LIMIT 1
      ), false)
      OR COALESCE((
        SELECT lower(btrim(a.new_value)) = 'true' FROM public.audit_logs a
        WHERE a.entity_type = 'voyage_pod_schedule'
          AND a.entity_id = v_atracacao.voyage_id || '::' || v_atracacao.port
          AND a.field_name = 'omitted'
        ORDER BY a.changed_at DESC, a.id DESC LIMIT 1
      ), false)
    INTO v_nob_suppressed;

    CONTINUE WHEN v_nob_suppressed;

    FOR v_customer_bl IN
      SELECT b.customer_id, array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids,
        c.name AS customer_name, c.cnpj_cpf,
        array_agg(DISTINCT NULLIF(btrim(cc.email), '') ORDER BY NULLIF(btrim(cc.email), ''))
          FILTER (WHERE NULLIF(btrim(cc.email), '') IS NOT NULL
            AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') AS emails
      FROM public.bls b
      JOIN public.customers c ON c.id = b.customer_id
      LEFT JOIN public.customer_contacts cc ON cc.customer_id = b.customer_id
      JOIN public.customer_contact_box_links ccb ON ccb.contact_id = cc.id
      WHERE b.voyage_id = v_atracacao.voyage_id
        AND upper(btrim(b.pod)) = v_atracacao.port
        AND b.customer_id IS NOT NULL
        AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
        AND cc.deactivated_at IS NULL
        AND ccb.box_code = 'documentacao_operacao'
        AND NULLIF(btrim(cc.email), '') IS NOT NULL
        AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        AND EXISTS (
          SELECT 1 FROM public.voyage_escala_operation_fronts f
          WHERE f.voyage_id = b.voyage_id
            AND upper(btrim(f.port)) = v_atracacao.port
            AND f.terminal_id = v_atracacao.terminal_id
            AND f.sentido = 'importacao'
            AND f.modalidade = public.bl_operation_front_modalidade(b.cargo_mode)
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_contact_preferences cp
          WHERE cp.contact_id = cc.id AND cp.nature = 'avisos_operacionais' AND cp.enabled = false
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.portal_suppressed_emails pse
          WHERE lower(btrim(pse.email)) = lower(btrim(cc.email)) AND pse.reason = 'bounce_permanente'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communication_suppressions ccs
          WHERE lower(btrim(ccs.email)) = lower(btrim(cc.email))
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communications sent
          WHERE sent.customer_id = b.customer_id
            AND sent.kind = 'aviso_atracacao_nob'
            AND sent.nature = 'avisos_operacionais'
            AND sent.status IN ('enviado', 'simulado')
            AND sent.anchor_atracacao_id = v_atracacao.state_id
        )
      GROUP BY b.customer_id, c.name, c.cnpj_cpf
    LOOP
      v_key := 'aviso_atracacao_nob:' || v_customer_bl.customer_id || ':' || v_atracacao.state_id;
      INSERT INTO public.customer_communication_automation_claims (claim_key)
      VALUES (v_key)
      ON CONFLICT (claim_key) DO UPDATE
        SET claimed_at = now(), released_at = NULL
        WHERE customer_communication_automation_claims.released_at IS NOT NULL
           OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes';
      IF FOUND THEN
        v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
          'claim_key', v_key, 'kind', 'aviso_atracacao_nob', 'nature', 'avisos_operacionais',
          'customer_id', v_customer_bl.customer_id, 'customer_name', v_customer_bl.customer_name,
          'customer_cnpj', v_customer_bl.cnpj_cpf, 'voyage_id', v_atracacao.voyage_id,
          'vessel_name', v_atracacao.vessel_name, 'voyage_number', v_atracacao.voyage_number,
          'port', v_atracacao.port, 'milestone_at', v_atracacao.terminal_atb,
          'anchor_atracacao_id', v_atracacao.state_id,
          'terminal_id', v_atracacao.terminal_id, 'terminal_name', v_atracacao.terminal_code,
          'bl_ids', to_jsonb(v_customer_bl.bl_ids), 'emails', to_jsonb(v_customer_bl.emails)
        ));
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_candidates;
END;
$_$;

REVOKE ALL ON FUNCTION public.evaluate_and_dispatch_automatic_communications(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_and_dispatch_automatic_communications(TIMESTAMPTZ) TO service_role;

-- A sósia morta que recebeu a correção da 008 por engano. Mantida para não
-- quebrar contratos históricos, mas marcada para que a próxima correção de
-- roteamento não caia nela de novo.
COMMENT ON FUNCTION public.find_due_customer_communication_automations(timestamp with time zone, bigint) IS
  'NAO ESTA NO CRON. Produtora legada sem chamador: o runner usa evaluate_and_dispatch_automatic_communications. Corrigir roteamento aqui nao tem efeito em producao.';
