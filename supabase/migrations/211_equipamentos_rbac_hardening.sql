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

-- Policies permissivas sao combinadas por OR. Recria qualquer policy vigente
-- que use o gate amplo para que Equipamentos nao herde escrita fora da
-- allowlist, sem mudar o resultado para os demais perfis ativos.
DO $$
DECLARE
  p RECORD;
  v_roles TEXT;
  v_qual TEXT;
  v_check TEXT;
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
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename <> ALL (allowed_tables)
      AND cmd IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND (
        COALESCE(qual, '') LIKE '%is_active_user()%' OR
        COALESCE(with_check, '') LIKE '%is_active_user()%'
      )
  LOOP
    v_roles := array_to_string(p.roles, ', ');
    v_qual := replace(COALESCE(p.qual, 'true'), 'is_active_user()', 'is_active_non_equipamentos_user()');
    v_check := replace(COALESCE(p.with_check, 'true'), 'is_active_user()', 'is_active_non_equipamentos_user()');
    v_as_clause := CASE WHEN p.permissive = 'PERMISSIVE' THEN '' ELSE ' AS RESTRICTIVE' END;

    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);

    IF p.cmd = 'ALL' THEN
      v_name := left(p.policyname, 48);
      EXECUTE format('CREATE POLICY %I ON public.%I%s FOR SELECT TO %s USING (%s)',
        v_name || '_equip_read', p.tablename, v_as_clause, v_roles,
        replace(COALESCE(p.qual, 'true'), 'is_active_user()', 'is_active_read_user()'));
      EXECUTE format('CREATE POLICY %I ON public.%I%s FOR INSERT TO %s WITH CHECK (%s)',
        v_name || '_equip_insert', p.tablename, v_as_clause, v_roles, v_check);
      EXECUTE format('CREATE POLICY %I ON public.%I%s FOR UPDATE TO %s USING (%s) WITH CHECK (%s)',
        v_name || '_equip_update', p.tablename, v_as_clause, v_roles, v_qual, v_check);
      EXECUTE format('CREATE POLICY %I ON public.%I%s FOR DELETE TO %s USING (%s)',
        v_name || '_equip_delete', p.tablename, v_as_clause, v_roles, v_qual);
    ELSIF p.cmd = 'SELECT' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I%s FOR SELECT TO %s USING (%s)',
        p.policyname, p.tablename, v_as_clause, v_roles,
        replace(COALESCE(p.qual, 'true'), 'is_active_user()', 'is_active_read_user()'));
    ELSIF p.cmd = 'INSERT' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I%s FOR INSERT TO %s WITH CHECK (%s)',
        p.policyname, p.tablename, v_as_clause, v_roles, v_check);
    ELSIF p.cmd = 'UPDATE' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I%s FOR UPDATE TO %s USING (%s) WITH CHECK (%s)',
        p.policyname, p.tablename, v_as_clause, v_roles, v_qual, v_check);
    END IF;
  END LOOP;
END $$;

-- A allowlist e deliberadamente pequena. Leitura segue o helper proprio;
-- delete continua admin em todos os recursos operacionais.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['vehicles', 'vazios_manifests', 'vazios_bookings'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_active', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert_active', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update_active', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_read_user())', t || '_select_active', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_active_user() OR public.is_equipamentos_user())', t || '_insert_active', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_active_user() OR public.is_equipamentos_user()) WITH CHECK (public.is_active_user() OR public.is_equipamentos_user())', t || '_update_active', t);
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
