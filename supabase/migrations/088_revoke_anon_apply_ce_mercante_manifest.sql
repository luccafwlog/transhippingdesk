-- Renumbered from 20260608192000 (original timestamped migration: 20260608192000_revoke_anon_apply_ce_mercante_manifest.sql).
------------------------------------------------------------------------
-- Remove o EXECUTE de anon na RPC apply_ce_mercante_manifest.
--
-- O Supabase concede EXECUTE a anon/authenticated/service_role via default
-- privileges no momento da criacao da funcao. O REVOKE ... FROM PUBLIC da
-- migration original nao remove esses grants explicitos, deixando anon com
-- permissao de chamar a RPC. A funcao e SECURITY INVOKER (anon nao consegue
-- gravar por causa do RLS), mas, por menor privilegio e alinhamento com o
-- restante do projeto, anon nao deve ter EXECUTE.
--
-- Rollback: GRANT EXECUTE ON FUNCTION
--   public.apply_ce_mercante_manifest(JSONB, UUID) TO anon;
------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.apply_ce_mercante_manifest(JSONB, UUID) FROM anon;
