-- Corrige o contrato RBAC introduzido por 211 sem reabrir escrita geral para
-- Equipamentos. Leituras autenticadas continuam usando as definicoes finais
-- ja aplicadas; helpers de escrita internos deixam de ser RPCs publicos.

-- As nove funcoes abaixo sao extensas e foram definidas em migrations
-- diferentes. Recria cada funcao a partir da definicao exata do catalogo,
-- trocando somente o helper de autenticacao. CREATE OR REPLACE preserva OID,
-- assinatura, atributos e ACL; a migration tambem pode ser reaplicada.
DO $migration$
DECLARE
  v_read_rpc REGPROCEDURE;
  v_definition TEXT;
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
BEGIN
  FOREACH v_read_rpc IN ARRAY v_read_rpcs
  LOOP
    v_definition := pg_get_functiondef(v_read_rpc::OID);

    IF position('is_active_user()' IN v_definition) > 0 THEN
      v_definition := replace(v_definition, 'is_active_user()', 'is_active_read_user()');
      EXECUTE v_definition;
    ELSIF position('is_active_read_user()' IN v_definition) = 0 THEN
      RAISE EXCEPTION
        'RPC de leitura % nao possui o gate ativo esperado; migration abortada.',
        v_read_rpc;
    END IF;
  END LOOP;
END;
$migration$;

-- Helpers chamados apenas por funcoes/triggers SECURITY DEFINER do mesmo
-- owner. O owner conserva EXECUTE implicitamente; clientes autenticados nao
-- podem mais invocar diretamente essas escritas que ignoram RLS.
REVOKE EXECUTE ON FUNCTION public.ensure_pricing_rule_version(bigint,bigint,bigint,date,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_customer_reconciliation_queue_for_bl(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.insert_billing_run_log(bigint,bigint,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.link_invoice_to_ledger(bigint) FROM PUBLIC, anon, authenticated;

-- Este RPC e usado diretamente pelo frontend ao atualizar PTAX/ROE. Mantem
-- service_role e todos os perfis internos ativos, exceto Equipamentos.
CREATE OR REPLACE FUNCTION public.save_exchange_rate_reference(
  p_ptax NUMERIC,
  p_roe NUMERIC,
  p_effective_date DATE
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_active_non_equipamentos_user() THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.exchange_rate_reference (id, ptax, roe, effective_date, updated_at)
  VALUES (1, p_ptax, p_roe, p_effective_date, now())
  ON CONFLICT (id) DO UPDATE
  SET ptax = EXCLUDED.ptax,
      roe = EXCLUDED.roe,
      effective_date = EXCLUDED.effective_date,
      updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.save_exchange_rate_reference(numeric,numeric,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_exchange_rate_reference(numeric,numeric,date) TO authenticated, service_role;

-- 211 tornou INSERT/UPDATE de tarifas admin-only por engano. Reconstroi o
-- conjunto completo para impedir que uma policy permissiva residual combine
-- por OR: leitura para ativos, escrita nao destrutiva para ativos fora de
-- Equipamentos e DELETE somente para Administrativo.
DO $policies$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vazios_reorg_rates'
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON public.vazios_reorg_rates',
      v_policy.policyname
    );
  END LOOP;

  CREATE POLICY vazios_reorg_rates_select_active
    ON public.vazios_reorg_rates FOR SELECT TO authenticated
    USING (public.is_active_read_user());
  CREATE POLICY vazios_reorg_rates_insert_non_equipamentos
    ON public.vazios_reorg_rates FOR INSERT TO authenticated
    WITH CHECK (public.is_active_non_equipamentos_user());
  CREATE POLICY vazios_reorg_rates_update_non_equipamentos
    ON public.vazios_reorg_rates FOR UPDATE TO authenticated
    USING (public.is_active_non_equipamentos_user())
    WITH CHECK (public.is_active_non_equipamentos_user());
  CREATE POLICY vazios_reorg_rates_delete_admin
    ON public.vazios_reorg_rates FOR DELETE TO authenticated
    USING (public.is_admin());
END;
$policies$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vazios_reorg_rates TO authenticated;
