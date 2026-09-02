-- 350_vazios_importacao_pol_and_manifest_routes.sql
-- 1. Suporte a POL em vazios_importacao_containers
-- 2. Suporte a cargo_mode (container/vazios) em voyage_route_ce_master para permitir CE Master distinto de vazios na mesma rota
-- 3. Atualização das RPCs de vazios para persistir a rota completa (POL -> POD)

-- Coluna pol em vazios_importacao_containers
ALTER TABLE public.vazios_importacao_containers
  ADD COLUMN IF NOT EXISTS pol TEXT;

-- Coluna cargo_mode em voyage_route_ce_master
ALTER TABLE public.voyage_route_ce_master
  ADD COLUMN IF NOT EXISTS cargo_mode TEXT NOT NULL DEFAULT 'container';

DO $$
BEGIN
  -- Remove constraint antiga se existir
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'voyage_route_ce_master_voyage_id_pol_pod_key'
  ) THEN
    ALTER TABLE public.voyage_route_ce_master
      DROP CONSTRAINT voyage_route_ce_master_voyage_id_pol_pod_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'voyage_route_ce_master_voyage_pol_pod_mode_uniq'
  ) THEN
    ALTER TABLE public.voyage_route_ce_master
      ADD CONSTRAINT voyage_route_ce_master_voyage_pol_pod_mode_uniq UNIQUE (voyage_id, pol, pod, cargo_mode);
  END IF;
END $$;

-- RPC atualizada: set_voyage_route_ce_master
CREATE OR REPLACE FUNCTION public.set_voyage_route_ce_master(
  p_voyage_id BIGINT,
  p_pol TEXT,
  p_pod TEXT,
  p_ce_master TEXT,
  p_changed_by UUID,
  p_cargo_mode TEXT DEFAULT 'container'
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_norm TEXT := NULLIF(btrim(COALESCE(p_ce_master, '')), '');
  v_pol TEXT := upper(btrim(COALESCE(p_pol, '')));
  v_pod TEXT := upper(btrim(COALESCE(p_pod, '')));
  v_mode TEXT := lower(btrim(COALESCE(p_cargo_mode, 'container')));
  v_old TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para editar CE Master.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem % nao encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;

  SELECT ce_master INTO v_old FROM public.voyage_route_ce_master
    WHERE voyage_id = p_voyage_id AND pol = v_pol AND pod = v_pod AND cargo_mode = v_mode;

  INSERT INTO public.voyage_route_ce_master(voyage_id, pol, pod, cargo_mode, ce_master, updated_by, updated_at)
  VALUES (p_voyage_id, v_pol, v_pod, v_mode, v_norm, p_changed_by, now())
  ON CONFLICT (voyage_id, pol, pod, cargo_mode)
  DO UPDATE SET ce_master = EXCLUDED.ce_master, updated_by = EXCLUDED.updated_by, updated_at = now();

  IF COALESCE(v_old, '') IS DISTINCT FROM COALESCE(v_norm, '') THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('voyage', p_voyage_id::TEXT, 'ce_master', NULLIF(v_old, ''), v_norm, p_changed_by,
            CASE WHEN v_mode = 'vazios' THEN 'CE Master por rota (manifesto de vazios)'
                 ELSE 'CE Master por rota (viagem so-B/L)' END);
  END IF;
END;
$function$;

-- Assinatura legada de 5 argumentos para retrocompatibilidade
CREATE OR REPLACE FUNCTION public.set_voyage_route_ce_master(
  p_voyage_id BIGINT,
  p_pol TEXT,
  p_pod TEXT,
  p_ce_master TEXT,
  p_changed_by UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public.set_voyage_route_ce_master(p_voyage_id, p_pol, p_pod, p_ce_master, p_changed_by, 'container');
END;
$function$;

REVOKE ALL ON FUNCTION public.set_voyage_route_ce_master(BIGINT, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_voyage_route_ce_master(BIGINT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_voyage_route_ce_master(BIGINT, TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_voyage_route_ce_master(BIGINT, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- RPC replace_vazios_from_baplie_transactional atualizada com pol
CREATE OR REPLACE FUNCTION public.replace_vazios_from_baplie_transactional(
  p_voyage_id BIGINT,
  p_description TEXT,
  p_uploaded_by UUID,
  p_replace_existing BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_manifest_id UUID;
  v_total INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar vazios Baplie.' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::INTEGER
  INTO v_total
  FROM public.baplie_containers
  WHERE voyage_id = p_voyage_id AND status = 'empty';

  IF v_total = 0 THEN
    RAISE EXCEPTION 'Nenhum container vazio encontrado no Baplie desta viagem.'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_replace_existing THEN
    DELETE FROM public.vazios_importacao_manifests
    WHERE voyage_id = p_voyage_id AND source = 'baplie';
  ELSIF EXISTS (
    SELECT 1 FROM public.vazios_importacao_manifests
    WHERE voyage_id = p_voyage_id AND source = 'baplie'
  ) THEN
    RAISE EXCEPTION 'Ja existe manifesto Baplie para esta viagem.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.vazios_importacao_manifests (
    voyage_id, description, total_containers, imported_by, source
  )
  VALUES (
    p_voyage_id, COALESCE(p_description, 'Importado via Baplie EDI'),
    v_total, p_uploaded_by, 'baplie'
  )
  RETURNING id INTO v_manifest_id;

  INSERT INTO public.vazios_importacao_containers (
    manifest_id, container_number, container_type, tare_kg, pol, pod
  )
  SELECT v_manifest_id, container_number, size_type, weight_kg, pol, pod
  FROM public.baplie_containers
  WHERE voyage_id = p_voyage_id AND status = 'empty';

  RETURN jsonb_build_object('manifest_id', v_manifest_id, 'total', v_total);
END;
$function$;

REVOKE ALL ON FUNCTION public.replace_vazios_from_baplie_transactional(BIGINT, TEXT, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_vazios_from_baplie_transactional(BIGINT, TEXT, UUID, BOOLEAN) TO authenticated;

-- RPC import_vazios_importacao_transactional atualizada com pol
CREATE OR REPLACE FUNCTION public.import_vazios_importacao_transactional(
  p_voyage_id BIGINT,
  p_description TEXT,
  p_uploaded_by UUID,
  p_containers JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_manifest_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar vazios.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.vazios_importacao_manifests (
    voyage_id, description, total_containers, imported_by, source
  )
  VALUES (
    p_voyage_id, p_description,
    jsonb_array_length(COALESCE(p_containers, '[]'::JSONB)),
    p_uploaded_by, 'manual'
  )
  RETURNING id INTO v_manifest_id;

  INSERT INTO public.vazios_importacao_containers (
    manifest_id, container_number, container_type, tare_kg, pol, pod
  )
  SELECT v_manifest_id, item.container_number, item.container_type, item.tare_kg, item.pol, item.pod
  FROM jsonb_to_recordset(COALESCE(p_containers, '[]'::JSONB)) AS item(
    container_number TEXT,
    container_type TEXT,
    tare_kg NUMERIC,
    pol TEXT,
    pod TEXT
  );

  RETURN jsonb_build_object('manifest_id', v_manifest_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.import_vazios_importacao_transactional(BIGINT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_vazios_importacao_transactional(BIGINT, TEXT, UUID, JSONB) TO authenticated;
