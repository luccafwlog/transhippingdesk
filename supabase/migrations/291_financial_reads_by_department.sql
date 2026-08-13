-- Migration 291: alinha a RLS financeira ao modelo de cinco perfis de
-- roleHasPermission() (src/hooks/useAuth.tsx) e ao CONTEXT.md.
--
-- Contexto (docs/archive/audits/2026-08-13-rbac-departamentos-visualizacao.md):
-- 014_lock_down_financial_reads_and_audit_writes restringiu o SELECT de sete
-- tabelas financeiras a is_admin(), e 020/066/111 estenderam o mesmo padrao a
-- mais seis. is_admin() so reconhece 'admin' e 'administrativo'
-- (040_portal_login_rate_limit.sql), entao financeiro, operacoes,
-- documentacao e equipamentos abriam Taxas Locais, Faturamento, Relatorios,
-- Conciliacao PIX e a aba Financeiro da Ficha do Cliente e recebiam listas
-- vazias -- RLS filtra linhas, nao devolve erro, entao o sintoma parecia
-- ausencia de dado, nao falta de permissao.
--
-- CONTEXT.md ("Visualizacao global interna", "Escopo de Documentacao") define
-- que a restricao por departamento e de escrita: todo perfil interno ativo
-- deve enxergar todos os registros; a permissao de alterar e que muda por
-- papel.
--
-- Secao 1 alinha o SELECT a essa definicao, para as 13 tabelas restritas por
-- 014/020/066/111. Usa is_active_read_user(), nao is_active_user(): a
-- segunda foi redefinida em 211_equipamentos_rbac_hardening para excluir o
-- papel 'equipamentos', que por CONTEXT.md tem leitura no restante do
-- sistema.
--
-- Secao 2 corrige uma inconsistencia exposta pela secao 1: charge_tables,
-- charge_table_items e customer_rate_overrides (Taxas Locais) tinham
-- INSERT/UPDATE/DELETE travados em is_admin() desde 010_rls_by_role, um
-- resquicio do modelo antigo admin/operator. roleHasPermission ja concede as
-- permissoes 'charge_tables' e 'charge_overrides' para 'documentacao' (e
-- CONTEXT.md inclui "taxas" no escopo de Documentacao); sem esta correcao,
-- abrir a leitura da Secao 1 so exporia controles de edicao que falham com
-- RLS 42501 ao salvar. O padrao segue 215_rbac_voyages_customers_writes: uma
-- funcao can_edit_local_charges() alinhada ao permission set do frontend,
-- aplicada a INSERT/UPDATE/DELETE (Taxas Locais nao distingue excluir de
-- editar na UI nem na permissao).
--
-- Nenhuma outra policy de INSERT/UPDATE/DELETE e tocada -- invoices,
-- payments, demurrage etc. continuam exigindo is_admin() ou o helper de
-- escrita especifico do modulo.
--
-- Rollback: recriar as policies de SELECT substituidas com
-- USING (public.is_admin()) sob o sufixo _select_admin; recriar as policies
-- de INSERT/UPDATE/DELETE de charge_tables/charge_table_items/
-- customer_rate_overrides com USING/WITH CHECK (public.is_admin()) sob o
-- sufixo _admin; dropar can_edit_local_charges().

------------------------------------------------------------------------
-- Secao 1: leitura financeira para todo perfil interno ativo.
------------------------------------------------------------------------

DO $$
DECLARE
  t TEXT;
  financial_read_tables TEXT[] := ARRAY[
    'charge_tables',
    'charge_table_items',
    'customer_rate_overrides',
    'charge_calculations',
    'invoices',
    'invoice_items',
    'payments',
    'invoice_bls',
    'bl_receivables',
    'invoice_receivable_links',
    'ledger_settlements',
    'invoice_lifecycle_events',
    'invoice_refunds'
  ];
BEGIN
  FOREACH t IN ARRAY financial_read_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_admin', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_read_user())',
      t || '_select_read', t
    );
  END LOOP;
END $$;

------------------------------------------------------------------------
-- Secao 2: escrita de Taxas Locais para quem tem 'charge_tables' /
-- 'charge_overrides' em roleHasPermission (administrativo, documentacao,
-- e o legado 'operator' que o frontend trata como documentacao).
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_edit_local_charges()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE id = auth.uid()
      AND active = true
      AND role IN ('admin', 'administrativo', 'operator', 'documentacao')
  );
$$;

REVOKE ALL ON FUNCTION public.can_edit_local_charges() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_edit_local_charges() TO authenticated;

DO $$
DECLARE
  t TEXT;
  local_charge_tables TEXT[] := ARRAY[
    'charge_tables',
    'charge_table_items',
    'customer_rate_overrides'
  ];
BEGIN
  FOREACH t IN ARRAY local_charge_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert_admin', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update_admin', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete_admin', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_edit_local_charges())',
      t || '_insert_local_charges', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.can_edit_local_charges()) WITH CHECK (public.can_edit_local_charges())',
      t || '_update_local_charges', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.can_edit_local_charges())',
      t || '_delete_local_charges', t
    );
  END LOOP;
END $$;
