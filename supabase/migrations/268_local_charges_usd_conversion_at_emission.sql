-- Etapa 11 do plano de faturamento (docs/plans/2026-08-06-faturamento-ajuste-completo.md,
-- ADR 0038 decisao 6, achado 7): taxa local cadastrada em USD deixa de
-- bloquear o faturamento. Converte para BRL pelo ROE vigente
-- (exchange_rate_reference, mesma fonte que o Demurrage usa para exibir
-- cotacao) no momento em que o valor e congelado -- na emissao da fatura
-- individual/consolidada, ou no instante em que o B/L vira ready_for_billing
-- para o ledger. Sem Recalculo Diario: ao contrario do Demurrage, aqui o ROE
-- e lido uma vez e fica congelado com o resto da fatura (CONTEXT.md, "Taxa
-- Local em Dolar").
--
-- Investigacao paralela encontrou um bug pre-existente, corrigido junto por
-- estar no mesmo caminho de codigo: trg_emit_invoice_on_bl_ready (migration
-- 068) emitia fatura automaticamente sempre que um B/L virava
-- ready_for_billing, por QUALQUER caminho -- inclusive o botao manual
-- "Pronto para faturar" (mark_bl_ready_for_billing), sem checar CE Mercante
-- (a checagem de CE so existe em reviewBillingAutomation.ts, no fluxo
-- automatico via CE Mercante). E quando mark_bl_ready_and_create_invoice
-- chamava mark_bl_ready_for_billing como primeiro passo, o trigger ja tinha
-- emitido a fatura; o segundo passo (create_invoice_from_bls_with_ledger)
-- entao falhava com "Existe B/L ja faturado" -- reportado como bloqueio
-- inesperado em toda tentativa de emissao automatica via CE Mercante.
--
-- O trigger e as duas funcoes que so ele chamava sao removidos.
-- sync_local_charge_receivable (o unico efeito colateral legitimo do
-- trigger -- manter bl_receivables atualizado) passa a ser chamado de dentro
-- de mark_bl_ready_for_billing, sem o efeito de emitir fatura.

-- ---------------------------------------------------------------------------
-- 1. Remove o trigger de emissao automatica e as funcoes que so ele usava.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_emit_invoice_on_bl_ready ON public.bls;
DROP FUNCTION IF EXISTS public.emit_invoice_on_bl_ready();
DROP FUNCTION IF EXISTS public.create_local_individual_invoice_from_receivable(BIGINT, DATE, TEXT, UUID);

-- ---------------------------------------------------------------------------
-- 2. calculate_bl_local_charges: remove o hold de "USD exige ajuste manual"
--    (linhas em USD agora convertem automaticamente na emissao).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_bl_local_charges(
  p_bl_id TEXT,
  p_actor UUID DEFAULT NULL,
  p_recalculate BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bl RECORD;
  v_table_id BIGINT;
  v_ref_date DATE;
  v_actor UUID;
  v_has_vehicles BOOLEAN := false;
  v_is_exempt BOOLEAN := false;
  v_is_lcl_movement BOOLEAN := false;
  v_auto_review BOOLEAN := false;
  v_line_count INTEGER := 0;
  v_total_brl NUMERIC(14,2) := 0;
  v_total_usd NUMERIC(14,2) := 0;
  v_status TEXT := 'calculated';
  v_reason TEXT := NULL;
  v_qty_total NUMERIC(12,6) := 0;
  v_qty_std NUMERIC(12,6) := 0;
  v_qty_imo NUMERIC(12,6) := 0;
  v_qty_oog NUMERIC(12,6) := 0;
  v_qty_dual NUMERIC(12,6) := 0;
  v_weight_ton NUMERIC(12,3) := 0;
  item RECORD;
  v_qty NUMERIC(12,6);
  v_unit_brl NUMERIC(12,2);
  v_unit_usd NUMERIC(12,2);
  v_total_line_brl NUMERIC(14,2);
  v_total_line_usd NUMERIC(14,2);
  v_is_thd BOOLEAN;
  v_override BOOLEAN;
  v_calculation_key TEXT;
  v_no_containers BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  SELECT
    b.id,
    b.voyage_id,
    b.batch_id,
    COALESCE(b.cargo_mode, 'container') AS cargo_mode,
    b.customer_id,
    b.pod,
    NULLIF((to_jsonb(b)->>'bb_weight_ton'), '')::NUMERIC AS bb_weight_ton,
    b.total_weight_kg,
    b.movement_to,
    b.created_at,
    b.financial_status,
    ib.uploaded_at
  INTO v_bl
  FROM public.bls AS b
  LEFT JOIN public.import_batches AS ib ON ib.id = b.batch_id
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- Etapa 2 do plano de faturamento (ADR 0038, achado 6): a mesma trava que
  -- ja existe no service (chargeOperationsService.ts, checagem previa via
  -- bls.financial_status) agora tambem vive na RPC, para cobrir chamada
  -- direta fora do app.
  IF v_bl.financial_status IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % ja foi faturado (status financeiro=%); recalculo bloqueado. Cancele e reemita a fatura para corrigir.', p_bl_id, v_bl.financial_status USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  IF p_recalculate THEN
    DELETE FROM public.charge_calculations
    WHERE bl_id = p_bl_id
      AND COALESCE(source, 'auto') = 'auto';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.vehicles WHERE bl_id = p_bl_id)
  INTO v_has_vehicles;

  -- Etapa 8 do plano de faturamento (ADR 0038, achados 8 e 10): a isencao de
  -- veiculo exige prova positiva de LCL no destino -- ausencia ou notacao
  -- irreconhecida em movement_to cobra normalmente, ao contrario do padrao
  -- "parar e sinalizar" da etapa 7 (aqui o padrao ja e cobrar). O motor para
  -- de escrever container_load_type: antes, qualquer B/L de container com
  -- veiculo virava LCL por escrita propria e passava na checagem seguinte,
  -- isentando 100% dos B/Ls com veiculo independentemente do movimento real.
  v_is_lcl_movement := v_bl.movement_to IS NOT NULL AND (
    UPPER(TRIM(v_bl.movement_to)) LIKE '%LCL%' OR UPPER(TRIM(v_bl.movement_to)) LIKE '%CFS%'
  );

  IF v_bl.cargo_mode = 'container' AND v_has_vehicles AND v_is_lcl_movement THEN
    v_is_exempt := true;
    v_reason := 'Carga de veiculos / LCL no destino (movement_to=' || v_bl.movement_to || ') com taxas pagas na origem';

    INSERT INTO public.charge_calculations (
      bl_id, source, status, calculation_key, quantity,
      unit_value_brl, total_value_brl, notes, review_reason, created_by, calculated_at
    )
    VALUES (
      p_bl_id, 'auto', 'exempt', 'exempt:lcl_vehicle', 1,
      0, 0, 'Linha sintetica de isencao', v_reason, v_actor, NOW()
    )
    ON CONFLICT (bl_id, calculation_key) DO UPDATE
      SET status = EXCLUDED.status,
          quantity = EXCLUDED.quantity,
          unit_value_brl = EXCLUDED.unit_value_brl,
          total_value_brl = EXCLUDED.total_value_brl,
          notes = EXCLUDED.notes,
          review_reason = EXCLUDED.review_reason,
          created_by = EXCLUDED.created_by,
          calculated_at = NOW();

    UPDATE public.bls
    SET
      charge_status = 'exempt',
      charges_calculated_at = NOW(),
      charge_exemption_reason = v_reason,
      billing_hold_reason = NULL
    WHERE id = p_bl_id;

    RETURN jsonb_build_object(
      'bl_id', p_bl_id,
      'status', 'exempt',
      'table_id', NULL,
      'line_count', 1,
      'total_brl', 0,
      'total_usd', 0,
      'review_required', false,
      'exempt', true,
      'reason', v_reason
    );
  END IF;

  -- Etapa 9 do plano de faturamento (ADR 0038, decisao 3, achado 4): a data
  -- de referencia da tarifa (tabela de taxas e Condicao de Cliente) deixa de
  -- ser uploaded_at/created_at do lote de importacao e passa a ser a ETA da
  -- escala do POD do B/L (voyages.pod_schedule_snapshot, chave = POD). Duas
  -- ancoras alternando faziam o mesmo B/L dar precos diferentes em
  -- recalculos diferentes. ETA ausente vira pendencia de revisao, nao
  -- fallback -- sem ela nao ha tabela nem override resolvidos.
  -- Achado da review da PR 501: pod_schedule_snapshot vem de new_value TEXT
  -- de uma tabela de auditoria (046_voyage_schedule_snapshot_trigger.sql) que
  -- nunca valida formato -- nem o proprio leitor do app (normalizeDateValue
  -- em voyageRouteSchedules.ts) faz mais que trim. Um ::DATE cru sobre isso
  -- estoura em texto malformado, e esta funcao nao tem EXCEPTION handler, o
  -- que derrubaria o calculo do B/L inteiro (e do lote, ja que a Etapa 4
  -- chama isso automaticamente no import) em vez de virar review:no_eta como
  -- o padrao "parar e sinalizar" da Etapa 7 pede. Valida o formato ISO antes
  -- de converter; texto fora do padrao vira NULL, mesmo caminho do ETA
  -- ausente.
  SELECT v_eta_raw.eta_text::DATE
  INTO v_ref_date
  FROM public.voyages AS v
  CROSS JOIN LATERAL (
    SELECT NULLIF(TRIM(v.pod_schedule_snapshot -> v_bl.pod ->> 'eta'), '') AS eta_text
  ) AS v_eta_raw
  WHERE v.id = v_bl.voyage_id
    AND v_eta_raw.eta_text ~ '^\d{4}-\d{2}-\d{2}$';

  IF v_ref_date IS NULL THEN
    v_auto_review := true;
    INSERT INTO public.charge_calculations (
      bl_id, source, status, calculation_key, quantity, total_value_brl,
      review_reason, notes, created_by, calculated_at
    )
    VALUES (
      p_bl_id, 'auto', 'review_required', 'review:no_eta', 1, 0,
      'ETA da escala do POD ausente; nao ha data de referencia para a tarifa', 'Revisao manual obrigatoria', v_actor, NOW()
    )
    ON CONFLICT (bl_id, calculation_key) DO UPDATE
      SET status = EXCLUDED.status,
          quantity = EXCLUDED.quantity,
          total_value_brl = EXCLUDED.total_value_brl,
          review_reason = EXCLUDED.review_reason,
          notes = EXCLUDED.notes,
          created_by = EXCLUDED.created_by,
          calculated_at = NOW();
  END IF;

  IF v_ref_date IS NOT NULL THEN
    v_table_id := public.resolve_local_charge_table_id(v_bl.cargo_mode, v_bl.pod, v_ref_date);

    IF v_table_id IS NULL THEN
      v_reason := 'Nao existe tabela ativa para POD/mode na data de referencia (ETA da escala)';
      v_auto_review := true;

      INSERT INTO public.charge_calculations (
        bl_id, source, status, calculation_key, quantity, total_value_brl,
        review_reason, notes, created_by, calculated_at
      )
      VALUES (
        p_bl_id, 'auto', 'review_required', 'review:no_table', 1, 0,
        v_reason, 'Revisao manual obrigatoria', v_actor, NOW()
      )
      ON CONFLICT (bl_id, calculation_key) DO UPDATE
        SET status = EXCLUDED.status,
            quantity = EXCLUDED.quantity,
            total_value_brl = EXCLUDED.total_value_brl,
            review_reason = EXCLUDED.review_reason,
            notes = EXCLUDED.notes,
            created_by = EXCLUDED.created_by,
            calculated_at = NOW();
    END IF;
  END IF;

  IF v_bl.cargo_mode = 'container' THEN
    WITH current_containers AS (
      SELECT
        UPPER(TRIM(bc.container_number)) AS cn,
        BOOL_OR(COALESCE(bc.is_imo, false)) AS has_imo,
        BOOL_OR(COALESCE(bc.is_oog, false)) AS has_oog
      FROM public.bl_containers AS bc
      WHERE bc.bl_id = p_bl_id
        AND TRIM(COALESCE(bc.container_number, '')) <> ''
      GROUP BY UPPER(TRIM(bc.container_number))
    ),
    shares AS (
      SELECT
        cc.cn,
        cc.has_imo,
        cc.has_oog,
        (
          SELECT COUNT(DISTINCT b2.id)::NUMERIC
          FROM public.bls AS b2
          JOIN public.bl_containers AS bc2 ON bc2.bl_id = b2.id
          WHERE b2.voyage_id = v_bl.voyage_id
            AND COALESCE(b2.cargo_mode, 'container') = 'container'
            AND UPPER(TRIM(COALESCE(bc2.container_number, ''))) = cc.cn
        ) AS share_count
      FROM current_containers AS cc
    )
    SELECT
      COALESCE(SUM(CASE WHEN share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN NOT has_imo AND NOT has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_imo AND NOT has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_oog AND NOT has_imo AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN has_imo AND has_oog AND share_count > 0 THEN 1 / share_count ELSE 0 END), 0)
    INTO v_qty_total, v_qty_std, v_qty_imo, v_qty_oog, v_qty_dual
    FROM shares;

    IF v_qty_dual > 0 THEN
      v_auto_review := true;
      INSERT INTO public.charge_calculations (
        bl_id, charge_table_id, source, status, calculation_key, quantity,
        total_value_brl, review_reason, notes, created_by, calculated_at
      )
      VALUES (
        p_bl_id, v_table_id, 'auto', 'review_required', 'review:imo_oog_thd', v_qty_dual,
        0, 'Container com IMO e OOG ao mesmo tempo exige revisao manual de THD', 'THD nao calculado automaticamente', v_actor, NOW()
      )
      ON CONFLICT (bl_id, calculation_key) DO UPDATE
        SET
          status = EXCLUDED.status,
          quantity = EXCLUDED.quantity,
          total_value_brl = EXCLUDED.total_value_brl,
          review_reason = EXCLUDED.review_reason,
          notes = EXCLUDED.notes,
          created_by = EXCLUDED.created_by,
          calculated_at = NOW();
    END IF;
  END IF;

  -- Etapa 7 do plano de faturamento (ADR 0038 decisao 7, achado 1): B/L de
  -- container sem nenhum container cadastrado nunca deve cobrar zero em
  -- silencio (o COALESCE(v_qty,0)<=0 THEN CONTINUE do loop de itens pularia
  -- toda linha container_distinct_voyage sem avisar ninguem). Sinaliza uma
  -- vez por B/L, nao por item.
  IF v_bl.cargo_mode = 'container' THEN
    SELECT NOT EXISTS(
      SELECT 1 FROM public.bl_containers AS bc
      WHERE bc.bl_id = p_bl_id AND TRIM(COALESCE(bc.container_number, '')) <> ''
    ) INTO v_no_containers;

    IF v_no_containers THEN
      v_auto_review := true;
      INSERT INTO public.charge_calculations (
        bl_id, charge_table_id, source, status, calculation_key, quantity,
        total_value_brl, review_reason, notes, created_by, calculated_at
      )
      VALUES (
        p_bl_id, v_table_id, 'auto', 'review_required', 'review:no_containers', 1,
        0, 'B/L de container sem containers cadastrados', 'Revisao manual obrigatoria', v_actor, NOW()
      )
      ON CONFLICT (bl_id, calculation_key) DO UPDATE
        SET
          status = EXCLUDED.status,
          quantity = EXCLUDED.quantity,
          total_value_brl = EXCLUDED.total_value_brl,
          review_reason = EXCLUDED.review_reason,
          notes = EXCLUDED.notes,
          created_by = EXCLUDED.created_by,
          calculated_at = NOW();
    END IF;
  END IF;

  IF v_table_id IS NOT NULL THEN
    FOR item IN
      SELECT
        cti.id,
        cti.name,
        cti.category,
        cti.application_basis,
        COALESCE(cti.cargo_profile, 'any') AS cargo_profile,
        COALESCE(cti.currency, 'BRL') AS currency,
        cti.unit_value_brl,
        cti.unit_value_usd,
        ov.override_value
      FROM public.charge_table_items AS cti
      LEFT JOIN LATERAL (
        SELECT cro.override_value
        FROM public.customer_rate_overrides AS cro
        WHERE cro.customer_id = v_bl.customer_id
          AND cro.charge_item_id = cti.id
          AND (cro.valid_from IS NULL OR cro.valid_from <= v_ref_date)
          AND (cro.valid_to IS NULL OR cro.valid_to >= v_ref_date)
        -- Etapa 10 do plano de faturamento (ADR 0038 decisao 5, achado 5):
        -- customer_rate_overrides_no_overlap (migration 267) garante que no
        -- maximo uma linha bate aqui, entao o desempate por created_at nao
        -- tem mais funcao. LIMIT 1 fica como rede de seguranca defensiva.
        LIMIT 1
      ) AS ov ON TRUE
      WHERE cti.charge_table_id = v_table_id
        AND COALESCE(cti.active, true)
        AND NOT COALESCE(cti.manual_only, false)
      ORDER BY COALESCE(cti.sort_order, 100), cti.id
    LOOP
      v_qty := 0;
      v_is_thd := UPPER(COALESCE(item.name, '')) LIKE 'THD%';

      IF item.application_basis = 'bl' THEN
        v_qty := 1;
      ELSIF item.application_basis = 'weight_ton' THEN
        v_weight_ton := COALESCE(v_bl.bb_weight_ton, CASE WHEN v_bl.total_weight_kg IS NULL THEN NULL ELSE v_bl.total_weight_kg / 1000 END, 0);
        IF v_weight_ton <= 0 THEN
          v_auto_review := true;
          INSERT INTO public.charge_calculations (
            bl_id, charge_table_id, charge_item_id, source, status, calculation_key, quantity,
            total_value_brl, review_reason, notes, created_by, calculated_at
          )
          VALUES (
            p_bl_id, v_table_id, item.id, 'auto', 'review_required',
            CONCAT('review:weight_missing:', item.id), 0,
            0, 'Weight ton ausente/invalido para calculo', 'Revisao manual obrigatoria', v_actor, NOW()
          )
          ON CONFLICT (bl_id, calculation_key) DO UPDATE
            SET
              status = EXCLUDED.status,
              quantity = EXCLUDED.quantity,
              total_value_brl = EXCLUDED.total_value_brl,
              review_reason = EXCLUDED.review_reason,
              notes = EXCLUDED.notes,
              created_by = EXCLUDED.created_by,
              calculated_at = NOW();
          CONTINUE;
        END IF;
        v_qty := v_weight_ton;
      ELSIF item.application_basis = 'container_distinct_voyage' THEN
        IF v_bl.cargo_mode = 'container' THEN
          IF v_is_thd THEN
            IF item.cargo_profile = 'standard' THEN
              v_qty := v_qty_std;
            ELSIF item.cargo_profile = 'imo' THEN
              v_qty := v_qty_imo;
            ELSIF item.cargo_profile = 'oog' THEN
              v_qty := v_qty_oog;
            ELSE
              -- Etapa 7 (achado 1): THD com cargo_profile 'any' e um item mal
              -- cadastrado (o motor so sabe distinguir standard/imo/oog) -- para
              -- e sinaliza em vez de cobrar zero.
              v_auto_review := true;
              INSERT INTO public.charge_calculations (
                bl_id, charge_table_id, charge_item_id, source, status, calculation_key, quantity,
                total_value_brl, review_reason, notes, created_by, calculated_at
              )
              VALUES (
                p_bl_id, v_table_id, item.id, 'auto', 'review_required',
                CONCAT('review:thd_any_profile:', item.id), 0,
                0, 'Item THD cadastrado com perfil de carga ''any''; motor so calcula standard/imo/oog', 'Revisao manual obrigatoria', v_actor, NOW()
              )
              ON CONFLICT (bl_id, calculation_key) DO UPDATE
                SET
                  status = EXCLUDED.status,
                  quantity = EXCLUDED.quantity,
                  total_value_brl = EXCLUDED.total_value_brl,
                  review_reason = EXCLUDED.review_reason,
                  notes = EXCLUDED.notes,
                  created_by = EXCLUDED.created_by,
                  calculated_at = NOW();
              CONTINUE;
            END IF;
          ELSE
            v_qty := v_qty_total;
          END IF;
        ELSE
          v_qty := 0;
        END IF;
      ELSE
        -- Etapa 7 (achado 1): application_basis sem implementacao no motor
        -- (ex.: 'teu') -- para e sinaliza em vez de cobrar zero em silencio.
        v_auto_review := true;
        INSERT INTO public.charge_calculations (
          bl_id, charge_table_id, charge_item_id, source, status, calculation_key, quantity,
          total_value_brl, review_reason, notes, created_by, calculated_at
        )
        VALUES (
          p_bl_id, v_table_id, item.id, 'auto', 'review_required',
          CONCAT('review:unsupported_basis:', item.id), 0,
          0, CONCAT('Base de aplicacao nao suportada pelo motor: ', COALESCE(item.application_basis, '(vazia)')), 'Revisao manual obrigatoria', v_actor, NOW()
        )
        ON CONFLICT (bl_id, calculation_key) DO UPDATE
          SET
            status = EXCLUDED.status,
            quantity = EXCLUDED.quantity,
            total_value_brl = EXCLUDED.total_value_brl,
            review_reason = EXCLUDED.review_reason,
            notes = EXCLUDED.notes,
            created_by = EXCLUDED.created_by,
            calculated_at = NOW();
        CONTINUE;
      END IF;

      IF COALESCE(v_qty, 0) <= 0 THEN
        CONTINUE;
      END IF;

      v_override := item.override_value IS NOT NULL;
      v_unit_brl := COALESCE(item.override_value, item.unit_value_brl, 0);
      v_unit_usd := item.unit_value_usd;
      v_total_line_brl := CASE WHEN item.currency = 'USD' THEN NULL ELSE ROUND(v_qty * COALESCE(v_unit_brl, 0), 2) END;
      v_total_line_usd := CASE WHEN item.currency = 'USD' THEN ROUND(v_qty * COALESCE(v_unit_usd, 0), 2) ELSE NULL END;
      v_calculation_key := CONCAT('auto:item:', item.id);

      INSERT INTO public.charge_calculations (
        bl_id,
        charge_table_id,
        charge_item_id,
        quantity,
        unit_value_brl,
        unit_value_usd,
        total_value_brl,
        total_value_usd,
        override_applied,
        source,
        status,
        calculation_key,
        created_by,
        calculated_at
      )
      VALUES (
        p_bl_id,
        v_table_id,
        item.id,
        v_qty,
        CASE WHEN item.currency = 'USD' THEN NULL ELSE v_unit_brl END,
        CASE WHEN item.currency = 'USD' THEN v_unit_usd ELSE NULL END,
        v_total_line_brl,
        v_total_line_usd,
        v_override,
        'auto',
        'calculated',
        v_calculation_key,
        v_actor,
        NOW()
      )
      ON CONFLICT (bl_id, calculation_key) DO UPDATE
      SET
        charge_table_id = EXCLUDED.charge_table_id,
        charge_item_id = EXCLUDED.charge_item_id,
        quantity = EXCLUDED.quantity,
        unit_value_brl = EXCLUDED.unit_value_brl,
        unit_value_usd = EXCLUDED.unit_value_usd,
        total_value_brl = EXCLUDED.total_value_brl,
        total_value_usd = EXCLUDED.total_value_usd,
        override_applied = EXCLUDED.override_applied,
        source = EXCLUDED.source,
        status = EXCLUDED.status,
        created_by = EXCLUDED.created_by,
        calculated_at = NOW();
    END LOOP;
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(COALESCE(total_value_brl, 0)), 0),
    COALESCE(SUM(COALESCE(total_value_usd, 0)), 0)
  INTO v_line_count, v_total_brl, v_total_usd
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id;

  IF v_is_exempt THEN
    v_status := 'exempt';
  ELSIF v_auto_review THEN
    v_status := 'review_required';
  ELSIF v_line_count > 0 THEN
    v_status := 'calculated';
  ELSE
    v_status := 'not_calculated';
  END IF;

  UPDATE public.bls
  SET
    charge_status = v_status,
    charges_calculated_at = NOW(),
    charge_exemption_reason = CASE WHEN v_status = 'exempt' THEN v_reason ELSE NULL END,
    -- Etapa 11 do plano de faturamento (ADR 0038 decisao 6, achado 7): linhas
    -- em USD deixam de exigir ajuste manual -- create_invoice_from_bls_core e
    -- create_local_consolidated_invoice_core convertem para BRL pelo ROE
    -- vigente na emissao (migration 268). O hold aqui so fazia sentido
    -- enquanto USD bloqueava o fluxo; mante-lo bloquearia todo B/L com linha
    -- em USD na tela de Validacao mesmo depois da conversao automatica.
    billing_hold_reason = CASE
      WHEN v_status = 'review_required' THEN COALESCE(v_reason, 'Pendencia de revisao nas taxas locais.')
      WHEN v_status = 'not_calculated' THEN 'Nenhuma tabela de preco ou tarifa encontrada. Adicione os precos e recalcule.'
      ELSE NULL
    END
  WHERE id = p_bl_id;

  RETURN jsonb_build_object(
    'bl_id', p_bl_id,
    'status', v_status,
    'table_id', v_table_id,
    'line_count', v_line_count,
    'total_brl', v_total_brl,
    'total_usd', v_total_usd,
    'review_required', v_auto_review,
    'exempt', (v_status = 'exempt'),
    'reason', COALESCE(v_reason, '')
  );
END;
$$;


REVOKE ALL ON FUNCTION public.calculate_bl_local_charges(TEXT, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_bl_local_charges(TEXT, UUID, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. sync_local_charge_receivable: inclui linhas USD (convertidas pelo ROE)
--    no saldo do receivable; permissao alinhada a is_active_user() (deixa de
--    exigir is_admin) porque passa a ser chamada de dentro de
--    mark_bl_ready_for_billing, usado por qualquer usuario de faturamento.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_local_charge_receivable(p_bl_id TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bl RECORD;
  v_amount NUMERIC(14,2);
  v_roe NUMERIC(10,4);
  v_paid_amount NUMERIC(14,2);
  v_receivable_id BIGINT;
  v_status TEXT;
BEGIN
  -- Etapa 11 do plano de faturamento (achado da review da PR 501): esta
  -- funcao passa a ser chamada por mark_bl_ready_for_billing (migration 268),
  -- que exige apenas is_active_user() -- o mesmo bar de qualquer usuario de
  -- faturamento, nao so admin. Exigir is_admin() aqui quebraria "Pronto para
  -- faturar" para usuarios nao-admin, ja que SECURITY DEFINER nao muda
  -- auth.uid(). Alinha ao bar do chamador: e um recalculo de saldo, nao uma
  -- operacao administrativa.
  IF auth.uid() IS NOT NULL
     AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT id, customer_id, voyage_id, cargo_mode, pol, pod
  INTO v_bl
  FROM public.bls
  WHERE id = UPPER(TRIM(p_bl_id));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.customer_id IS NULL THEN
    RAISE EXCEPTION 'B/L % sem cliente vinculado.', p_bl_id USING ERRCODE = '22023';
  END IF;

  -- Etapa 11 do plano de faturamento (ADR 0038 decisao 6, achado 7): linhas em
  -- USD entram no saldo do receivable convertidas pelo ROE vigente neste
  -- momento -- o mesmo instante em que o B/L vira ready_for_billing (chamado
  -- de dentro de mark_bl_ready_for_billing), analogo ao congelamento na
  -- emissao do caminho individual. Sem isto, total_value_brl NULL em linhas
  -- USD-only zerava o saldo do receivable (a base do ledger/consolidada).
  SELECT roe INTO v_roe FROM public.exchange_rate_reference WHERE id = 1;

  IF v_roe IS NULL AND EXISTS (
    SELECT 1 FROM public.charge_calculations AS cc
    WHERE cc.bl_id = v_bl.id
      AND COALESCE(cc.total_value_usd, 0) > 0
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt')
  ) THEN
    RAISE EXCEPTION 'Cambio (ROE) nao configurado; nao e possivel calcular o saldo de linhas em USD.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(
    COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN ROUND(cc.total_value_usd * v_roe, 2) END, 0)
  ), 0)
  INTO v_amount
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = v_bl.id
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt');

  SELECT COALESCE(SUM(p.amount_brl), 0)
  INTO v_paid_amount
  FROM public.invoice_bls ib
  JOIN public.invoices i ON i.id = ib.invoice_id
  JOIN public.payments p ON p.invoice_id = i.id
  WHERE ib.bl_id = v_bl.id
    AND COALESCE(i.status, 'issued') = 'paid';

  v_paid_amount := LEAST(v_paid_amount, v_amount);
  v_status := CASE
    WHEN v_amount <= 0 THEN 'void'
    WHEN v_paid_amount >= v_amount THEN 'settled'
    WHEN v_paid_amount > 0 THEN 'partially_settled'
    ELSE 'open'
  END;

  INSERT INTO public.bl_receivables (
    bl_id, customer_id, source, original_amount_brl, settled_amount_brl, balance_brl,
    status, voyage_id, cargo_mode, pol, pod, updated_at
  )
  VALUES (
    v_bl.id, v_bl.customer_id, 'local_charges', v_amount, v_paid_amount,
    GREATEST(v_amount - v_paid_amount, 0), v_status, v_bl.voyage_id,
    v_bl.cargo_mode, v_bl.pol, v_bl.pod, now()
  )
  ON CONFLICT (source, bl_id)
  DO UPDATE SET
    customer_id = EXCLUDED.customer_id,
    original_amount_brl = EXCLUDED.original_amount_brl,
    settled_amount_brl = EXCLUDED.settled_amount_brl,
    balance_brl = EXCLUDED.balance_brl,
    status = EXCLUDED.status,
    voyage_id = EXCLUDED.voyage_id,
    cargo_mode = EXCLUDED.cargo_mode,
    pol = EXCLUDED.pol,
    pod = EXCLUDED.pod,
    updated_at = now()
  RETURNING id INTO v_receivable_id;

  RETURN v_receivable_id;
END;
$$;


REVOKE ALL ON FUNCTION public.sync_local_charge_receivable(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_local_charge_receivable(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. mark_bl_ready_for_billing: linhas em USD deixam de bloquear; chama
--    sync_local_charge_receivable no lugar do trigger removido.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_bl_ready_for_billing(
  p_bl_id TEXT,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bl RECORD;
  v_pending_count INTEGER := 0;
  v_table_count INTEGER := 0;
  v_invoiceable_count INTEGER := 0;
  v_review_reasons TEXT[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  SELECT
    id,
    charge_status,
    pod,
    cargo_mode,
    customer_id,
    customer_reconciliation_status
  INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.customer_id IS NULL THEN
    UPDATE public.bls
    SET billing_hold_reason = 'Cliente nao reconciliado para faturamento.'
    WHERE id = p_bl_id;

    RAISE EXCEPTION
      'B/L % nao possui cliente vinculado. Vincule um cliente antes de marcar como pronto para faturar.',
      p_bl_id
      USING ERRCODE = 'P0003';
  END IF;

  IF COALESCE(v_bl.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled') THEN
    UPDATE public.bls
    SET billing_hold_reason = 'Cliente exige reconciliacao manual antes do faturamento.'
    WHERE id = p_bl_id;

    RAISE EXCEPTION 'B/L exige reconciliacao manual antes do faturamento.' USING ERRCODE = '22023';
  END IF;

  v_review_reasons := public.compute_bl_review_pendencies(p_bl_id);
  IF COALESCE(cardinality(v_review_reasons), 0) > 0 THEN
    UPDATE public.bls
    SET billing_hold_reason =
      'B/L possui pendencias no gate de revisao: ' || array_to_string(v_review_reasons, ', ')
    WHERE id = p_bl_id;

    RAISE EXCEPTION
      'B/L possui pendencias no gate de revisao: %',
      array_to_string(v_review_reasons, ', ')
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO v_pending_count
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id
    AND status = 'review_required';

  IF v_pending_count > 0 THEN
    UPDATE public.bls
    SET billing_hold_reason = 'Ainda existem linhas com pendencia de revisao.'
    WHERE id = p_bl_id;

    RAISE EXCEPTION 'Ainda existem linhas com pendencia de revisao' USING ERRCODE = '22023';
  END IF;

  -- Etapa 11 do plano de faturamento (ADR 0038 decisao 6, achado 7): linhas
  -- em USD deixam de bloquear o ready_for_billing -- create_invoice_from_bls_core
  -- converte para BRL pelo ROE vigente na emissao.
  SELECT COUNT(*)
  INTO v_invoiceable_count
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id
    AND (COALESCE(total_value_brl, 0) > 0 OR COALESCE(total_value_usd, 0) > 0)
    AND COALESCE(status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_invoiceable_count = 0 THEN
    UPDATE public.bls
    SET billing_hold_reason = 'B/L sem linhas faturaveis. Recalcule as taxas antes de faturar.'
    WHERE id = p_bl_id;

    RAISE EXCEPTION 'B/L sem linhas faturaveis.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO v_table_count
  FROM public.charge_tables
  WHERE public.normalize_port_code(pod) = public.normalize_port_code(v_bl.pod)
    AND cargo_mode = v_bl.cargo_mode
    AND active = true
    AND valid_from <= CURRENT_DATE
    AND (valid_to IS NULL OR valid_to >= CURRENT_DATE);

  IF v_table_count = 0 THEN
    RAISE EXCEPTION
      'Nenhuma tabela de cobranca vigente para POD "%" (modo: %). Configure em /taxas-locais antes de prosseguir.',
      v_bl.pod, v_bl.cargo_mode
      USING ERRCODE = 'P0004';
  END IF;

  UPDATE public.charge_calculations
  SET status = 'ready_for_billing'
  WHERE bl_id = p_bl_id
    AND status IN ('calculated', 'reviewed');

  UPDATE public.bls
  SET
    charge_status = 'ready_for_billing',
    billing_hold_reason = NULL
  WHERE id = p_bl_id;

  -- Achado da review da PR 501: trg_emit_invoice_on_bl_ready (migration 068)
  -- era o unico ponto vivo que populava/atualizava bl_receivables fora dos
  -- backfills manuais -- e ele foi removido nesta migration por emitir
  -- fatura automaticamente sem checar CE Mercante e por duplicar a emissao
  -- que create_invoice_from_bls_with_ledger ja faz. Sem substituto, o ledger
  -- pararia de receber novos B/Ls. sync_local_charge_receivable so grava o
  -- saldo (nao emite fatura), entao chama-lo aqui preserva o ledger sem
  -- reintroduzir o bug.
  PERFORM public.sync_local_charge_receivable(p_bl_id);

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
  VALUES (
    'bl',
    p_bl_id,
    'charge_status',
    COALESCE(v_bl.charge_status, 'null'),
    'ready_for_billing',
    auth.uid(),
    NOW(),
    'Marcado como pronto para faturar no modulo de Taxas Locais'
  );

  RETURN jsonb_build_object('bl_id', p_bl_id, 'status', 'ready_for_billing', 'changed', true);
END;
$function$;


REVOKE ALL ON FUNCTION public.mark_bl_ready_for_billing(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_bl_ready_for_billing(TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. create_invoice_from_bls_core: converte linhas USD para BRL pelo ROE
--    vigente na emissao, congelado no snapshot_payload do item.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_invoice_from_bls_core(
  p_bl_ids TEXT[],
  p_customer_id BIGINT,
  p_due_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_issue_now BOOLEAN DEFAULT true,
  p_actor UUID DEFAULT NULL,
  p_origin TEXT DEFAULT 'internal',
  p_portal_account_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requested_bls TEXT[];
  v_bl_count INTEGER;
  v_missing_bls TEXT;
  v_customer_id BIGINT;
  v_max_customer_id BIGINT;
  v_conflict_count INTEGER;
  v_usd_count INTEGER;
  v_invoice_id BIGINT;
  v_invoice_number TEXT;
  v_total_brl NUMERIC(14,2);
  v_item_count INTEGER;
  v_status TEXT;
  v_batch_id BIGINT;
  v_roe NUMERIC(10,4);
  v_roe_effective_date DATE;
BEGIN
  v_status := CASE WHEN COALESCE(p_issue_now, true) THEN 'issued' ELSE 'draft' END;

  SELECT ARRAY_AGG(DISTINCT UPPER(TRIM(bl_id)) ORDER BY UPPER(TRIM(bl_id)))
  INTO v_requested_bls
  FROM UNNEST(COALESCE(p_bl_ids, ARRAY[]::TEXT[])) AS input(bl_id)
  WHERE TRIM(COALESCE(bl_id, '')) <> '';

  IF COALESCE(ARRAY_LENGTH(v_requested_bls, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado para emissao.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.bls
  WHERE id = ANY(v_requested_bls)
  FOR UPDATE;

  SELECT COUNT(*) INTO v_bl_count
  FROM public.bls
  WHERE id = ANY(v_requested_bls);

  IF v_bl_count <> ARRAY_LENGTH(v_requested_bls, 1) THEN
    SELECT STRING_AGG(req.bl_id, ', ' ORDER BY req.bl_id)
    INTO v_missing_bls
    FROM UNNEST(v_requested_bls) AS req(bl_id)
    LEFT JOIN public.bls AS b ON b.id = req.bl_id
    WHERE b.id IS NULL;

    RAISE EXCEPTION 'B/L(s) nao encontrado(s): %', COALESCE(v_missing_bls, '-')
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = ANY(v_requested_bls)
      AND COALESCE(b.charge_status, 'not_calculated') <> 'ready_for_billing'
  ) THEN
    RAISE EXCEPTION 'Todos os B/Ls devem estar como ready_for_billing.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = ANY(v_requested_bls)
      AND COALESCE(b.financial_status, 'pending') <> 'pending'
  ) THEN
    RAISE EXCEPTION 'Existe B/L ja faturado/pago/cancelado na selecao.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = ANY(v_requested_bls)
      AND (b.customer_id IS NULL OR COALESCE(b.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled'))
  ) THEN
    RAISE EXCEPTION 'Todos os B/Ls precisam de cliente reconciliado para faturar.' USING ERRCODE = '22023';
  END IF;

  SELECT MIN(b.customer_id), MAX(b.customer_id)
  INTO v_customer_id, v_max_customer_id
  FROM public.bls AS b
  WHERE b.id = ANY(v_requested_bls);

  IF v_customer_id IS NULL OR v_customer_id <> v_max_customer_id THEN
    RAISE EXCEPTION 'Selecao contem B/Ls de clientes diferentes.' USING ERRCODE = '22023';
  END IF;

  IF p_customer_id IS NOT NULL AND p_customer_id <> v_customer_id THEN
    RAISE EXCEPTION 'Cliente informado nao corresponde aos B/Ls selecionados.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO v_conflict_count
  FROM public.invoice_bls AS ib
  JOIN public.invoices AS inv ON inv.id = ib.invoice_id
  WHERE ib.bl_id = ANY(v_requested_bls)
    AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue');

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Existe B/L vinculado a invoice ativa.' USING ERRCODE = '23505';
  END IF;

  -- Etapa 11 do plano de faturamento (ADR 0038 decisao 6, achado 7): linhas em
  -- USD nao bloqueiam mais a emissao. Convertem para BRL aqui, pelo ROE
  -- vigente neste momento (exchange_rate_reference, mesma fonte que o
  -- Demurrage usa para exibir cotacao -- sem o Recalculo Diario dele: aqui o
  -- ROE e lido uma vez e congelado com o resto da fatura).
  SELECT COUNT(*)
  INTO v_usd_count
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = ANY(v_requested_bls)
    AND COALESCE(cc.total_value_usd, 0) > 0
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_usd_count > 0 THEN
    SELECT roe, effective_date INTO v_roe, v_roe_effective_date
    FROM public.exchange_rate_reference WHERE id = 1;

    IF v_roe IS NULL THEN
      RAISE EXCEPTION 'Cambio (ROE) nao configurado; nao e possivel converter linhas em USD para emitir a fatura.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF ARRAY_LENGTH(v_requested_bls, 1) > 1 THEN
    INSERT INTO public.billing_batches (
      customer_id,
      origin,
      status,
      notes,
      requested_by,
      portal_account_id
    )
    VALUES (
      v_customer_id,
      COALESCE(p_origin, 'internal'),
      'requested',
      NULLIF(TRIM(COALESCE(p_notes, '')), ''),
      p_actor,
      p_portal_account_id
    )
    RETURNING id INTO v_batch_id;
  END IF;

  INSERT INTO public.invoices (
    customer_id,
    bl_id,
    issued_at,
    due_date,
    total_brl,
    status,
    notes,
    total_paid_brl,
    balance_brl,
    issued_by
  )
  VALUES (
    v_customer_id,
    CASE WHEN ARRAY_LENGTH(v_requested_bls, 1) = 1 THEN v_requested_bls[1] ELSE NULL END,
    CASE WHEN v_status = 'issued' THEN now() ELSE NULL END,
    p_due_date,
    0,
    v_status,
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    0,
    0,
    p_actor
  )
  RETURNING id, invoice_number
  INTO v_invoice_id, v_invoice_number;

  INSERT INTO public.invoice_bls (
    invoice_id,
    bl_id,
    charge_status_snapshot,
    financial_status_snapshot,
    subtotal_brl,
    subtotal_usd
  )
  SELECT
    v_invoice_id,
    b.id,
    b.charge_status,
    b.financial_status,
    COALESCE(calc.total_brl, 0),
    COALESCE(calc.total_usd, 0)
  FROM public.bls AS b
  LEFT JOIN (
    SELECT
      cc.bl_id,
      SUM(COALESCE(cc.total_value_brl, 0)) AS total_brl,
      SUM(COALESCE(cc.total_value_usd, 0)) AS total_usd
    FROM public.charge_calculations AS cc
    WHERE cc.bl_id = ANY(v_requested_bls)
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt')
    GROUP BY cc.bl_id
  ) AS calc ON calc.bl_id = b.id
  WHERE b.id = ANY(v_requested_bls);

  INSERT INTO public.invoice_items (
    invoice_id,
    charge_calculation_id,
    description,
    quantity,
    unit_value_brl,
    total_value_brl,
    bl_id,
    manifest_id,
    charge_table_id,
    charge_item_id,
    source,
    currency,
    unit_value_usd,
    total_value_usd,
    pricing_rule_version_id,
    billing_run_id,
    calculation_key,
    snapshot_payload
  )
  SELECT
    v_invoice_id,
    cc.id,
    CONCAT('BL ', cc.bl_id, ' - ', COALESCE(cti.name, cc.calculation_key, 'Linha de taxa')),
    COALESCE(cc.quantity, 1),
    COALESCE(cc.unit_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.unit_value_usd, 0) * v_roe, 2) END, 0),
    COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.total_value_usd, 0) * v_roe, 2) END, 0),
    cc.bl_id,
    cc.manifest_id,
    cc.charge_table_id,
    cc.charge_item_id,
    cc.source,
    COALESCE(cti.currency, CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN 'USD' ELSE 'BRL' END),
    cc.unit_value_usd,
    cc.total_value_usd,
    cc.pricing_rule_version_id,
    cc.billing_run_id,
    cc.calculation_key,
    jsonb_build_object(
      'manifest_id', cc.manifest_id,
      'bl_id', cc.bl_id,
      'charge_table_id', cc.charge_table_id,
      'charge_item_id', cc.charge_item_id,
      'source', cc.source,
      'currency', COALESCE(cti.currency, CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN 'USD' ELSE 'BRL' END),
      'pricing_rule_version_id', cc.pricing_rule_version_id,
      'calculation_key', cc.calculation_key,
      'charge_name', cti.name,
      'roe', CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN v_roe ELSE NULL END,
      'roe_effective_date', CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN v_roe_effective_date ELSE NULL END
    )
  FROM public.charge_calculations AS cc
  LEFT JOIN public.charge_table_items AS cti ON cti.id = cc.charge_item_id
  WHERE cc.bl_id = ANY(v_requested_bls)
    AND (COALESCE(cc.total_value_brl, 0) > 0 OR COALESCE(cc.total_value_usd, 0) > 0)
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt');

  GET DIAGNOSTICS v_item_count = ROW_COUNT;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Nenhuma linha BRL elegivel para faturamento.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(total_value_brl), 0)
  INTO v_total_brl
  FROM public.invoice_items
  WHERE invoice_id = v_invoice_id;

  UPDATE public.invoices
  SET
    total_brl = v_total_brl,
    total_paid_brl = 0,
    balance_brl = v_total_brl
  WHERE id = v_invoice_id;

  IF v_status = 'issued' THEN
    UPDATE public.bls
    SET financial_status = 'invoiced'
    WHERE id = ANY(v_requested_bls);
  END IF;

  IF v_batch_id IS NOT NULL THEN
    UPDATE public.billing_batches
    SET
      status = CASE WHEN v_status = 'issued' THEN 'issued' ELSE 'requested' END,
      invoice_id = v_invoice_id,
      notes = NULLIF(TRIM(COALESCE(p_notes, '')), '')
    WHERE id = v_batch_id;
  END IF;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
  )
  VALUES (
    'invoice',
    v_invoice_id::TEXT,
    'create_invoice',
    NULL,
    CONCAT('invoice=', v_invoice_number, ' | bl_count=', ARRAY_LENGTH(v_requested_bls, 1), ' | total=', v_total_brl),
    p_actor,
    now(),
    CASE WHEN COALESCE(p_origin, 'internal') = 'portal' THEN 'Emissao consolidada via portal do cliente' ELSE 'Emissao de invoice por B/L' END
  );

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'status', v_status,
    'customer_id', v_customer_id,
    'bl_count', ARRAY_LENGTH(v_requested_bls, 1),
    'total_brl', v_total_brl,
    'balance_brl', v_total_brl,
    'billing_batch_id', v_batch_id
  );
END;
$$;


-- Nao reafirma REVOKE/GRANT aqui de proposito: create_invoice_from_bls_core
-- so pode ser chamada pelos wrappers elevados (create_invoice_from_bls_core
-- migration 141_secure_billing_core_wrappers.sql), REVOKE ALL FROM PUBLIC,
-- anon, authenticated -- sem GRANT algum. CREATE OR REPLACE FUNCTION nao
-- reseta grants existentes, e reafirmar aqui quase introduziu uma regressao
-- de seguranca (GRANT EXECUTE TO authenticated abriria a core para chamada
-- direta, pulando o gate de admin dos wrappers) -- pego pelo teste
-- billingCoreWrapperPrivilegesMigration.test.ts.

-- ---------------------------------------------------------------------------
-- 6. create_local_consolidated_invoice_core: mesma conversao no caminho da
--    fatura consolidada (ledger).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_local_consolidated_invoice_core(
  p_customer_id bigint,
  p_receivable_ids bigint[],
  p_actor uuid DEFAULT NULL::uuid,
  p_origin text DEFAULT 'internal'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids BIGINT[];
  v_count INTEGER;
  v_invoice_id BIGINT;
  v_invoice_number TEXT;
  v_total NUMERIC(14,2);
  v_roe NUMERIC(10,4);
  v_roe_effective_date DATE;
BEGIN
  SELECT ARRAY_AGG(DISTINCT id ORDER BY id)
  INTO v_ids
  FROM UNNEST(COALESCE(p_receivable_ids, ARRAY[]::BIGINT[])) AS u(id)
  WHERE id IS NOT NULL;

  IF COALESCE(ARRAY_LENGTH(v_ids, 1), 0) < 1 THEN
    RAISE EXCEPTION 'Nenhum receivable informado para consolidar.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.bl_receivables WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;

  SELECT COUNT(*) INTO v_count FROM public.bl_receivables WHERE id = ANY(v_ids);
  IF v_count <> ARRAY_LENGTH(v_ids, 1) THEN
    RAISE EXCEPTION 'Receivable(s) inexistente(s) na selecao.' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_receivables WHERE id = ANY(v_ids) AND customer_id <> p_customer_id
  ) THEN
    RAISE EXCEPTION 'Selecao contem receivables de clientes diferentes.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_receivables
    WHERE id = ANY(v_ids) AND (status NOT IN ('open', 'partially_settled') OR balance_brl <= 0)
  ) THEN
    RAISE EXCEPTION 'Todos os receivables precisam estar abertos com saldo positivo.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_receivable_links l
    JOIN public.invoices inv ON inv.id = l.invoice_id
    WHERE l.receivable_id = ANY(v_ids)
      AND inv.invoice_type = 'consolidated'
      AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
  ) THEN
    RAISE EXCEPTION 'Um ou mais B/Ls ja estao em consolidada aberta.' USING ERRCODE = '23505';
  END IF;

  SELECT COALESCE(SUM(balance_brl), 0) INTO v_total
  FROM public.bl_receivables WHERE id = ANY(v_ids);

  INSERT INTO public.invoices (
    customer_id, bl_id, issued_at, due_date, total_brl, status, invoice_type,
    notes, total_paid_brl, balance_brl, issued_by
  )
  VALUES (
    p_customer_id, NULL, now(), NULL, v_total, 'issued', 'consolidated',
    NULL, 0, v_total, p_actor
  )
  RETURNING id, invoice_number INTO v_invoice_id, v_invoice_number;

  INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id, subtotal_brl, status, bl_snapshot)
  SELECT
    v_invoice_id, br.id, br.bl_id, br.balance_brl, 'active',
    jsonb_build_object('bl_id', br.bl_id, 'voyage_id', br.voyage_id, 'cargo_mode', br.cargo_mode, 'pol', br.pol, 'pod', br.pod)
  FROM public.bl_receivables br
  WHERE br.id = ANY(v_ids);

  -- Congela o detalhamento por item nesta consolidacao (achado 3 do ADR 0038).
  -- Mesma logica de reconciliacao que get_consolidated_invoice_item_breakdown e
  -- portal_invoice_details ja faziam ao vivo: linha por item quando a soma das
  -- linhas do B/L bate com o saldo consolidado; senao, uma linha agregada.
  --
  -- Etapa 11 do plano de faturamento (ADR 0038 decisao 6, achado 7): linhas em
  -- USD entram no detalhamento convertidas pelo ROE vigente na consolidacao,
  -- mesmo padrao do caminho individual (create_invoice_from_bls_core). Antes,
  -- o filtro total_value_brl > 0 excluia silenciosamente linhas USD-only do
  -- detalhamento (elas ja entravam no saldo do receivable via
  -- sync_local_charge_receivable, que agora tambem converte).
  SELECT roe, effective_date INTO v_roe, v_roe_effective_date
  FROM public.exchange_rate_reference WHERE id = 1;

  IF v_roe IS NULL AND EXISTS (
    SELECT 1
    FROM public.charge_calculations cc
    JOIN public.invoice_receivable_links l ON l.bl_id = cc.bl_id AND l.invoice_id = v_invoice_id
    LEFT JOIN public.charge_table_items cti ON cti.id = cc.charge_item_id
    WHERE COALESCE(cti.currency, 'BRL') = 'USD'
      AND COALESCE(cc.total_value_usd, 0) > 0
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt')
  ) THEN
    RAISE EXCEPTION 'Cambio (ROE) nao configurado; nao e possivel converter linhas em USD para consolidar.' USING ERRCODE = '22023';
  END IF;

  WITH links AS (
    SELECT l.bl_id, l.subtotal_brl
    FROM public.invoice_receivable_links l
    WHERE l.invoice_id = v_invoice_id
  ),
  calcs AS (
    SELECT
      cc.bl_id, cc.id AS charge_calculation_id, cc.charge_table_id, cc.charge_item_id,
      cc.quantity,
      COALESCE(cc.unit_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.unit_value_usd, 0) * v_roe, 2) END) AS unit_value_brl,
      COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.total_value_usd, 0) * v_roe, 2) END, 0) AS total_value_brl,
      cti.currency,
      cc.unit_value_usd, cc.total_value_usd, cc.calculation_key, cti.name AS charge_name
    FROM public.charge_calculations cc
    LEFT JOIN public.charge_table_items cti ON cti.id = cc.charge_item_id
    WHERE cc.bl_id IN (SELECT bl_id FROM links)
      AND (COALESCE(cc.total_value_brl, 0) > 0 OR COALESCE(cc.total_value_usd, 0) > 0)
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt')
  ),
  bl_recon AS (
    SELECT links.bl_id, links.subtotal_brl,
      COUNT(calcs.charge_calculation_id) AS calc_count,
      COALESCE(SUM(calcs.total_value_brl), 0) AS detailed_sum
    FROM links
    LEFT JOIN calcs ON calcs.bl_id = links.bl_id
    GROUP BY links.bl_id, links.subtotal_brl
  )
  INSERT INTO public.invoice_items (
    invoice_id, charge_calculation_id, description, quantity, unit_value_brl,
    total_value_brl, bl_id, charge_table_id, charge_item_id, source, currency,
    unit_value_usd, total_value_usd, calculation_key, snapshot_payload
  )
  SELECT
    v_invoice_id, calcs.charge_calculation_id,
    CONCAT('BL ', calcs.bl_id, ' - ', COALESCE(calcs.charge_name, calcs.calculation_key, 'Linha de taxa')),
    COALESCE(calcs.quantity, 1), calcs.unit_value_brl, calcs.total_value_brl,
    calcs.bl_id, calcs.charge_table_id, calcs.charge_item_id, 'ledger',
    COALESCE(calcs.currency, 'BRL'), calcs.unit_value_usd, calcs.total_value_usd,
    calcs.calculation_key,
    jsonb_build_object(
      'reconciled', true,
      'roe', CASE WHEN COALESCE(calcs.currency, 'BRL') = 'USD' THEN v_roe ELSE NULL END,
      'roe_effective_date', CASE WHEN COALESCE(calcs.currency, 'BRL') = 'USD' THEN v_roe_effective_date ELSE NULL END
    )
  FROM calcs
  JOIN bl_recon ON bl_recon.bl_id = calcs.bl_id
  WHERE bl_recon.calc_count > 0 AND ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01
  UNION ALL
  SELECT
    v_invoice_id, NULL, CONCAT('BL ', bl_recon.bl_id, ' - Taxas locais'),
    1, bl_recon.subtotal_brl, bl_recon.subtotal_brl,
    bl_recon.bl_id, NULL, NULL, 'ledger', 'BRL', NULL, NULL, NULL,
    jsonb_build_object('reconciled', false)
  FROM bl_recon
  WHERE NOT (bl_recon.calc_count > 0 AND ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01);

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
  VALUES (v_invoice_id, 'issued', p_actor,
    jsonb_build_object('invoice_type', 'consolidated', 'receivable_count', ARRAY_LENGTH(v_ids, 1), 'total_brl', v_total, 'origin', COALESCE(p_origin, 'internal')));

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('invoice', v_invoice_id::TEXT, 'create_consolidated', NULL,
    CONCAT('invoice=', v_invoice_number, ' | receivables=', ARRAY_LENGTH(v_ids, 1), ' | total=', v_total),
    p_actor, now(),
    CASE WHEN COALESCE(p_origin, 'internal') = 'portal' THEN 'Emissao de consolidada via portal do cliente' ELSE 'Emissao de consolidada via ledger' END);

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'status', 'issued',
    'invoice_type', 'consolidated',
    'receivable_count', ARRAY_LENGTH(v_ids, 1),
    'total_brl', v_total
  );
END;
$function$;


REVOKE ALL ON FUNCTION public.create_local_consolidated_invoice_core(bigint, bigint[], uuid, text) FROM PUBLIC, anon, authenticated;
