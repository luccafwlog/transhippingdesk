-- RBAC: Equipamentos pode ler os dados internos, mas so escreve Veiculos e
-- VAZIOS EXP. A UI nao e fronteira de seguranca: policies e RPCs tambem
-- precisam negar chamadas diretas. Tarifas de reorganizacao continuam fora do
-- escopo operacional de Equipamentos.

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

CREATE OR REPLACE FUNCTION public.is_active_write_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_active_non_equipamentos_user() OR public.is_equipamentos_user();
$$;

REVOKE ALL ON FUNCTION public.is_active_read_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_equipamentos_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_non_equipamentos_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_write_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_read_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_equipamentos_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_non_equipamentos_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_write_user() TO authenticated;

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
      AND cmd IN ('INSERT', 'UPDATE', 'ALL')
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
      v_name := left(p.policyname, 51);
      EXECUTE format('CREATE POLICY %I ON public.%I%s FOR SELECT TO %s USING (%s)',
        v_name || '_equip_read', p.tablename, v_as_clause, v_roles,
        replace(COALESCE(p.qual, 'true'), 'is_active_user()', 'is_active_read_user()'));
      EXECUTE format('CREATE POLICY %I ON public.%I%s FOR INSERT TO %s WITH CHECK (%s)',
        v_name || '_equip_insert', p.tablename, v_as_clause, v_roles, v_check);
      EXECUTE format('CREATE POLICY %I ON public.%I%s FOR UPDATE TO %s USING (%s) WITH CHECK (%s)',
        v_name || '_equip_update', p.tablename, v_as_clause, v_roles, v_qual, v_check);
      EXECUTE format('CREATE POLICY %I ON public.%I%s FOR DELETE TO %s USING (%s)',
        v_name || '_equip_delete', p.tablename, v_as_clause, v_roles, v_qual);
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
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_active_write_user())', t || '_insert_active', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_active_write_user()) WITH CHECK (public.is_active_write_user())', t || '_update_active', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['vazios_export_operations', 'vazios_export_overtime_depots', 'vazios_reorg_services'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_read_user())', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_active_write_user())', t || '_insert_equipamentos', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_active_write_user()) WITH CHECK (public.is_active_write_user())', t || '_update_equipamentos', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_admin())', t || '_delete_admin', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.import_vehicle_rows_transactional(p_rows JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count INTEGER := COALESCE(jsonb_array_length(p_rows), 0);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_write_user() THEN
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
  IF auth.uid() IS NULL OR NOT public.is_active_write_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
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

CREATE OR REPLACE FUNCTION public.import_vazios_importacao_transactional(p_voyage_id BIGINT, p_description TEXT, p_uploaded_by UUID, p_containers JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_manifest_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_non_equipamentos_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Usuario sem permissao ativa para importar vazios.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.vazios_importacao_manifests (voyage_id, description, total_containers, imported_by, source) VALUES (p_voyage_id, p_description, jsonb_array_length(COALESCE(p_containers, '[]'::JSONB)), p_uploaded_by, 'manual') RETURNING id INTO v_manifest_id;
  INSERT INTO public.vazios_importacao_containers (manifest_id, container_number, container_type, tare_kg) SELECT v_manifest_id, item.container_number, item.container_type, item.tare_kg FROM jsonb_to_recordset(COALESCE(p_containers, '[]'::JSONB)) AS item(container_number TEXT, container_type TEXT, tare_kg NUMERIC);
  RETURN jsonb_build_object('manifest_id', v_manifest_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_vazios_from_baplie_transactional(p_voyage_id BIGINT, p_description TEXT, p_uploaded_by UUID, p_replace_existing BOOLEAN DEFAULT FALSE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_manifest_id UUID; v_total INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_non_equipamentos_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Usuario sem permissao ativa para importar vazios Baplie.' USING ERRCODE = '42501'; END IF;
  SELECT count(*)::INTEGER INTO v_total FROM public.baplie_containers WHERE voyage_id = p_voyage_id AND status = 'empty';
  IF v_total = 0 THEN RAISE EXCEPTION 'Nenhum container vazio encontrado no Baplie desta viagem.' USING ERRCODE = 'P0002'; END IF;
  IF p_replace_existing THEN DELETE FROM public.vazios_importacao_manifests WHERE voyage_id = p_voyage_id AND source = 'baplie'; ELSIF EXISTS (SELECT 1 FROM public.vazios_importacao_manifests WHERE voyage_id = p_voyage_id AND source = 'baplie') THEN RAISE EXCEPTION 'Ja existe manifesto Baplie para esta viagem.' USING ERRCODE = '23505'; END IF;
  INSERT INTO public.vazios_importacao_manifests (voyage_id, description, total_containers, imported_by, source) VALUES (p_voyage_id, COALESCE(p_description, 'Importado via Baplie EDI'), v_total, p_uploaded_by, 'baplie') RETURNING id INTO v_manifest_id;
  INSERT INTO public.vazios_importacao_containers (manifest_id, container_number, container_type, tare_kg, pod) SELECT v_manifest_id, container_number, size_type, weight_kg, pod FROM public.baplie_containers WHERE voyage_id = p_voyage_id AND status = 'empty';
  RETURN jsonb_build_object('manifest_id', v_manifest_id, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_baplie_manifest_for_voyage(p_voyage_id BIGINT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_non_equipamentos_user() THEN RAISE EXCEPTION 'Apenas usuarios ativos podem substituir manifesto BAPLIE.' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.vazios_importacao_manifests WHERE voyage_id = p_voyage_id AND source = 'baplie';
  GET DIAGNOSTICS v_count = ROW_COUNT; RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_granite_bl_review(p_granite_bl_id UUID, p_client_id BIGINT, p_changed_by UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_previous_client_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_non_equipamentos_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Usuario sem permissao ativa para revisar B/L Granite.' USING ERRCODE = '42501'; END IF;
  SELECT client_id INTO v_previous_client_id FROM public.granite_bls WHERE id = p_granite_bl_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'B/L Granite % nao encontrado', p_granite_bl_id USING ERRCODE = 'P0002'; END IF;
  IF v_previous_client_id IS NOT DISTINCT FROM p_client_id THEN RETURN; END IF;
  UPDATE public.granite_bls SET client_id = p_client_id WHERE id = p_granite_bl_id;
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification) VALUES ('granite_bl', p_granite_bl_id::TEXT, 'client_id', v_previous_client_id::TEXT, p_client_id::TEXT, p_changed_by, 'Cliente vinculado via fila de revisao');
END;
$$;

REVOKE ALL ON FUNCTION public.import_vehicle_rows_transactional(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_vazios_bookings_transactional(BIGINT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_vazios_importacao_transactional(BIGINT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.replace_vazios_from_baplie_transactional(BIGINT, TEXT, UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_baplie_manifest_for_voyage(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_granite_bl_review(UUID, BIGINT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_vehicle_rows_transactional(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_vazios_bookings_transactional(BIGINT, TEXT, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_vazios_importacao_transactional(BIGINT, TEXT, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_vazios_from_baplie_transactional(BIGINT, TEXT, UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_baplie_manifest_for_voyage(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_granite_bl_review(UUID, BIGINT, UUID) TO authenticated;
