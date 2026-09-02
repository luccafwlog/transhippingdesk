-- 257: Fecha vazamentos para o Portal do Cliente encontrados na auditoria de
-- seguranca de 2026-08-05 (relatorio em docs/archive/audits/).
--
-- Raiz comum, ja documentada na migration 192: o cliente do Portal autentica
-- pelo Supabase Auth e recebe o MESMO role `authenticated` do usuario interno.
-- Logo, todo objeto que confia apenas em "estar autenticado" -- policy
-- USING (true) ou funcao SECURITY DEFINER sem guarda -- e legivel pelo cliente.
-- A fronteira efetiva e `is_active_read_user()`, que exige linha ativa em
-- `user_profiles`; conta de Portal vive em `customer_portal_accounts` e nunca
-- satisfaz essa condicao.
--
-- Lembrete herdado de 192: `REVOKE ... FROM anon` NAO remove o EXECUTE default
-- concedido a PUBLIC. Toda revogacao aqui inclui PUBLIC explicitamente.
--
-- Rollback: reconceder os EXECUTE ou restaurar as policies USING (true)
-- reabre os vazamentos; nao fazer sem substituir por controle equivalente.

-- ---------------------------------------------------------------------------
-- 1. list_billing_runs: expunha o historico de faturamento da operacao inteira
--    (arquivo de manifesto, contagens de B/L, totais BRL/USD) a qualquer sessao
--    autenticada. Guarda no WHERE, no mesmo padrao ja usado por `bl_timeline`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_billing_runs(p_limit INTEGER DEFAULT 50)
RETURNS TABLE(
  id BIGINT, manifest_id BIGINT, filename TEXT, trigger_source TEXT, status TEXT,
  started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, total_bls INTEGER,
  eligible_bls INTEGER, blocked_bls INTEGER, calculated_bls INTEGER,
  total_brl NUMERIC, total_usd NUMERIC
)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
  SELECT
    br.id, br.manifest_id, ib.filename, br.trigger_source, br.status,
    br.started_at, br.completed_at, br.total_bls, br.eligible_bls,
    br.blocked_bls, br.calculated_bls, br.total_brl, br.total_usd
  FROM public.billing_runs AS br
  JOIN public.import_batches AS ib ON ib.id = br.manifest_id
  WHERE public.is_active_read_user()
  ORDER BY br.started_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 50), 1);
$fn$;

REVOKE ALL ON FUNCTION public.list_billing_runs(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_billing_runs(INTEGER) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. mark_overdue_invoices: a migration 031 concedeu EXECUTE apenas a
--    `service_role`, mas o ALTER DEFAULT PRIVILEGES do projeto ja tinha
--    concedido `authenticated` na criacao -- e `REVOKE ... FROM PUBLIC` nao
--    remove grant explicito de role. Resultado: qualquer sessao autenticada,
--    inclusive cliente do Portal, podia virar TODA fatura `issued` vencida
--    para `overdue`, de todos os Clientes.
--
--    Aqui a fronteira e o grant, nao uma guarda no corpo: a funcao roda no job
--    `mark-overdue-invoices` do pg_cron, que executa sem JWT (`auth.role()` e
--    `auth.uid()` nulos). Uma guarda por identidade quebraria o job diario.
--    O corpo permanece exatamente como 157 o deixou.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.mark_overdue_invoices() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_overdue_invoices() TO service_role;

-- ---------------------------------------------------------------------------
-- 3. check_provision_rate_limit: SECURITY DEFINER que GRAVA, sem guarda e
--    aceitando `p_user_id` arbitrario. Uma sessao autenticada podia esgotar o
--    limite de provisionamento de qualquer usuario interno (negacao de servico)
--    e inflar `provision_rate_limit_log` indefinidamente. Nao tem chamador no
--    app; o consumo previsto e por Edge Function, que usa `service_role`.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.check_provision_rate_limit(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_provision_rate_limit(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. bl_has_portal_release: helper interno do portao de CE Mercante. Exposto a
--    `authenticated`, era um oraculo sobre B/L de QUALQUER Cliente (revelava se
--    um B/L arbitrario tem CE Mercante), permitindo enumeracao e inferencia
--    entre Clientes. Os sete chamadores sao SECURITY DEFINER e executam como
--    owner, entao a revogacao nao altera o comportamento do Portal.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.bl_has_portal_release(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bl_has_portal_release(TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. vessel_schedules e ended_vessels: unicas policies de SELECT com
--    USING (true) do schema. Davam leitura integral ao cliente do Portal e
--    contornavam o portao `voyages.show_on_portal`, que decide o que o Cliente
--    pode ver na programacao. As policies de escrita ja exigiam usuario interno
--    e permanecem intactas.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "vessel_schedules_select_authenticated" ON public.vessel_schedules;
DROP POLICY IF EXISTS "vessel_schedules_select_internal" ON public.vessel_schedules;
CREATE POLICY "vessel_schedules_select_internal" ON public.vessel_schedules
  FOR SELECT TO authenticated
  USING (public.is_active_read_user());

DROP POLICY IF EXISTS "Authenticated users can view ended vessels" ON public.ended_vessels;
DROP POLICY IF EXISTS "ended_vessels_select_internal" ON public.ended_vessels;
CREATE POLICY "ended_vessels_select_internal" ON public.ended_vessels
  FOR SELECT TO authenticated
  USING (public.is_active_read_user());
