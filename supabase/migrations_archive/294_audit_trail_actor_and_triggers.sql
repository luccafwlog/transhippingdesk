-- 294: congela o departamento do autor e instrumenta as mudanças internas.
-- Nenhuma permissão é alterada nesta migration; a abertura acontece em 295.

CREATE OR REPLACE FUNCTION public.current_actor_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN auth.role() = 'service_role' THEN 'sistema'
    ELSE (
      SELECT CASE up.role
        WHEN 'admin' THEN 'administrativo'
        WHEN 'operator' THEN 'documentacao'
        ELSE up.role
      END
      FROM public.user_profiles AS up
      WHERE up.id = auth.uid() AND up.active = true
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.current_actor_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_actor_role() TO authenticated, service_role;

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS actor_role TEXT;
ALTER TABLE public.audit_logs
  ALTER COLUMN actor_role SET DEFAULT public.current_actor_role();

-- TG_ARGV[0] é uma lista de colunas separadas por vírgula que compõe a chave
-- da linha (ex.: 'id' ou, para tabelas sem coluna id como bl_freight_lines,
-- 'bl_id,seq'). O entity_id gravado é a concatenação dos valores com '/'.
CREATE OR REPLACE FUNCTION public.audit_row_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old JSONB := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_new JSONB := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
  v_key_parts TEXT[] := string_to_array(COALESCE(TG_ARGV[0], 'id'), ',');
  v_entity_id TEXT;
  v_field RECORD;
BEGIN
  SELECT string_agg(COALESCE(v_new ->> k, v_old ->> k), '/')
    INTO v_entity_id
    FROM unnest(v_key_parts) AS k;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by)
    VALUES (TG_TABLE_NAME, v_entity_id, 'criado', v_new::TEXT, auth.uid());
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, changed_by)
    VALUES (TG_TABLE_NAME, v_entity_id, 'excluido', v_old::TEXT, auth.uid());
  ELSE
    FOR v_field IN
      SELECT key, value AS old_value, v_new ->> key AS new_value
      FROM jsonb_each_text(v_old)
      WHERE v_old ->> key IS DISTINCT FROM v_new ->> key
    LOOP
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by)
      VALUES (TG_TABLE_NAME, v_entity_id, v_field.key, v_field.old_value, v_field.new_value, auth.uid());
    END LOOP;
    FOR v_field IN
      SELECT key, value AS new_value
      FROM jsonb_each_text(v_new)
      WHERE NOT (v_old ? key)
    LOOP
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by)
      VALUES (TG_TABLE_NAME, v_entity_id, v_field.key, v_field.new_value, auth.uid());
    END LOOP;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_row_changes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_row_changes() TO authenticated, service_role;

-- 'voyages' fica fora da instrumentação genérica: createVoyage/updateVoyage/
-- cancelVoyage (src/services/voyages.ts) já gravam audit_logs campo a campo,
-- com justificativa; o trigger genérico apenas duplicaria essas linhas e, no
-- INSERT, gravaria a linha inteira em JSON como 'criado'.
-- 'baplie_containers' também fica fora: é staging transacional reimportado
-- por inteiro a cada importação (DELETE + INSERT em massa) e já tem seu
-- próprio registro agregado em audit_logs via entity_type = 'baplie_import';
-- auditar linha a linha geraria milhares de registros por reimportação.
DO $$
DECLARE
  v_table TEXT;
  v_full_tables CONSTANT TEXT[] := ARRAY[
    'customers', 'customer_contacts', 'carriers', 'vessels', 'ports',
    'voyage_export_schedules', 'vessel_schedules', 'voyage_omissions', 'voyage_route_ce_master',
    'bl_transshipments', 'ended_vessels', 'depots', 'depot_services',
    'charge_tables', 'charge_table_items', 'customer_rate_overrides', 'demurrage_rates',
    'granite_rates', 'vazios_reorg_rates', 'vazios_reorg_services', 'exchange_rate_reference',
    'invoices', 'invoice_items', 'payments', 'invoice_refunds', 'invoice_bls',
    'bl_receivables', 'invoice_receivable_links', 'ledger_settlements',
    'demurrage_invoices', 'demurrage_invoice_items',
    'import_batches', 'granite_manifests', 'vazios_manifests', 'vazios_importacao_manifests',
    'vehicles'
  ];
  v_line_tables CONSTANT TEXT[] := ARRAY[
    'bls', 'bl_containers', 'bl_breakbulk_items', 'bl_freight_lines', 'granite_bls',
    'granite_bl_charges', 'vazios_bookings', 'vazios_importacao_containers',
    'charge_calculations', 'vazios_export_operations', 'vazios_export_service_lines'
  ];
  v_key TEXT;
BEGIN
  FOREACH v_table IN ARRAY v_full_tables LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON public.%I', v_table, v_table);
    EXECUTE format(
      'CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_changes(''id'')',
      v_table, v_table
    );
  END LOOP;
  FOREACH v_table IN ARRAY v_line_tables LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN CONTINUE; END IF;
    v_key := CASE WHEN v_table = 'bl_freight_lines' THEN 'bl_id,seq' ELSE 'id' END;
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON public.%I', v_table, v_table);
    EXECUTE format(
      'CREATE TRIGGER audit_%I AFTER UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_changes(%L)',
      v_table, v_table, v_key
    );
  END LOOP;
END $$;

ALTER TABLE public.import_batches ADD COLUMN IF NOT EXISTS route_summary TEXT;

CREATE OR REPLACE FUNCTION public.freeze_import_batch_route_summary()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_route TEXT;
BEGIN
  IF NEW.route_summary IS NOT NULL OR NEW.status NOT IN ('completed', 'partial') THEN RETURN NEW; END IF;
  SELECT string_agg(route, ', ' ORDER BY route)
    INTO v_route
  FROM (
    SELECT DISTINCT concat_ws(' → ', NULLIF(b.pol, ''), NULLIF(b.pod, '')) AS route
    FROM public.bls AS b
    WHERE b.batch_id = NEW.id
      AND (b.pol IS NOT NULL OR b.pod IS NOT NULL)
  ) AS routes
  WHERE route IS NOT NULL AND route <> '';
  IF v_route IS NOT NULL THEN
    UPDATE public.import_batches SET route_summary = v_route WHERE id = NEW.id AND route_summary IS NULL;
    NEW.route_summary := v_route;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS freeze_import_batch_route_summary ON public.import_batches;
CREATE TRIGGER freeze_import_batch_route_summary
AFTER INSERT OR UPDATE OF status ON public.import_batches
FOR EACH ROW EXECUTE FUNCTION public.freeze_import_batch_route_summary();

UPDATE public.import_batches AS ib
SET route_summary = routes.route_summary
FROM (
  SELECT b.batch_id, string_agg(route, ', ' ORDER BY route) AS route_summary
  FROM (
    SELECT DISTINCT batch_id, concat_ws(' → ', NULLIF(pol, ''), NULLIF(pod, '')) AS route
    FROM public.bls
    WHERE batch_id IS NOT NULL AND (pol IS NOT NULL OR pod IS NOT NULL)
  ) AS b
  WHERE b.route IS NOT NULL AND b.route <> ''
  GROUP BY b.batch_id
) AS routes
WHERE ib.id = routes.batch_id AND ib.route_summary IS NULL;

CREATE OR REPLACE FUNCTION public.import_baplie_staging_transactional(
  p_voyage_id BIGINT,
  p_rows JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER := COALESCE(jsonb_array_length(p_rows), 0);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para importar Baplie.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.baplie_containers WHERE voyage_id = p_voyage_id;
  IF v_count > 0 THEN
    INSERT INTO public.baplie_containers (
      voyage_id, container_number, size_type, status, weight_kg, pol, pod, final_dest,
      bl_ref, slot, is_imo, imo_class, un_number, is_oog, imported_by
    )
    SELECT p_voyage_id, row.container_number, row.size_type, row.status, row.weight_kg,
      row.pol, row.pod, row.final_dest, row.bl_ref, row.slot, row.is_imo, row.imo_class,
      row.un_number, row.is_oog, row.imported_by
    FROM jsonb_to_recordset(p_rows) AS row(
      container_number TEXT, size_type TEXT, status TEXT, weight_kg NUMERIC, pol TEXT,
      pod TEXT, final_dest TEXT, bl_ref TEXT, slot TEXT, is_imo BOOLEAN, imo_class TEXT,
      un_number TEXT, is_oog BOOLEAN, imported_by UUID
    );
  END IF;
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by)
  VALUES ('baplie_import', p_voyage_id::TEXT, 'criado', v_count::TEXT, auth.uid());
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.import_baplie_staging_transactional(BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_baplie_staging_transactional(BIGINT, JSONB) TO authenticated;
