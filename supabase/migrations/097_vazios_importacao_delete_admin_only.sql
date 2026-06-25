-- Renumbered from 20260610163251 (original timestamped migration: 20260610163251_vazios_importacao_delete_admin_only.sql).
------------------------------------------------------------------------
-- Vazios Importação: DELETE vira admin-only; reimport de BAPLIE passa
-- por RPC escopada (decisão da operação em 2026-06-10, opção B do
-- follow-up do audit T12/#193).
--
-- Contexto: a migration 042 criou as policies novas
-- (select/insert/update = is_active_user, delete = is_admin) e tentou
-- remover as antigas (auth.role() = 'authenticated'), mas usou os nomes
-- errados (vazios_importacao_* vs vazios_imp_*). As antigas sobreviveram
-- e, como policies permissivas são OR-adas, qualquer authenticated —
-- mesmo desativado — podia deletar manifestos/containers.
--
-- O único fluxo legítimo de delete por operador é o reimport de BAPLIE
-- (deleteBaplieManifestForVoyage apaga o manifesto baplie anterior da
-- viagem; containers caem por ON DELETE CASCADE). Esse fluxo passa a
-- usar a RPC abaixo: SECURITY DEFINER com guard de usuário ativo,
-- escopo restrito a manifests com source = 'baplie' da viagem indicada.
-- DELETE arbitrário na tabela fica restrito a admin (policy
-- *_delete_admin da 042, agora sem a brecha).
--
-- Rollback:
--   DROP FUNCTION public.delete_baplie_manifest_for_voyage(bigint);
--   Recriar as policies antigas (ver pg_policies pré-migration) — não
--   recomendado.
------------------------------------------------------------------------

-- 1. RPC escopada para o reimport de BAPLIE (ADR 0004: mutação sensível
--    via SECURITY DEFINER com guard explícito).
CREATE OR REPLACE FUNCTION public.delete_baplie_manifest_for_voyage(p_voyage_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Apenas usuários ativos podem substituir manifesto BAPLIE.'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.vazios_importacao_manifests
  WHERE voyage_id = p_voyage_id
    AND source = 'baplie';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Default-deny (ADR 0011)
REVOKE EXECUTE ON FUNCTION public.delete_baplie_manifest_for_voyage(bigint) FROM PUBLIC, anon;

-- 2. Remove as policies antigas que a 042 errou o nome (fecha a brecha
--    de DELETE para qualquer authenticated e zera os 8 avisos
--    multiple_permissive_policies restantes do advisor).
DROP POLICY IF EXISTS vazios_imp_manifests_select ON public.vazios_importacao_manifests;
DROP POLICY IF EXISTS vazios_imp_manifests_insert ON public.vazios_importacao_manifests;
DROP POLICY IF EXISTS vazios_imp_manifests_update ON public.vazios_importacao_manifests;
DROP POLICY IF EXISTS vazios_imp_manifests_delete ON public.vazios_importacao_manifests;
DROP POLICY IF EXISTS vazios_imp_containers_select ON public.vazios_importacao_containers;
DROP POLICY IF EXISTS vazios_imp_containers_insert ON public.vazios_importacao_containers;
DROP POLICY IF EXISTS vazios_imp_containers_update ON public.vazios_importacao_containers;
DROP POLICY IF EXISTS vazios_imp_containers_delete ON public.vazios_importacao_containers;
