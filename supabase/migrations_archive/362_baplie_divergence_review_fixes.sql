-- 362: correcoes de revisao da divergencia Baplie/BL por rota.
--
-- A migration 361 ja pode ter sido aplicada em um Preview, portanto as
-- correcoes sao forward-only nesta migration, sem editar a definicao historica.
-- Intent:
--   1. corrigir o backfill para executar como service_role;
--   2. impedir que DELETE + INSERT de uma reimportacao produza transicoes
--      intermediarias e notificacoes falsas;
--   3. reconciliar uma unica vez, depois do estado final da importacao;
--   4. limitar UPDATE triggers as colunas que mudam a divergencia;
--   5. filtrar rotas normalizadas nulas, mantendo SQL e TypeScript alinhados.
-- Affected: baplie_containers, bls, bl_containers, alerts/alert_items e as
-- RPCs public.import_baplie_staging_transactional/import_bl_freight_transactional.
-- Rollback: reaplicar as definicoes da 361 e os wrappers de importacao
-- anteriores; nao ha rollback destrutivo de dados.

-- 1. Reconciliador: pending_routes so pode conter uma rota normalizada valida.
CREATE OR REPLACE FUNCTION public.reconcile_voyage_baplie_coverage_alerts(
  p_voyage_id BIGINT,
  p_source TEXT DEFAULT 'voyage_operation_detector'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_first_eta DATE;
  v_is_d7 BOOLEAN;
  v_has_baplie BOOLEAN;
  v_covered_route_count INTEGER := 0;
  v_pending_route_count INTEGER := 0;
  v_divergence_count INTEGER := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.baplie_containers WHERE voyage_id = p_voyage_id
  ) INTO v_has_baplie;

  IF NOT v_has_baplie THEN
    PERFORM public.resolve_alert_item('voyage_baplie_documentary_coverage', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  v_first_eta := public.get_voyage_first_brazilian_eta(p_voyage_id);
  v_is_d7 := (v_first_eta IS NOT NULL AND v_today >= (v_first_eta - 7));

  WITH edi_routes AS (
    SELECT DISTINCT public.normalize_port_code(pol) AS pol, public.normalize_port_code(pod) AS pod
    FROM public.baplie_containers
    WHERE voyage_id = p_voyage_id
      AND pol IS NOT NULL AND pod IS NOT NULL
      AND COALESCE(status, '') <> 'empty'
  ),
  bl_routes AS (
    SELECT DISTINCT public.normalize_port_code(b.pol) AS pol, public.normalize_port_code(b.pod) AS pod
    FROM public.bls b
    WHERE b.voyage_id = p_voyage_id
      AND b.pol IS NOT NULL AND b.pod IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.bl_containers bc
        WHERE bc.bl_id = b.id
          AND NULLIF(btrim(bc.container_number), '') IS NOT NULL
      )
  ),
  valid_edi AS (
    SELECT pol, pod FROM edi_routes WHERE pol IS NOT NULL AND pod IS NOT NULL
  ),
  valid_bl AS (
    SELECT pol, pod FROM bl_routes WHERE pol IS NOT NULL AND pod IS NOT NULL
  )
  SELECT
    (SELECT count(*) FROM (SELECT pol, pod FROM valid_edi INTERSECT SELECT pol, pod FROM valid_bl) covered),
    (SELECT count(*) FROM (SELECT pol, pod FROM valid_edi EXCEPT SELECT pol, pod FROM valid_bl) pending)
  INTO v_covered_route_count, v_pending_route_count;

  IF v_covered_route_count = 0 AND v_pending_route_count > 0 AND NOT v_is_d7 THEN
    PERFORM public.resolve_alert_item('voyage_baplie_documentary_coverage', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  WITH pending_routes AS (
    SELECT pol, pod FROM (
      SELECT DISTINCT public.normalize_port_code(pol) AS pol, public.normalize_port_code(pod) AS pod
      FROM public.baplie_containers
      WHERE voyage_id = p_voyage_id
        AND pol IS NOT NULL AND pod IS NOT NULL
        AND COALESCE(status, '') <> 'empty'
      EXCEPT
      SELECT DISTINCT public.normalize_port_code(b.pol) AS pol, public.normalize_port_code(b.pod) AS pod
      FROM public.bls b
      WHERE b.voyage_id = p_voyage_id
        AND b.pol IS NOT NULL AND b.pod IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.bl_containers bc
          WHERE bc.bl_id = b.id
            AND NULLIF(btrim(bc.container_number), '') IS NOT NULL
        )
    ) missing
    WHERE pol IS NOT NULL AND pod IS NOT NULL
      AND NOT v_is_d7
  ),
  baplie_full AS (
    SELECT
      regexp_replace(upper(btrim(container_number)), '\s+', '', 'g') AS container_number,
      public.normalize_port_code(pol) AS pol,
      public.normalize_port_code(pod) AS pod
    FROM public.baplie_containers
    WHERE voyage_id = p_voyage_id
      AND COALESCE(status, '') <> 'empty'
      AND NULLIF(btrim(container_number), '') IS NOT NULL
  ),
  baplie_all AS (
    SELECT DISTINCT container_number FROM baplie_full
  ),
  baplie_reconcilable AS (
    SELECT DISTINCT f.container_number
    FROM baplie_full f
    WHERE NOT EXISTS (
      SELECT 1 FROM pending_routes p
      WHERE p.pol IS NOT DISTINCT FROM f.pol AND p.pod IS NOT DISTINCT FROM f.pod
    )
  ),
  bl_cntrs AS (
    SELECT DISTINCT regexp_replace(upper(btrim(bc.container_number)), '\s+', '', 'g') AS container_number
    FROM public.bl_containers bc
    JOIN public.bls b ON b.id = bc.bl_id
    WHERE b.voyage_id = p_voyage_id
      AND NULLIF(btrim(bc.container_number), '') IS NOT NULL
  )
  SELECT
    (SELECT count(*) FROM (SELECT container_number FROM baplie_reconcilable EXCEPT SELECT container_number FROM bl_cntrs) d1) +
    (SELECT count(*) FROM (SELECT container_number FROM bl_cntrs EXCEPT SELECT container_number FROM baplie_all) d2)
  INTO v_divergence_count;

  IF v_divergence_count > 0 THEN
    PERFORM public.upsert_alert_item(
      'voyage_baplie_documentary_coverage',
      'voyage',
      p_voyage_id::text,
      'Divergência Baplie/BL: ' || v_divergence_count || ' container(s) divergente(s) na viagem ' || p_voyage_id,
      p_source,
      jsonb_build_object(
        'voyage_id', p_voyage_id,
        'divergence_count', v_divergence_count,
        'covered_route_count', v_covered_route_count,
        'pending_route_count', v_pending_route_count
      ),
      '/baplie?voyage=' || p_voyage_id
    );
  ELSE
    PERFORM public.resolve_alert_item('voyage_baplie_documentary_coverage', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_voyage_baplie_coverage_alerts(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_baplie_coverage_alerts(BIGINT, TEXT) TO service_role;

-- 2. Os imports substituem conjuntos inteiros. Durante a substituicao, os
-- triggers apenas observam a transacao; a RPC publica reconcilia o estado final.
CREATE OR REPLACE FUNCTION public.reconcile_baplie_coverage_from_new_rows()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_voyage_id BIGINT;
BEGIN
  IF current_setting('alerts.baplie_coverage_deferred', true) = 'on' THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR v_voyage_id IN SELECT DISTINCT voyage_id FROM changed_rows WHERE voyage_id IS NOT NULL LOOP
    PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'baplie_coverage_trigger');
  END LOOP;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RAISE WARNING 'Reconciliação Baplie/BL ignorada (linhas novas): %', SQLERRM;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_baplie_coverage_from_old_rows()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_voyage_id BIGINT;
BEGIN
  IF current_setting('alerts.baplie_coverage_deferred', true) = 'on' THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR v_voyage_id IN SELECT DISTINCT voyage_id FROM changed_rows WHERE voyage_id IS NOT NULL LOOP
    PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'baplie_coverage_trigger');
  END LOOP;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RAISE WARNING 'Reconciliação Baplie/BL ignorada (linhas removidas): %', SQLERRM;
  RETURN NULL;
END;
$function$;

-- PostgreSQL não permite combinar `UPDATE OF` com transition tables. Para
-- preservar o processamento statement-level, os triggers de UPDATE usam OLD
-- e NEW TABLE e só entram no reconciliador quando uma coluna relevante mudou.
CREATE OR REPLACE FUNCTION public.reconcile_baplie_coverage_from_updated_baplie_rows()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_voyage_id BIGINT;
BEGIN
  IF current_setting('alerts.baplie_coverage_deferred', true) = 'on' THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR v_voyage_id IN
    SELECT DISTINCT affected.voyage_id
    FROM (
      SELECT n.voyage_id
      FROM changed_rows n
      JOIN old_rows o ON o.id = n.id
      WHERE n.voyage_id IS DISTINCT FROM o.voyage_id
         OR n.container_number IS DISTINCT FROM o.container_number
         OR n.status IS DISTINCT FROM o.status
         OR n.pol IS DISTINCT FROM o.pol
         OR n.pod IS DISTINCT FROM o.pod
      UNION ALL
      SELECT o.voyage_id
      FROM changed_rows n
      JOIN old_rows o ON o.id = n.id
      WHERE n.voyage_id IS DISTINCT FROM o.voyage_id
         OR n.container_number IS DISTINCT FROM o.container_number
         OR n.status IS DISTINCT FROM o.status
         OR n.pol IS DISTINCT FROM o.pol
         OR n.pod IS DISTINCT FROM o.pod
    ) affected
    WHERE affected.voyage_id IS NOT NULL
  LOOP
    PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'baplie_coverage_trigger');
  END LOOP;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RAISE WARNING 'Reconciliação Baplie/BL ignorada (Baplie atualizado): %', SQLERRM;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_baplie_coverage_from_updated_bls()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_voyage_id BIGINT;
BEGIN
  IF current_setting('alerts.baplie_coverage_deferred', true) = 'on' THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR v_voyage_id IN
    SELECT DISTINCT affected.voyage_id
    FROM (
      SELECT n.voyage_id
      FROM changed_rows n
      JOIN old_rows o ON o.id = n.id
      WHERE n.voyage_id IS DISTINCT FROM o.voyage_id
         OR n.pol IS DISTINCT FROM o.pol
         OR n.pod IS DISTINCT FROM o.pod
      UNION ALL
      SELECT o.voyage_id
      FROM changed_rows n
      JOIN old_rows o ON o.id = n.id
      WHERE n.voyage_id IS DISTINCT FROM o.voyage_id
         OR n.pol IS DISTINCT FROM o.pol
         OR n.pod IS DISTINCT FROM o.pod
    ) affected
    WHERE affected.voyage_id IS NOT NULL
  LOOP
    PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'baplie_coverage_trigger');
  END LOOP;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RAISE WARNING 'Reconciliação Baplie/BL ignorada (B/L atualizado): %', SQLERRM;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_baplie_coverage_from_updated_bl_containers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_voyage_id BIGINT;
BEGIN
  IF current_setting('alerts.baplie_coverage_deferred', true) = 'on' THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR v_voyage_id IN
    SELECT DISTINCT b.voyage_id
    FROM (
      SELECT n.bl_id
      FROM changed_rows n
      JOIN old_rows o ON o.id = n.id
      WHERE n.bl_id IS DISTINCT FROM o.bl_id
         OR n.container_number IS DISTINCT FROM o.container_number
      UNION ALL
      SELECT o.bl_id
      FROM changed_rows n
      JOIN old_rows o ON o.id = n.id
      WHERE n.bl_id IS DISTINCT FROM o.bl_id
         OR n.container_number IS DISTINCT FROM o.container_number
    ) affected
    JOIN public.bls b ON b.id = affected.bl_id
    WHERE b.voyage_id IS NOT NULL
  LOOP
    PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'baplie_coverage_trigger');
  END LOOP;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RAISE WARNING 'Reconciliação Baplie/BL ignorada (container de B/L atualizado): %', SQLERRM;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_baplie_coverage_from_new_bl_containers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_voyage_id BIGINT;
BEGIN
  IF current_setting('alerts.baplie_coverage_deferred', true) = 'on' THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR v_voyage_id IN
    SELECT DISTINCT b.voyage_id
    FROM changed_rows c
    JOIN public.bls b ON b.id = c.bl_id
    WHERE b.voyage_id IS NOT NULL
  LOOP
    PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'baplie_coverage_trigger');
  END LOOP;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RAISE WARNING 'Reconciliação Baplie/BL ignorada (containers de B/L novos): %', SQLERRM;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_baplie_coverage_from_old_bl_containers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_voyage_id BIGINT;
BEGIN
  IF current_setting('alerts.baplie_coverage_deferred', true) = 'on' THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR v_voyage_id IN
    SELECT DISTINCT b.voyage_id
    FROM changed_rows c
    JOIN public.bls b ON b.id = c.bl_id
    WHERE b.voyage_id IS NOT NULL
  LOOP
    PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'baplie_coverage_trigger');
  END LOOP;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RAISE WARNING 'Reconciliação Baplie/BL ignorada (containers de B/L removidos): %', SQLERRM;
  RETURN NULL;
END;
$function$;

-- Transition tables continuam statement-level, mas UPDATE agora ignora
-- alterações de datas, demurrage e demais atributos sem efeito na divergência.
DROP TRIGGER IF EXISTS reconcile_baplie_coverage_on_baplie_insert ON public.baplie_containers;
CREATE TRIGGER reconcile_baplie_coverage_on_baplie_insert
  AFTER INSERT ON public.baplie_containers
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_baplie_coverage_from_new_rows();

DROP TRIGGER IF EXISTS reconcile_baplie_coverage_on_baplie_update ON public.baplie_containers;
CREATE TRIGGER reconcile_baplie_coverage_on_baplie_update
  AFTER UPDATE ON public.baplie_containers
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_baplie_coverage_from_updated_baplie_rows();

DROP TRIGGER IF EXISTS reconcile_baplie_coverage_on_baplie_delete ON public.baplie_containers;
CREATE TRIGGER reconcile_baplie_coverage_on_baplie_delete
  AFTER DELETE ON public.baplie_containers
  REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_baplie_coverage_from_old_rows();

DROP TRIGGER IF EXISTS reconcile_baplie_coverage_on_bls_insert ON public.bls;
CREATE TRIGGER reconcile_baplie_coverage_on_bls_insert
  AFTER INSERT ON public.bls
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_baplie_coverage_from_new_rows();

DROP TRIGGER IF EXISTS reconcile_baplie_coverage_on_bls_update ON public.bls;
CREATE TRIGGER reconcile_baplie_coverage_on_bls_update
  AFTER UPDATE ON public.bls
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_baplie_coverage_from_updated_bls();

DROP TRIGGER IF EXISTS reconcile_baplie_coverage_on_bls_delete ON public.bls;
CREATE TRIGGER reconcile_baplie_coverage_on_bls_delete
  AFTER DELETE ON public.bls
  REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_baplie_coverage_from_old_rows();

DROP TRIGGER IF EXISTS reconcile_baplie_coverage_on_bl_containers_insert ON public.bl_containers;
CREATE TRIGGER reconcile_baplie_coverage_on_bl_containers_insert
  AFTER INSERT ON public.bl_containers
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_baplie_coverage_from_new_bl_containers();

DROP TRIGGER IF EXISTS reconcile_baplie_coverage_on_bl_containers_update ON public.bl_containers;
CREATE TRIGGER reconcile_baplie_coverage_on_bl_containers_update
  AFTER UPDATE ON public.bl_containers
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_baplie_coverage_from_updated_bl_containers();

DROP TRIGGER IF EXISTS reconcile_baplie_coverage_on_bl_containers_delete ON public.bl_containers;
CREATE TRIGGER reconcile_baplie_coverage_on_bl_containers_delete
  AFTER DELETE ON public.bl_containers
  REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_baplie_coverage_from_old_bl_containers();

REVOKE ALL ON FUNCTION public.reconcile_baplie_coverage_from_new_rows() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_baplie_coverage_from_old_rows() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_baplie_coverage_from_updated_baplie_rows() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_baplie_coverage_from_updated_bls() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_baplie_coverage_from_updated_bl_containers() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_baplie_coverage_from_new_bl_containers() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_baplie_coverage_from_old_bl_containers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_baplie_coverage_from_new_rows() TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_baplie_coverage_from_old_rows() TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_baplie_coverage_from_updated_baplie_rows() TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_baplie_coverage_from_updated_bls() TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_baplie_coverage_from_updated_bl_containers() TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_baplie_coverage_from_new_bl_containers() TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_baplie_coverage_from_old_bl_containers() TO service_role;

-- 3. Baplie: DELETE + INSERT continua atomico e passa a emitir uma so
-- reconciliacao, inclusive quando o payload vazio resolve o alerta.
CREATE OR REPLACE FUNCTION public.import_baplie_staging_transactional(
  p_voyage_id BIGINT,
  p_rows JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count INTEGER := COALESCE(jsonb_array_length(p_rows), 0);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao para importar Baplie.' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'on', true);

  DELETE FROM public.baplie_containers
  WHERE voyage_id = p_voyage_id;

  IF v_count > 0 THEN
    INSERT INTO public.baplie_containers (
      voyage_id,
      container_number,
      size_type,
      status,
      weight_kg,
      pol,
      pod,
      final_dest,
      bl_ref,
      slot,
      is_imo,
      imo_class,
      un_number,
      is_oog,
      imported_by
    )
    SELECT
      p_voyage_id,
      row.container_number,
      row.size_type,
      row.status,
      row.weight_kg,
      row.pol,
      row.pod,
      row.final_dest,
      row.bl_ref,
      row.slot,
      row.is_imo,
      row.imo_class,
      row.un_number,
      row.is_oog,
      row.imported_by
    FROM jsonb_to_recordset(p_rows) AS row(
      container_number TEXT,
      size_type TEXT,
      status TEXT,
      weight_kg NUMERIC,
      pol TEXT,
      pod TEXT,
      final_dest TEXT,
      bl_ref TEXT,
      slot TEXT,
      is_imo BOOLEAN,
      imo_class TEXT,
      un_number TEXT,
      is_oog BOOLEAN,
      imported_by UUID
    );
  END IF;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'off', true);
  PERFORM public.reconcile_voyage_baplie_coverage_alerts(p_voyage_id, 'baplie_coverage_import');
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_baplie_staging_transactional(BIGINT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_baplie_staging_transactional(BIGINT, JSONB) TO authenticated;

-- 4. B/L: o wrapper superior mantém as camadas 205/284/322/357/358, mas
-- suspende os triggers durante toda a cadeia e reconcilia viagens antigas e
-- finais uma unica vez. Isso cobre tambem o DELETE + INSERT de containers.
CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional(p_bls JSONB, p_changed_by UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result JSONB;
  v_item JSONB;
  v_bl_id TEXT;
  v_next TEXT[];
  v_current TEXT[];
  v_voyage_ids BIGINT[] := ARRAY[]::BIGINT[];
  v_voyage_id BIGINT;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT b.voyage_id ORDER BY b.voyage_id), ARRAY[]::BIGINT[])
  INTO v_voyage_ids
  FROM public.bls AS b
  WHERE b.id IN (
    SELECT item->>'id'
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::JSONB)) AS item
    WHERE item->>'id' IS NOT NULL
  )
    AND b.voyage_id IS NOT NULL;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'on', true);
  v_result := public.import_bl_freight_transactional_legacy_357(p_bls, p_changed_by);

  FOR v_item IN SELECT item FROM jsonb_array_elements(COALESCE(p_bls, '[]'::JSONB)) AS item
  LOOP
    v_bl_id := v_item->>'id';
    CONTINUE WHEN v_bl_id IS NULL;

    v_next := public.normalize_ncm_codes(v_item->'ncm_codes');
    CONTINUE WHEN cardinality(v_next) = 0;

    SELECT ncm_codes INTO v_current FROM public.bls WHERE id = v_bl_id;
    CONTINUE WHEN NOT FOUND;
    CONTINUE WHEN v_current = v_next;

    UPDATE public.bls SET ncm_codes = v_next WHERE id = v_bl_id;

    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES (
      'bl',
      v_bl_id,
      'ncm_codes',
      array_to_string(COALESCE(v_current, ARRAY[]::TEXT[]), ', '),
      array_to_string(v_next, ', '),
      p_changed_by,
      'NCM declarado no documento reimportado'
    );
  END LOOP;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'off', true);

  SELECT v_voyage_ids || COALESCE(array_agg(DISTINCT b.voyage_id ORDER BY b.voyage_id), ARRAY[]::BIGINT[])
  INTO v_voyage_ids
  FROM public.bls AS b
  WHERE b.id IN (
    SELECT item->>'id'
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::JSONB)) AS item
    WHERE item->>'id' IS NOT NULL
  )
    AND b.voyage_id IS NOT NULL;

  FOR v_voyage_id IN
    SELECT DISTINCT ids.voyage_id
    FROM unnest(v_voyage_ids) AS ids(voyage_id)
    WHERE ids.voyage_id IS NOT NULL
    ORDER BY ids.voyage_id
  LOOP
    PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'baplie_coverage_import');
  END LOOP;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_bl_freight_transactional(JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bl_freight_transactional(JSONB, UUID) TO authenticated;

-- 5. Reprocessa o estado existente com o papel que a fundacao de alertas
-- reconhece. A migration 361 tentava apenas ligar o flag de trigger, mas um
-- DO block roda com pg_trigger_depth() = 0 e sem auth.uid().
DO $function$
DECLARE
  v_voyage_id BIGINT;
  v_previous_role TEXT := current_setting('request.jwt.claim.role', true);
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  FOR v_voyage_id IN
    SELECT DISTINCT b.voyage_id
    FROM public.baplie_containers b
    WHERE b.voyage_id IS NOT NULL
    ORDER BY b.voyage_id
  LOOP
    PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'foundation_backfill');
  END LOOP;

  PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_role, ''), true);
END;
$function$;
