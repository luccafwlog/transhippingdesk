-- 015: atomicidade da ingestao por unidade (S04, D03).
--
-- D03: datas/CE por B/L (B/Ls independentes), cadastro por cliente,
-- conjunto fisico do Baplie por viagem. Falha em qualquer linha/auditoria/
-- pertencimento aborta so a unidade, sem parcial.
--
-- Contratos:
--   apply_container_dates_atomic(uuid,text,jsonb,uuid) -> jsonb
--     {request_id, bl_id, updated_ids, unchanged_ids, billing_state}
--   apply_baplie_physical_flags_atomic(bigint,jsonb,uuid) -> jsonb
--     {voyage_id, updated_ids, applied}
--
-- Notas:
-- - Autor e sempre auth.uid() no servidor; p_changed_by precisa coincidir.
-- - Flags derivam de restaging no servidor; p_changes e so filtro opcional
--   de container_numbers, nunca valores/previous do browser.
-- - Evento semantico unico por unidade na mesma transacao; a trilha por linha
--   do trigger audit_row_changes continua legitima e correlacionada.
-- - No-op nao cria auditoria ficticia; falha de auditoria desfaz a unidade.

-- Gatilho recuperavel minimo para S05 consumir (outbox completo vive em 017).
-- ponytail: tabela estreita so para nao perder o efeito pos-commit; S05 amplia.
CREATE TABLE IF NOT EXISTS public.import_pending_effects (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_action_id uuid NOT NULL,
  effect_kind text NOT NULL
    CHECK (effect_kind IN (
      'physical_flags', 'provisional_charges', 'local_billing',
      'granite_billing', 'demurrage_billing', 'vehicle_followup'
    )),
  entity_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'retry_wait', 'blocked', 'succeeded', 'superseded')),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT import_pending_effects_identity_key UNIQUE (source_action_id, effect_kind, entity_id)
);

ALTER TABLE public.import_pending_effects ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'import_pending_effects'
      AND policyname = 'import_pending_effects_select_active'
  ) THEN
    CREATE POLICY import_pending_effects_select_active
      ON public.import_pending_effects FOR SELECT TO authenticated
      USING (public.is_active_read_user());
  END IF;
END
$$;

-- Sem escrita direta do browser: so leitura interna; escrita via RPCs definer.
-- (Nenhuma policy de INSERT/UPDATE/DELETE para authenticated.)

CREATE OR REPLACE FUNCTION public.apply_container_dates_atomic(
  p_request_id uuid,
  p_bl_id text,
  p_rows jsonb,
  p_changed_by uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_bl_id text := NULLIF(btrim(COALESCE(p_bl_id, '')), '');
  v_count integer := 0;
  v_item jsonb;
  v_num text;
  v_discharge text;
  v_return text;
  v_exp_discharge text;
  v_exp_return text;
  v_seen text[] := ARRAY[]::text[];
  v_updated bigint[] := ARRAY[]::bigint[];
  v_unchanged bigint[] := ARRAY[]::bigint[];
  v_billing_state text := 'pending';
  v_remaining integer;
  r record;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF v_bl_id IS NULL THEN
    RAISE EXCEPTION 'B/L obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Lote de datas invalido.' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count = 0 OR v_count > 500 THEN
    RAISE EXCEPTION 'Lote deve ter entre 1 e 500 linhas.' USING ERRCODE = '22023';
  END IF;

  -- B/L lock ordenado primeiro: serializa unidades do mesmo B/L.
  PERFORM 1 FROM public.bls WHERE id = v_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', v_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- Validacao de dominio + duplicata conflitante no payload.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Linha de datas invalida.' USING ERRCODE = '22023';
    END IF;
    v_num := upper(btrim(COALESCE(v_item->>'container_number', '')));
    v_discharge := NULLIF(btrim(COALESCE(v_item->>'discharge_date', '')), '');
    v_return := NULLIF(btrim(COALESCE(v_item->>'return_date', '')), '');
    IF v_num IS NULL OR v_num = '' THEN
      RAISE EXCEPTION 'Container obrigatorio no B/L %.', v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_discharge IS NULL OR v_discharge !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR v_discharge::date IS NULL THEN
      RAISE EXCEPTION 'Data de descarga invalida para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_return IS NOT NULL AND (v_return !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_return::date IS NULL) THEN
      RAISE EXCEPTION 'Data de devolucao invalida para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF v_return IS NOT NULL AND v_return::date < v_discharge::date THEN
      RAISE EXCEPTION 'Devolucao anterior a descarga para % no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    -- Duplicata conflitante aborta a unidade (nao "ultimo vence" silencioso).
    FOR r IN SELECT t.container_number, t.discharge_date, t.return_date
             FROM jsonb_to_recordset(p_rows) AS t(container_number text, discharge_date text, return_date text)
             WHERE upper(btrim(COALESCE(t.container_number, ''))) = v_num
    LOOP
      IF upper(btrim(COALESCE(r.container_number, ''))) = v_num THEN
        IF btrim(COALESCE(r.discharge_date, '')) IS DISTINCT FROM btrim(COALESCE(v_discharge, ''))
           OR NULLIF(btrim(COALESCE(r.return_date, '')), '') IS DISTINCT FROM v_return THEN
          RAISE EXCEPTION 'Container % duplicado com datas conflitantes no B/L %.', v_num, v_bl_id USING ERRCODE = '22023';
        END IF;
      END IF;
    END LOOP;
    IF NOT (v_num = ANY (v_seen)) THEN
      v_seen := array_append(v_seen, v_num);
    END IF;
  END LOOP;

  -- Aplica por container, com lock ordenado das linhas e checagem de
  -- pertencimento + preview obsoleto. Qualquer erro aborta a unidade inteira.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_num := upper(btrim(COALESCE(v_item->>'container_number', '')));
    v_discharge := NULLIF(btrim(COALESCE(v_item->>'discharge_date', '')), '');
    v_return := NULLIF(btrim(COALESCE(v_item->>'return_date', '')), '');
    v_exp_discharge := NULLIF(btrim(COALESCE(v_item->>'expected_discharge_date', '')), '');
    v_exp_return := NULLIF(btrim(COALESCE(v_item->>'expected_return_date', '')), '');

    SELECT c.id, c.discharge_date::text, c.return_date::text, c.demurrage_status
      INTO r
      FROM public.bl_containers AS c
      WHERE c.bl_id = v_bl_id AND upper(btrim(c.container_number)) = v_num
      ORDER BY c.id
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Container % nao pertence ao B/L %.', v_num, v_bl_id USING ERRCODE = 'P0002';
    END IF;

    -- Preview obsoleto: o chamador enviou o estado que viu; se mudou, aborta.
    IF v_exp_discharge IS NOT NULL AND (r.discharge_date IS DISTINCT FROM v_exp_discharge) THEN
      RAISE EXCEPTION 'Preview obsoleto para % no B/L %: recarregue e reconfira.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;
    IF (v_item ? 'expected_return_date') AND (r.return_date IS DISTINCT FROM v_exp_return) THEN
      RAISE EXCEPTION 'Preview obsoleto para % no B/L %: recarregue e reconfira.', v_num, v_bl_id USING ERRCODE = '22023';
    END IF;

    IF (r.discharge_date IS NOT DISTINCT FROM v_discharge)
       AND (r.return_date IS DISTINCT FROM v_return) = false THEN
      v_unchanged := array_append(v_unchanged, r.id);
      CONTINUE;
    END IF;

    UPDATE public.bl_containers AS c
      SET discharge_date = v_discharge::date,
          return_date = v_return::date,
          -- Sem valor financeiro livre: devolvido vira 'returned',
          -- sem devolucao preserva o estado (o faturamento recalcula).
          demurrage_status = CASE WHEN v_return IS NOT NULL THEN 'returned' ELSE c.demurrage_status END
      WHERE c.id = r.id;
    v_updated := array_append(v_updated, r.id);
  END LOOP;

  -- Reconsulta o conjunto COMPLETO do B/L (nao so os IDs enviados) antes de
  -- classificar prontidao de emissao.
  SELECT count(*) INTO v_remaining
    FROM public.bl_containers AS c
    WHERE c.bl_id = v_bl_id AND c.return_date IS NULL;
  IF v_remaining = 0 THEN
    v_billing_state := 'ready_for_billing';
  ELSE
    v_billing_state := 'pending';
  END IF;

  v_role := public.current_actor_role();

  -- Evento semantico unico por unidade, mesma transacao. No-op nao audita.
  IF cardinality(v_updated) > 0 THEN
    INSERT INTO public.audit_logs(
      entity_type, entity_id, field_name, old_value, new_value,
      changed_by, justification, actor_role, actor_department
    ) VALUES (
      'bl', v_bl_id, 'container_dates_import',
      jsonb_build_object('request_id', p_request_id, 'bl_id', v_bl_id)::text,
      jsonb_build_object(
        'request_id', p_request_id, 'bl_id', v_bl_id,
        'updated_ids', COALESCE(v_updated, ARRAY[]::bigint[]),
        'unchanged_ids', COALESCE(v_unchanged, ARRAY[]::bigint[]),
        'billing_state', v_billing_state
      )::text,
      v_actor, 'Importacao de datas por B/L (atomica)', v_role, v_role
    );

    -- Gatilho recuperavel S05 na mesma transacao quando pronto para faturar.
    IF v_billing_state = 'ready_for_billing' THEN
      INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by)
      VALUES (p_request_id, 'demurrage_billing', v_bl_id, v_actor)
      ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'request_id', p_request_id,
    'bl_id', v_bl_id,
    'updated_ids', COALESCE(v_updated, ARRAY[]::bigint[]),
    'unchanged_ids', COALESCE(v_unchanged, ARRAY[]::bigint[]),
    'billing_state', v_billing_state
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_container_dates_atomic(uuid, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_container_dates_atomic(uuid, text, jsonb, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_baplie_physical_flags_atomic(
  p_voyage_id bigint,
  p_changes jsonb,
  p_changed_by uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_filter text[] := NULL;
  v_item jsonb;
  v_num text;
  v_updated bigint[] := ARRAY[]::bigint[];
  v_staged_imo boolean;
  v_staged_class text;
  v_staged_un text;
  v_staged_oog boolean;
  v_matches bigint[];
  v_current record;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_voyage_id IS NULL THEN
    RAISE EXCEPTION 'Viagem obrigatoria.' USING ERRCODE = '22023';
  END IF;

  -- Serializa o conjunto fisico por viagem.
  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem % nao encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;

  -- p_changes e so filtro opcional; valores/previous do browser sao ignorados:
  -- o desejado deriva do restaging no servidor abaixo.
  IF p_changes IS NOT NULL THEN
    IF jsonb_typeof(p_changes) <> 'array' THEN
      RAISE EXCEPTION 'Filtro de flags invalido.' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_changes)
    LOOP
      IF jsonb_typeof(v_item) = 'string' THEN
        v_num := upper(btrim(v_item #>> '{}'));
      ELSE
        v_num := upper(btrim(COALESCE(v_item->>'container_number', '')));
      END IF;
      IF v_num IS NOT NULL AND v_num <> '' THEN
        v_filter := array_append(v_filter, v_num);
      END IF;
    END LOOP;
  END IF;

  -- Deriva do staging: full prevalece, IMO/OOG por OR, ultima classe/ONU nao
  -- nula. Sem IMO, classe/ONU zeram (regra do reconciliador).
  FOR v_num, v_staged_imo, v_staged_class, v_staged_un, v_staged_oog IN
    SELECT
      upper(btrim(s.container_number)),
      bool_or(COALESCE(s.is_imo, false)),
      max(s.imo_class) FILTER (WHERE s.imo_class IS NOT NULL),
      max(s.un_number) FILTER (WHERE s.un_number IS NOT NULL),
      bool_or(COALESCE(s.is_oog, false))
    FROM public.baplie_containers AS s
    WHERE s.voyage_id = p_voyage_id
      AND s.status = 'full'
      AND upper(btrim(s.container_number)) ~ '^[A-Z]{4}[0-9]{7}$'
    GROUP BY upper(btrim(s.container_number))
    ORDER BY 1
  LOOP
    IF v_filter IS NOT NULL AND NOT (v_num = ANY (v_filter)) THEN
      CONTINUE;
    END IF;
    IF NOT v_staged_imo THEN
      v_staged_class := NULL;
      v_staged_un := NULL;
    END IF;

    -- Casa com exatamente um bl_container da viagem; 0 ou 2+ viram
    -- divergencia de existencia, nao update arbitrario.
    SELECT COALESCE(array_agg(c.id ORDER BY c.id), ARRAY[]::bigint[])
      INTO v_matches
      FROM public.bl_containers AS c
      JOIN public.bls AS b ON b.id = c.bl_id
      WHERE b.voyage_id = p_voyage_id
        AND upper(btrim(c.container_number)) = v_num;

    IF cardinality(v_matches) <> 1 THEN
      CONTINUE;
    END IF;

    SELECT c.is_imo, c.imo_class, c.un_number, c.is_oog
      INTO v_current
      FROM public.bl_containers AS c
      WHERE c.id = v_matches[1]
      FOR UPDATE;

    IF v_staged_imo IS NOT DISTINCT FROM COALESCE(v_current.is_imo, false)
       AND v_staged_oog IS NOT DISTINCT FROM COALESCE(v_current.is_oog, false)
       AND upper(COALESCE(v_staged_class, '')) IS NOT DISTINCT FROM upper(COALESCE(v_current.imo_class, ''))
       AND upper(COALESCE(v_staged_un, '')) IS NOT DISTINCT FROM upper(COALESCE(v_current.un_number, '')) THEN
      CONTINUE;
    END IF;

    UPDATE public.bl_containers AS c
      SET is_imo = v_staged_imo,
          imo_class = v_staged_class,
          un_number = v_staged_un,
          is_oog = v_staged_oog
      WHERE c.id = v_matches[1];
    v_updated := array_append(v_updated, v_matches[1]);
  END LOOP;

  -- No-op nao cria mudanca ficticia nem evento.
  IF cardinality(v_updated) = 0 THEN
    RETURN jsonb_build_object(
      'voyage_id', p_voyage_id,
      'updated_ids', ARRAY[]::bigint[],
      'applied', 0
    );
  END IF;

  v_role := public.current_actor_role();

  -- Um unico evento de intencao por viagem, mesma transacao. A trilha por
  -- coluna do trigger audit_row_changes continua (legitima, correlacionada).
  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, justification, actor_role, actor_department
  ) VALUES (
    'voyage', p_voyage_id::text, 'baplie_physical_flags',
    jsonb_build_object('voyage_id', p_voyage_id)::text,
    jsonb_build_object(
      'voyage_id', p_voyage_id,
      'updated_ids', v_updated,
      'applied', cardinality(v_updated)
    )::text,
    v_actor, 'Baplie soberano: flags fisicas aplicadas (conjunto atomico)', v_role, v_role
  );

  INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by)
  VALUES (gen_random_uuid(), 'provisional_charges', p_voyage_id::text, v_actor);

  RETURN jsonb_build_object(
    'voyage_id', p_voyage_id,
    'updated_ids', v_updated,
    'applied', cardinality(v_updated)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_baplie_physical_flags_atomic(bigint, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_baplie_physical_flags_atomic(bigint, jsonb, uuid) TO authenticated;
