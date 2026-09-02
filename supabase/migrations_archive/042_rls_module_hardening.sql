-- Migration 042: Hardening de RLS nos módulos adicionados após migration 014.
--
-- Contexto: as migrations 028 (demurrage), 034 (granite), 035-036 (vazios) e
-- 039 (invoice_granite_bls) voltaram ao padrão antigo de políticas permissivas
-- (USING (true) ou USING (auth.role() = 'authenticated')), ignorando o modelo
-- role-based implantado em 010_rls_by_role e endurecido em 014.
-- Esta migration alinha todos esses módulos ao padrão vigente.
--
-- Também inclui:
-- - CHECK constraint de desconto percentual em demurrage_invoices
-- - Policy UPDATE ausente em demurrage_invoice_items
-- - Correção de portal_logout que engolia exceções silenciosamente

------------------------------------------------------------------------
-- demurrage_invoices: alinha ao padrão de invoices (014).
-- SELECT: qualquer ativo; INSERT/UPDATE/DELETE: apenas admin.
------------------------------------------------------------------------

DROP POLICY IF EXISTS "authenticated_read_demurrage_invoices"   ON public.demurrage_invoices;
DROP POLICY IF EXISTS "authenticated_insert_demurrage_invoices" ON public.demurrage_invoices;
DROP POLICY IF EXISTS "authenticated_update_demurrage_invoices" ON public.demurrage_invoices;
DROP POLICY IF EXISTS "authenticated_delete_demurrage_invoices" ON public.demurrage_invoices;

CREATE POLICY demurrage_invoices_select_active
  ON public.demurrage_invoices FOR SELECT
  TO authenticated USING (public.is_active_user());

CREATE POLICY demurrage_invoices_insert_admin
  ON public.demurrage_invoices FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY demurrage_invoices_update_admin
  ON public.demurrage_invoices FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY demurrage_invoices_delete_admin
  ON public.demurrage_invoices FOR DELETE
  TO authenticated USING (public.is_admin());

------------------------------------------------------------------------
-- demurrage_invoice_items: idem + adiciona policy UPDATE que estava faltando.
------------------------------------------------------------------------

DROP POLICY IF EXISTS "authenticated_read_demurrage_items"   ON public.demurrage_invoice_items;
DROP POLICY IF EXISTS "authenticated_insert_demurrage_items" ON public.demurrage_invoice_items;
DROP POLICY IF EXISTS "authenticated_delete_demurrage_items" ON public.demurrage_invoice_items;

CREATE POLICY demurrage_items_select_active
  ON public.demurrage_invoice_items FOR SELECT
  TO authenticated USING (public.is_active_user());

CREATE POLICY demurrage_items_insert_admin
  ON public.demurrage_invoice_items FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY demurrage_items_update_admin
  ON public.demurrage_invoice_items FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY demurrage_items_delete_admin
  ON public.demurrage_invoice_items FOR DELETE
  TO authenticated USING (public.is_admin());

------------------------------------------------------------------------
-- Módulo granite: tabelas operacionais → padrão operator_tables de 010.
-- SELECT/INSERT/UPDATE: is_active_user(); DELETE: is_admin().
------------------------------------------------------------------------

DO $$
DECLARE
  t TEXT;
  granite_tables TEXT[] := ARRAY[
    'granite_manifests', 'granite_bls', 'granite_rates', 'granite_bl_charges'
  ];
BEGIN
  FOREACH t IN ARRAY granite_tables LOOP
    -- Drop políticas antigas permissivas
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);

    -- Políticas role-based
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_user())',
      t || '_select_active', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_active_user())',
      t || '_insert_active', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user())',
      t || '_update_active', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_admin())',
      t || '_delete_admin', t
    );
  END LOOP;
END $$;

------------------------------------------------------------------------
-- invoice_granite_bls: idem (tabela financeira de vínculo).
------------------------------------------------------------------------

DROP POLICY IF EXISTS invoice_granite_bls_select ON public.invoice_granite_bls;
DROP POLICY IF EXISTS invoice_granite_bls_insert ON public.invoice_granite_bls;
DROP POLICY IF EXISTS invoice_granite_bls_update ON public.invoice_granite_bls;
DROP POLICY IF EXISTS invoice_granite_bls_delete ON public.invoice_granite_bls;

CREATE POLICY invoice_granite_bls_select_active
  ON public.invoice_granite_bls FOR SELECT
  TO authenticated USING (public.is_active_user());

CREATE POLICY invoice_granite_bls_insert_admin
  ON public.invoice_granite_bls FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY invoice_granite_bls_update_admin
  ON public.invoice_granite_bls FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY invoice_granite_bls_delete_admin
  ON public.invoice_granite_bls FOR DELETE
  TO authenticated USING (public.is_admin());

------------------------------------------------------------------------
-- Módulo vazios (035 e 036): tabelas operacionais → padrão operator_tables.
------------------------------------------------------------------------

DO $$
DECLARE
  t TEXT;
  vazios_tables TEXT[] := ARRAY[
    'vazios_manifests', 'vazios_bookings',
    'vazios_importacao_manifests', 'vazios_importacao_containers'
  ];
BEGIN
  FOREACH t IN ARRAY vazios_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_user())',
      t || '_select_active', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_active_user())',
      t || '_insert_active', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user())',
      t || '_update_active', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_admin())',
      t || '_delete_admin', t
    );
  END LOOP;
END $$;

------------------------------------------------------------------------
-- CHECK constraint: desconto percentual não pode ultrapassar 100%.
-- Evita total_brl negativo em computeTotalBRL().
------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'demurrage_invoices_discount_percent_check'
  ) THEN
    ALTER TABLE public.demurrage_invoices
      ADD CONSTRAINT demurrage_invoices_discount_percent_check
        CHECK (
          discount_mode IS NULL
          OR discount_mode != 'percent'
          OR (discount_value >= 0 AND discount_value <= 100)
        );
  END IF;
END $$;

------------------------------------------------------------------------
-- portal_logout: remover EXCEPTION WHEN OTHERS que engolia erros reais.
-- Erros genuínos devem propagar; sessão inválida é tratada por
-- resolve_customer_portal_session() que já lança '28000'.
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.portal_logout(p_session_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session RECORD;
BEGIN
  SELECT *
    INTO v_session
    FROM public.resolve_customer_portal_session(p_session_token)
    LIMIT 1;

  UPDATE public.customer_portal_sessions
    SET revoked_at = now()
    WHERE id = v_session.session_id;

  RETURN jsonb_build_object('revoked', true);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_logout(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_logout(TEXT) TO anon, authenticated;
