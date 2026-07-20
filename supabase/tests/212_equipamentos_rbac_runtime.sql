\set ON_ERROR_STOP on

-- Execute com psql -f depois do replay completo em PostgreSQL descartavel.
-- Reaplicar 212 primeiro comprova a idempotencia da correcao.
\ir ../migrations/212_fix_equipamentos_rbac_contract.sql

BEGIN;

DO $runtime$
DECLARE
  v_rpc REGPROCEDURE;
  v_definition TEXT;
  v_public_execute BOOLEAN;
  v_read_rpcs CONSTANT REGPROCEDURE[] := ARRAY[
    'public.list_bl_local_charge_lines(text)'::REGPROCEDURE,
    'public.list_manual_charge_items_for_bl(text)'::REGPROCEDURE,
    'public.get_billing_run_details(bigint)'::REGPROCEDURE,
    'public.list_customer_reconciliation_queue(text,integer)'::REGPROCEDURE,
    'public.list_consolidatable_receivables(bigint,bigint,text)'::REGPROCEDURE,
    'public.get_consolidated_invoice_item_breakdown(bigint)'::REGPROCEDURE,
    'public.bl_timeline(text,integer,integer)'::REGPROCEDURE,
    'public.get_customer_portal_account(bigint)'::REGPROCEDURE,
    'public.get_bl_portal_status(text)'::REGPROCEDURE
  ];
  v_internal_writes CONSTANT REGPROCEDURE[] := ARRAY[
    'public.ensure_pricing_rule_version(bigint,bigint,bigint,date,jsonb)'::REGPROCEDURE,
    'public.sync_customer_reconciliation_queue_for_bl(text)'::REGPROCEDURE,
    'public.insert_billing_run_log(bigint,bigint,text,text,text,text,jsonb)'::REGPROCEDURE,
    'public.link_invoice_to_ledger(bigint)'::REGPROCEDURE
  ];
BEGIN
  FOREACH v_rpc IN ARRAY v_read_rpcs
  LOOP
    v_definition := pg_get_functiondef(v_rpc::OID);
    IF position('is_active_read_user()' IN v_definition) = 0
       OR position('is_active_user()' IN v_definition) > 0 THEN
      RAISE EXCEPTION 'Gate de leitura incorreto em %.', v_rpc;
    END IF;
    IF NOT has_function_privilege('authenticated', v_rpc::OID, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated perdeu EXECUTE de leitura em %.', v_rpc;
    END IF;
  END LOOP;

  FOREACH v_rpc IN ARRAY v_internal_writes
  LOOP
    IF has_function_privilege('authenticated', v_rpc::OID, 'EXECUTE')
       OR has_function_privilege('anon', v_rpc::OID, 'EXECUTE') THEN
      RAISE EXCEPTION 'Helper interno ainda executavel por cliente: %.', v_rpc;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM pg_proc AS p
      CROSS JOIN LATERAL aclexplode(
        COALESCE(p.proacl, acldefault('f', p.proowner))
      ) AS privilege
      WHERE p.oid = v_rpc::OID
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    )
    INTO v_public_execute;

    IF v_public_execute THEN
      RAISE EXCEPTION 'PUBLIC ainda executa helper interno: %.', v_rpc;
    END IF;
  END LOOP;

  v_rpc := 'public.save_exchange_rate_reference(numeric,numeric,date)'::REGPROCEDURE;
  IF NOT has_function_privilege('authenticated', v_rpc::OID, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_rpc::OID, 'EXECUTE') THEN
    RAISE EXCEPTION 'RPC externo de cambio perdeu grants legitimos.';
  END IF;
END;
$runtime$;

INSERT INTO auth.users (id, email)
VALUES
  ('00000000-0000-4000-8000-000000000211', 'rbac-equipamentos@example.invalid'),
  ('00000000-0000-4000-8000-000000000212', 'rbac-documentacao@example.invalid'),
  ('00000000-0000-4000-8000-000000000213', 'rbac-administrativo@example.invalid')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profiles (id, full_name, role, active)
VALUES
  ('00000000-0000-4000-8000-000000000211', 'Teste Equipamentos', 'equipamentos', true),
  ('00000000-0000-4000-8000-000000000212', 'Teste Documentacao', 'documentacao', true),
  ('00000000-0000-4000-8000-000000000213', 'Teste Administrativo', 'administrativo', true)
ON CONFLICT (id) DO UPDATE
SET full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    active = EXCLUDED.active;

DELETE FROM public.vazios_reorg_rates
WHERE id IN (
  '00000000-0000-4000-8000-000000000212',
  '00000000-0000-4000-8000-000000000213',
  '00000000-0000-4000-8000-000000000214'
);

INSERT INTO public.vazios_reorg_rates (id, service, rate_brl, valid_from)
VALUES (
  '00000000-0000-4000-8000-000000000213',
  'visual_check',
  20,
  DATE '2026-07-19'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000211',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $equipamentos$
DECLARE
  v_denied BOOLEAN := false;
  v_rows INTEGER;
BEGIN
  -- Prova comportamental representativa do gate de leitura.
  PERFORM 1 FROM public.bl_timeline('__rbac_probe__', 1, 0);

  BEGIN
    PERFORM public.save_exchange_rate_reference(5.10, 5.4315, DATE '2026-07-19');
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'Equipamentos escreveu referencia cambial.';
  END IF;

  v_denied := false;
  BEGIN
    INSERT INTO public.vazios_reorg_rates (id, service, rate_brl, valid_from)
    VALUES (
      '00000000-0000-4000-8000-000000000214',
      'bundle',
      10,
      DATE '2026-07-19'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'Equipamentos inseriu tarifa de reorganizacao.';
  END IF;

  UPDATE public.vazios_reorg_rates
  SET rate_brl = 99
  WHERE id = '00000000-0000-4000-8000-000000000213';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'Equipamentos atualizou tarifa de reorganizacao.';
  END IF;

  DELETE FROM public.vazios_reorg_rates
  WHERE id = '00000000-0000-4000-8000-000000000213';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'Equipamentos excluiu tarifa admin-only.';
  END IF;
END;
$equipamentos$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000212',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $documentacao$
DECLARE
  v_rows INTEGER;
BEGIN
  PERFORM public.save_exchange_rate_reference(5.20, 5.5380, DATE '2026-07-19');

  INSERT INTO public.vazios_reorg_rates (id, service, rate_brl, valid_from)
  VALUES (
    '00000000-0000-4000-8000-000000000212',
    'bundle',
    10,
    DATE '2026-07-19'
  );

  UPDATE public.vazios_reorg_rates
  SET rate_brl = 12
  WHERE id = '00000000-0000-4000-8000-000000000212';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Documentacao nao atualizou tarifa.';
  END IF;

  DELETE FROM public.vazios_reorg_rates
  WHERE id = '00000000-0000-4000-8000-000000000212';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'Documentacao excluiu tarifa admin-only.';
  END IF;
END;
$documentacao$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000213',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $administrativo$
DECLARE
  v_rows INTEGER;
BEGIN
  PERFORM public.save_exchange_rate_reference(5.30, 5.6445, DATE '2026-07-19');

  DELETE FROM public.vazios_reorg_rates
  WHERE id IN (
    '00000000-0000-4000-8000-000000000212',
    '00000000-0000-4000-8000-000000000213'
  );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'Administrativo nao excluiu as duas tarifas.';
  END IF;
END;
$administrativo$;

RESET ROLE;

DO $final_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.exchange_rate_reference
    WHERE id = 1
      AND ptax = 5.30
      AND roe = 5.6445
      AND effective_date = DATE '2026-07-19'
  ) THEN
    RAISE EXCEPTION 'Perfis nao Equipamentos nao preservaram escrita cambial.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.vazios_reorg_rates
    WHERE id IN (
      '00000000-0000-4000-8000-000000000212',
      '00000000-0000-4000-8000-000000000213',
      '00000000-0000-4000-8000-000000000214'
    )
  ) THEN
    RAISE EXCEPTION 'Tarifas de teste nao respeitaram o ciclo esperado.';
  END IF;
END;
$final_assertions$;

ROLLBACK;

SELECT 'RBAC Equipamentos runtime OK' AS result;
