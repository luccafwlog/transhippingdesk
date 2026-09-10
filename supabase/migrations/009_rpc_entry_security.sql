-- 009: fecha as fronteiras de segurança auditadas em #659.2 e #660.1/3.
--
-- Fonte das definições: supabase/migrations/002_business_logic_and_security.sql
-- (nunca editada). Aqui apenas CREATE OR REPLACE com guardas antecipadas +
-- REVOKE explícito. Mesmas assinaturas, mesmas mensagens de erro: chamador
-- legítimo não muda de comportamento; chamador ilegítimo é negado mais cedo.
--
--   - upsert_portal_invoice_exception(bigint,text): helper de trigger; o
--     EXECUTE herdado é revogado de PUBLIC/anon/authenticated. As chamadas
--     internas (trg_portal_invoice_exception_open/_invoice_bl, SECURITY
--     DEFINER do dono) seguem funcionando.
--   - portal_get_session_overview_v2(): valida identidade/revogação pelo mesmo
--     contrato de current_portal_customer_id() ANTES do UPDATE de
--     last_login_at; token revogado não hidrata nem deixa rastro de login.
--   - current_portal_customer_id(): iat ausente/malformado com revogação ativa
--     nega fechado com a mensagem genérica (nunca vaza o cast).
--   - save_voyage_escala_terminal_state_v2() e
--     import_bl_freight_transactional(): guardas antecipadas idênticas às dos
--     núcleos, antes de ler payload/tabelas/criar porto/delegar.

-- ===========================================================================
-- current_portal_customer_id(): iat ilegível/ausente com revogação nega fechado
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.current_portal_customer_id() RETURNS bigint
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_customer_id bigint;
  v_revoked_at timestamptz;
  v_issued_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  SELECT a.customer_id, a.credentials_revoked_at
  INTO v_customer_id, v_revoked_at
  FROM public.customer_portal_accounts AS a
  WHERE a.auth_user_id = auth.uid()
    AND a.active = true;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  IF v_revoked_at IS NOT NULL THEN
    -- ponytail: sem iat confiável não há como provar emissão pós-revogação;
    -- nega fechado em vez de vazar o cast da claim.
    BEGIN
      v_issued_at := to_timestamp(NULLIF(auth.jwt() ->> 'iat', '')::double precision);
    EXCEPTION WHEN OTHERS THEN
      v_issued_at := NULL;
    END;
    IF v_issued_at IS NULL OR v_issued_at < v_revoked_at - interval '5 seconds' THEN
      RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
    END IF;
  END IF;

  RETURN v_customer_id;
END;
$$;


-- ===========================================================================
-- portal_get_session_overview_v2(): revogação antes do UPDATE de last_login_at
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.portal_get_session_overview_v2() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_account  RECORD;
  v_customer RECORD;
BEGIN
  -- S01: identidade e revogação pelo mesmo contrato de
  -- current_portal_customer_id(), antes de qualquer leitura mutável: um token
  -- recusado não pode deixar rastro em last_login_at.
  PERFORM public.current_portal_customer_id();

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  SELECT a.id, a.customer_id, a.active, a.contact_email, a.login_cnpj
  INTO v_account
  FROM public.customer_portal_accounts AS a
  WHERE a.auth_user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessao do portal invalida ou expirada.' USING ERRCODE = '28000';
  END IF;

  IF NOT v_account.active THEN
    RAISE EXCEPTION 'Acesso ao portal desativado. Entre em contato com o suporte.' USING ERRCODE = '28000';
  END IF;

  SELECT c.id, c.name, c.cnpj_cpf, c.pending_balance
  INTO v_customer
  FROM public.customers AS c
  WHERE c.id = v_account.customer_id;

  UPDATE public.customer_portal_accounts
  SET last_login_at = now()
  WHERE id = v_account.id;

  RETURN jsonb_build_object(
    'customer_id',       v_customer.id,
    'customer_name',     v_customer.name,
    'customer_cnpj_cpf', v_customer.cnpj_cpf,
    'cnpj_cpf',          v_customer.cnpj_cpf,
    'pending_balance',   v_customer.pending_balance,
    'contact_email',     v_account.contact_email,
    'account_id',        v_account.id,
    'login_cnpj',        v_account.login_cnpj
  );
END;
$$;


-- ===========================================================================
-- save_voyage_escala_terminal_state_v2(): permissão do núcleo na fronteira
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.save_voyage_escala_terminal_state_v2(p_voyage_id bigint, p_port text, p_expected_revision integer, p_fronts jsonb, p_terminals jsonb, p_export_expectation jsonb, p_justification text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_legacy JSONB;
  v_non_tbc JSONB;
  v_port TEXT := upper(btrim(COALESCE(p_port, '')));
  v_port_id BIGINT;
  v_revision INTEGER;
  v_role TEXT;
  v_terminal JSONB;
  v_terminal_id UUID;
BEGIN
  -- S01: mesma permissão do núcleo save_voyage_escala_terminal_state, na
  -- fronteira pública: antes de validar payload, criar porto ou delegar. A
  -- segurança passa a morar na autorização, não só no rollback.
  SELECT up.role INTO v_role
  FROM public.user_profiles AS up
  WHERE up.id = auth.uid() AND up.active = TRUE;

  IF auth.uid() IS NULL OR v_role IS NULL
     OR v_role NOT IN ('admin', 'administrativo', 'operacoes', 'operator', 'documentacao', 'equipamentos', 'financeiro') THEN
    RAISE EXCEPTION 'Usuario ativo sem permissao para editar a escala.'
      USING ERRCODE = '42501';
  END IF;

  IF p_terminals IS NULL OR jsonb_typeof(p_terminals) <> 'array' THEN
    RAISE EXCEPTION 'Payload de Atracacoes invalido.' USING ERRCODE = '22023';
  END IF;

  SELECT p.id INTO v_port_id
  FROM public.ports AS p
  WHERE upper(btrim(p.locode)) = v_port
  LIMIT 1;
  IF v_port_id IS NULL THEN
    INSERT INTO public.ports (name, locode, country)
    VALUES (v_port, v_port, 'Brasil')
    RETURNING id INTO v_port_id;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'terminal_id', item->>'terminal_id',
    'terminal_atb', item->>'terminal_atb',
    'terminal_atd', item->>'terminal_atd',
    'terminal_rtw', item->>'terminal_rtw'
  )), '[]'::JSONB)
  INTO v_non_tbc
  FROM jsonb_array_elements(p_terminals) AS entries(item)
  WHERE NULLIF(entries.item->>'terminal_id', '') IS NOT NULL;

  -- O RPC legado não pode interpretar NULL com igualdade simples: uma linha
  -- TBC não deve ser considerada removida nem bloquear uma edição que só
  -- altera a expectativa de exportação. O patch abaixo mantém essa regra no
  -- corpo legado, sem duplicar sua implementação nesta migration.
  v_legacy := public.save_voyage_escala_terminal_state(
    p_voyage_id,
    v_port,
    p_expected_revision,
    p_fronts,
    v_non_tbc,
    p_export_expectation,
    p_justification
  );

  IF COALESCE((v_legacy->>'blocked')::BOOLEAN, FALSE) THEN
    RETURN v_legacy;
  END IF;

  SELECT rs.revision INTO v_revision
  FROM public.voyage_escala_revision_state AS rs
  WHERE rs.voyage_id = p_voyage_id AND rs.port = v_port;

  FOR v_terminal IN SELECT value FROM jsonb_array_elements(p_terminals)
  LOOP
    v_terminal_id := NULLIF(v_terminal->>'terminal_id', '')::UUID;
    IF v_terminal_id IS NULL THEN
      INSERT INTO public.voyage_escala_terminal_state (
        voyage_id, port, port_id, terminal_id, terminal_etb, terminal_atb,
        terminal_etd, terminal_atd, terminal_rtw, revision
      ) VALUES (
        p_voyage_id, v_port, v_port_id, NULL,
        NULLIF(v_terminal->>'terminal_etb', '')::TIMESTAMPTZ,
        NULLIF(v_terminal->>'terminal_atb', '')::TIMESTAMPTZ,
        NULLIF(v_terminal->>'terminal_etd', '')::TIMESTAMPTZ,
        NULLIF(v_terminal->>'terminal_atd', '')::TIMESTAMPTZ,
        NULLIF(v_terminal->>'terminal_rtw', '')::INTEGER,
        COALESCE(v_revision, 0)
      )
      ON CONFLICT (voyage_id, port) WHERE terminal_id IS NULL DO UPDATE SET
        terminal_etb = EXCLUDED.terminal_etb,
        terminal_atb = EXCLUDED.terminal_atb,
        terminal_etd = EXCLUDED.terminal_etd,
        terminal_atd = EXCLUDED.terminal_atd,
        terminal_rtw = EXCLUDED.terminal_rtw,
        revision = EXCLUDED.revision,
        updated_at = now();
    ELSE
      UPDATE public.voyage_escala_terminal_state
      SET terminal_etb = NULLIF(v_terminal->>'terminal_etb', '')::TIMESTAMPTZ,
          terminal_etd = NULLIF(v_terminal->>'terminal_etd', '')::TIMESTAMPTZ,
          revision = COALESCE(v_revision, revision),
          updated_at = now()
      WHERE voyage_id = p_voyage_id AND port = v_port AND terminal_id = v_terminal_id;
    END IF;
  END LOOP;

  -- O status da viagem deixa de depender do atd documental do POD. A função
  -- é criada na migration de alertas seguinte e existe antes de qualquer
  -- chamada operacional desta RPC.
  PERFORM public.refresh_voyage_status_from_terminal_scales(p_voyage_id);

  RETURN jsonb_set(
    v_legacy,
    '{terminals}',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'terminal_id', s.terminal_id,
        'terminal_etb', s.terminal_etb,
        'terminal_atb', s.terminal_atb,
        'terminal_etd', s.terminal_etd,
        'terminal_atd', s.terminal_atd,
        'terminal_rtw', s.terminal_rtw
      ) ORDER BY s.terminal_atb NULLS LAST, s.terminal_etb NULLS LAST, s.terminal_id NULLS LAST)
      FROM public.voyage_escala_terminal_state AS s
      WHERE s.voyage_id = p_voyage_id AND s.port = v_port
    ), '[]'::JSONB),
    TRUE
  );
END;
$$;


-- ===========================================================================
-- import_bl_freight_transactional(): guarda do núcleo no ponto de entrada
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional(p_bls jsonb, p_changed_by uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_result JSONB;
  v_item JSONB;
  v_bl_id TEXT;
  v_next TEXT[];
  v_current TEXT[];
  v_voyage_ids BIGINT[] := ARRAY[]::BIGINT[];
  v_voyage_id BIGINT;
BEGIN
  -- S01: guarda antecipada idêntica à de
  -- import_bl_freight_transactional_legacy_205, antes de ler payload/tabelas,
  -- configurar sessão ou delegar.
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para importar frete do BL.'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT b.voyage_id ORDER BY b.voyage_id), ARRAY[]::BIGINT[])
  INTO v_voyage_ids
  FROM public.bls AS b
  WHERE b.id IN (
    SELECT item->>'id'
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::JSONB)) AS item
    WHERE item->>'id' IS NOT NULL
  )
    AND b.voyage_id IS NOT NULL;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'on', true);
  v_result := public.import_bl_freight_transactional_legacy_357(p_bls, p_changed_by);

  FOR v_item IN SELECT item FROM jsonb_array_elements(COALESCE(p_bls, '[]'::JSONB)) AS item
  LOOP
    v_bl_id := v_item->>'id';
    CONTINUE WHEN v_bl_id IS NULL;

    v_next := public.normalize_ncm_codes(v_item->'ncm_codes');
    CONTINUE WHEN cardinality(v_next) = 0;

    SELECT ncm_codes INTO v_current FROM public.bls WHERE id = v_bl_id;
    CONTINUE WHEN NOT FOUND;
    CONTINUE WHEN v_current = v_next;

    UPDATE public.bls SET ncm_codes = v_next WHERE id = v_bl_id;

    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES (
      'bl',
      v_bl_id,
      'ncm_codes',
      array_to_string(COALESCE(v_current, ARRAY[]::TEXT[]), ', '),
      array_to_string(v_next, ', '),
      p_changed_by,
      'NCM declarado no documento reimportado'
    );
  END LOOP;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'off', true);

  SELECT v_voyage_ids || COALESCE(array_agg(DISTINCT b.voyage_id ORDER BY b.voyage_id), ARRAY[]::BIGINT[])
  INTO v_voyage_ids
  FROM public.bls AS b
  WHERE b.id IN (
    SELECT item->>'id'
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::JSONB)) AS item
    WHERE item->>'id' IS NOT NULL
  )
    AND b.voyage_id IS NOT NULL;

  FOR v_voyage_id IN
    SELECT DISTINCT ids.voyage_id
    FROM unnest(v_voyage_ids) AS ids(voyage_id)
    WHERE ids.voyage_id IS NOT NULL
    ORDER BY ids.voyage_id
  LOOP
    PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'baplie_coverage_import');
  END LOOP;

  RETURN v_result;
END;
$$;


-- ===========================================================================
-- Grants: reafirmar o fechado nas substituídas; fechar o helper de trigger
-- ===========================================================================

REVOKE ALL ON FUNCTION public.portal_get_session_overview_v2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_get_session_overview_v2() TO authenticated;

REVOKE ALL ON FUNCTION public.save_voyage_escala_terminal_state_v2(p_voyage_id bigint, p_port text, p_expected_revision integer, p_fronts jsonb, p_terminals jsonb, p_export_expectation jsonb, p_justification text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_voyage_escala_terminal_state_v2(p_voyage_id bigint, p_port text, p_expected_revision integer, p_fronts jsonb, p_terminals jsonb, p_export_expectation jsonb, p_justification text) TO authenticated;

REVOKE ALL ON FUNCTION public.import_bl_freight_transactional(p_bls jsonb, p_changed_by uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bl_freight_transactional(p_bls jsonb, p_changed_by uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.upsert_portal_invoice_exception(bigint, text) FROM PUBLIC, anon, authenticated;


-- ===========================================================================
-- Verificação executável: contrato das três fronteiras + helper sem EXECUTE
-- ===========================================================================

DO $verify_009$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('portal_get_session_overview_v2',
                      'save_voyage_escala_terminal_state_v2',
                      'import_bl_freight_transactional')
    AND (NOT p.prosecdef
         OR p.proconfig IS NULL
         OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
         OR has_function_privilege('anon', p.oid, 'EXECUTE'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '009: funcao fora do contrato: %', v_bad;
  END IF;
  IF has_function_privilege('anon', 'public.upsert_portal_invoice_exception(bigint,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.upsert_portal_invoice_exception(bigint,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '009: upsert_portal_invoice_exception segue executável fora do trigger.';
  END IF;
END;
$verify_009$;
