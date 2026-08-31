\set ON_ERROR_STOP on

\ir ../migrations/363_revoke_direct_access_to_privileged_alert_rpcs.sql

BEGIN;

DO $test$
DECLARE
  v_rpc REGPROCEDURE;
  v_client_rpcs CONSTANT REGPROCEDURE[] := ARRAY[
    'public.portal_billing_gate(text)'::REGPROCEDURE,
    'public.get_voyage_eligible_pods(bigint)'::REGPROCEDURE,
    'public.refresh_voyage_status_from_terminal_scales(bigint)'::REGPROCEDURE
  ];
BEGIN
  FOREACH v_rpc IN ARRAY v_client_rpcs LOOP
    IF has_function_privilege('anon', v_rpc::OID, 'EXECUTE')
       OR has_function_privilege('authenticated', v_rpc::OID, 'EXECUTE') THEN
      RAISE EXCEPTION 'RPC privilegiada ainda executável por cliente: %.', v_rpc;
    END IF;
    IF NOT has_function_privilege('service_role', v_rpc::OID, 'EXECUTE') THEN
      RAISE EXCEPTION 'RPC interna perdeu EXECUTE de service_role: %.', v_rpc;
    END IF;
  END LOOP;

  v_rpc := 'public.get_voyage_first_brazilian_eta(bigint)'::REGPROCEDURE;
  IF NOT has_function_privilege('authenticated', v_rpc::OID, 'EXECUTE')
     OR has_function_privilege('anon', v_rpc::OID, 'EXECUTE')
     OR position('is_active_read_user()' IN pg_get_functiondef(v_rpc::OID)) = 0 THEN
    RAISE EXCEPTION 'RPC interna de ETA perdeu grant ou guarda: %.', v_rpc;
  END IF;
END;
$test$;

ROLLBACK;
