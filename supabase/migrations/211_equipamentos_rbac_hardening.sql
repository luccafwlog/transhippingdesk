-- RBAC: Equipamentos pode ler os dados internos, mas so escreve Veiculos e
-- VAZIOS EXP. A UI nao e fronteira de seguranca: policies e RPCs tambem
-- precisam negar chamadas diretas. Tarifas de reorganizacao continuam fora do
-- escopo operacional de Equipamentos.

-- O contrato amplo de "ativo" passa a excluir Equipamentos. Assim toda RPC
-- SECURITY DEFINER que ja valida is_active_user() herda o bloqueio sem uma
-- lista incompleta de overrides.
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND active = true AND role <> 'equipamentos'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_read_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_equipamentos_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND active = true AND role = 'equipamentos'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_non_equipamentos_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND active = true AND role <> 'equipamentos'
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_read_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_equipamentos_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_non_equipamentos_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_read_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_equipamentos_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_non_equipamentos_user() TO authenticated;

-- Policies permissivas sao combinadas por OR. Recria apenas as que usam o
-- gate amplo, o predicado legado exato de authenticated ou true em escrita,
-- para que Equipamentos nao herde escrita fora da allowlist. Policies
-- restritivas e predicados compostos permanecem intactos.
DO $$
DECLARE
  p RECORD;
  v_roles TEXT;
  v_qual TEXT;
  v_check TEXT;
  v_read_qual TEXT;
  v_write_qual TEXT;
  v_write_check TEXT;
  v_qual_normalized TEXT;
  v_check_normalized TEXT;
  v_as_clause TEXT;
  v_name TEXT;
  allowed_tables TEXT[] := ARRAY[
    'vehicles', 'vazios_manifests', 'vazios_bookings',
    'vazios_export_operations', 'vazios_export_overtime_depots',
    'vazios_reorg_services'
  ];
  -- 'vazios_reorg_rates' fica fora da allowlist: e configuracao tarifaria.
BEGIN
  FOR p IN
    SELECT *
    FROM pg_policies AS policy
    WHERE schemaname = 'public'
      AND tablename <> ALL (allowed_tables)
      AND policy.cmd IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND policy.permissive = 'PERMISSIVE'
      AND (
        COALESCE(qual, '') LIKE '%is_active_user()%' OR
        COALESCE(with_check, '') LIKE '%is_active_user()%' OR
        lower(regexp_replace(COALESCE(qual, ''), '[[:space:]()]', '', 'g')) IN (
          'auth.role()=''authenticated''',
          'auth.role()=''authenticated''::text',
          'selectauth.role()=''authenticated''',
          'selectauth.role()=''authenticated''::text'
        ) OR
        lower(regexp_replace(COALESCE(with_check, ''), '[[:space:]()]', '', 'g')) IN (
          'auth.role()=''authenticated''',
          'auth.role()=''authenticated''::text',
          'selectauth.role()=''authenticated''',
          'selectauth.role()=''authenticated''::text'
        ) OR (
          policy.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL') AND (
            lower(regexp_replace(COALESCE(qual, ''), '[[:space:]()]', '', 'g')) = 'true' OR
            lower(regexp_replace(COALESCE(with_check, ''), '[[:space:]()]', '', 'g')) = 'true'
          )
        )
      )
  LOOP
    v_roles := array_to_string(p.roles, ', ');
    v_qual := COALESCE(p.qual, 'true');
    v_check := COALESCE(p.with_check, 'true');
    v_qual_normalized := lower(regexp_replace(v_qual, '[[:space:]()]', '', 'g'));
    v_check_normalized := lower(regexp_replace(v_check, '[[:space:]()]', '', 'g'));
    v_read_qual := CASE
      WHEN v_qual_normalized IN ('auth.role()=''authenticated''', 'auth.role()=''authenticated''::text', 'selectauth.role()=''authenticated''', 'selectauth.role()=''authenticated''::text') THEN 'public.is_active_read_user()'
      ELSE replace(v_qual, 'is_active_user()', 'is_active_read_user()')
    END;
    v_write_qual := CASE
      WHEN v_qual_normalized IN ('auth.role()=''authenticated''', 'auth.role()=''authenticated''::text', 'selectauth.role()=''authenticated''', 'selectauth.role()=''authenticated''::text') OR (p.cmd IN ('UPDATE', 'DELETE', 'ALL') AND v_qual_normalized = 'true') THEN 'public.is_active_non_equipamentos_user()'
      ELSE replace(v_qual, 'is_active_user()', 'is_active_non_equipamentos_user()')
    END;
    v_write_check := CASE
      WHEN v_check_normalized IN ('auth.role()=''authenticated''', 'auth.role()=''authenticated''::text', 'selectauth.role()=''authenticated''', 'selectauth.role()=''authenticated''::text') OR (p.cmd IN ('INSERT', 'UPDATE', 'ALL') AND v_check_normalized = 'true') THEN 'public.is_active_non_equipamentos_user()'
      ELSE replace(v_check, 'is_active_user()', 'is_active_non_equipamentos_user()')
    END;
    v_as_clause := '';

    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);

    IF p.cmd = 'ALL' THEN
      v_name := left(p.policyname, 48);
      EXECUTE format('CREATE POLICY %I ON public.%I%s FOR SELECT TO %s USING (%s)',
        v_name || '_equip_read', p.tablename, v_as_clause, v_roles,
        v_read_qual);
      EXECUTE format('CREATE POLICY %I ON public.%I%s FOR INSERT TO %s WITH CHECK (%s)',
        v_name || '_equip_insert', p.tablename, v_as_clause, v_roles, v_write_check);
      EXECUTE format('CREATE POLICY %I ON public.%I%s FOR UPDATE TO %s USING (%s) WITH CHECK (%s)',
        v_name || '_equip_update', p.tablename, v_as_clause, v_roles, v_write_qual, v_write_check);
      EXECUTE format('CREATE POLICY %I ON public.%I%s FOR DELETE TO %s USING (%s)',
        v_name || '_equip_delete', p.tablename, v_as_clause, v_roles, v_write_qual);
    ELSIF p.cmd = 'SELECT' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I%s FOR SELECT TO %s USING (%s)',
        p.policyname, p.tablename, v_as_clause, v_roles,
        v_read_qual);
    ELSIF p.cmd = 'INSERT' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I%s FOR INSERT TO %s WITH CHECK (%s)',
        p.policyname, p.tablename, v_as_clause, v_roles, v_write_check);
    ELSIF p.cmd = 'UPDATE' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I%s FOR UPDATE TO %s USING (%s) WITH CHECK (%s)',
        p.policyname, p.tablename, v_as_clause, v_roles, v_write_qual, v_write_check);
    ELSIF p.cmd = 'DELETE' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I%s FOR DELETE TO %s USING (%s)',
        p.policyname, p.tablename, v_as_clause, v_roles, v_write_qual);
    END IF;
  END LOOP;
END $$;

-- A allowlist e deliberadamente pequena. As policies permissivas se combinam
-- por OR, portanto Vazios EXP precisa remover tambem as policies abertas da
-- migration 035 e qualquer variante autenticada que tenha sobrevivido.
DO $$
DECLARE
  t TEXT;
  p RECORD;
  allowlisted_tables TEXT[] := ARRAY[
    'vehicles', 'vazios_manifests', 'vazios_bookings',
    'vazios_export_operations', 'vazios_export_overtime_depots',
    'vazios_reorg_services'
  ];
BEGIN
  -- Remove inclusive policies legadas de 004 e as criadas por esta migration;
  -- uma nova aplicacao nao pode falhar nem combinar permissivamente por OR.
  FOR p IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = ANY (allowlisted_tables)
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['vehicles'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_read_user())', t || '_select_active', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_active_user() OR public.is_equipamentos_user())', t || '_insert_active', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_active_user() OR public.is_equipamentos_user()) WITH CHECK (public.is_active_user() OR public.is_equipamentos_user())', t || '_update_active', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_admin())', t || '_delete_admin', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['vazios_manifests', 'vazios_bookings'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_read_user())', t || '_select_active', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_active_user() OR public.is_equipamentos_user())', t || '_insert_active', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_active_user() OR public.is_equipamentos_user()) WITH CHECK (public.is_active_user() OR public.is_equipamentos_user())', t || '_update_active', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_admin())', t || '_delete_admin', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['vazios_export_operations', 'vazios_export_overtime_depots', 'vazios_reorg_services'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_read_user())', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_active_user() OR public.is_equipamentos_user())', t || '_insert_equipamentos', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_active_user() OR public.is_equipamentos_user()) WITH CHECK (public.is_active_user() OR public.is_equipamentos_user())', t || '_update_equipamentos', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_admin())', t || '_delete_admin', t);
  END LOOP;
END $$;

-- Tarifas de reorganizacao sao configuracao administrativa. Remove todas as
-- policies anteriores para que uma policy permissiva residual nao reabra
-- INSERT, UPDATE ou DELETE por combinacao OR.
DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'vazios_reorg_rates'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.vazios_reorg_rates', p.policyname);
  END LOOP;

  CREATE POLICY vazios_reorg_rates_select_active
    ON public.vazios_reorg_rates FOR SELECT TO authenticated
    USING (public.is_active_read_user());
  CREATE POLICY vazios_reorg_rates_insert_admin
    ON public.vazios_reorg_rates FOR INSERT TO authenticated
    WITH CHECK (public.is_admin());
  CREATE POLICY vazios_reorg_rates_update_admin
    ON public.vazios_reorg_rates FOR UPDATE TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());
  CREATE POLICY vazios_reorg_rates_delete_admin
    ON public.vazios_reorg_rates FOR DELETE TO authenticated
    USING (public.is_admin());
END $$;

CREATE OR REPLACE FUNCTION public.import_vehicle_rows_transactional(p_rows JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count INTEGER := COALESCE(jsonb_array_length(p_rows), 0);
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_active_user() OR public.is_equipamentos_user()) THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para importar veiculos.' USING ERRCODE = '42501';
  END IF;
  IF v_count = 0 THEN RETURN 0; END IF;
  INSERT INTO public.vehicles (voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm)
  SELECT row.voyage_id, row.container_id, row.bl_id, row.chassis, row.brand, row.model, row.weight_kg, row.cbm
  FROM jsonb_to_recordset(p_rows) AS row(voyage_id BIGINT, container_id BIGINT, bl_id TEXT, chassis TEXT, brand TEXT, model TEXT, weight_kg NUMERIC, cbm NUMERIC);
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.import_vazios_bookings_transactional(p_voyage_id BIGINT, p_description TEXT, p_uploaded_by UUID, p_bookings JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_manifest_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_active_user() OR public.is_equipamentos_user()) OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar bookings.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.vazios_manifests (voyage_id, description, total_bookings, imported_by)
  VALUES (p_voyage_id, p_description, jsonb_array_length(COALESCE(p_bookings, '[]'::JSONB)), p_uploaded_by) RETURNING id INTO v_manifest_id;
  INSERT INTO public.vazios_bookings (manifest_id, booking_number, container_number, container_type, movement_date, origin_terminal, destination, notes, embark_port, depot, material, bundle, transporte, hand_in_date, hand_out_date, overtime_handling, overtime_transport)
  SELECT v_manifest_id, item.booking_number, item.container_number, item.container_type, item.movement_date, item.origin_terminal, item.destination, item.notes, item.embark_port, item.depot, COALESCE(item.material, FALSE), COALESCE(item.bundle, FALSE), COALESCE(item.transporte, FALSE), item.hand_in_date, item.hand_out_date, COALESCE(item.overtime_handling, FALSE), COALESCE(item.overtime_transport, FALSE)
  FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS item(booking_number TEXT, container_number TEXT, container_type TEXT, movement_date DATE, origin_terminal TEXT, destination TEXT, notes TEXT, embark_port TEXT, depot TEXT, material BOOLEAN, bundle BOOLEAN, transporte BOOLEAN, hand_in_date DATE, hand_out_date DATE, overtime_handling BOOLEAN, overtime_transport BOOLEAN);
  RETURN jsonb_build_object('manifest_id', v_manifest_id);
END;
$$;

REVOKE ALL ON FUNCTION public.import_vehicle_rows_transactional(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_vazios_bookings_transactional(BIGINT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_vehicle_rows_transactional(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_vazios_bookings_transactional(BIGINT, TEXT, UUID, JSONB) TO authenticated;
