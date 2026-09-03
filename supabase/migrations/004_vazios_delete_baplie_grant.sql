-- 004: Concede EXECUTE na RPC de exclusão de manifesto BAPLIE
--
-- public.delete_baplie_manifest_for_voyage(bigint) é chamada pelo navegador em
-- src/services/vaziosImportacaoImport.ts (deleteBaplieManifestForVoyage).
-- A migration histórica 097 revogou PUBLIC/anon mas omitiu o grant para
-- authenticated e service_role. O corpo da função já valida is_active_user().
--
-- Rollback:
-- REVOKE EXECUTE ON FUNCTION public.delete_baplie_manifest_for_voyage(bigint) FROM authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.delete_baplie_manifest_for_voyage(bigint) TO authenticated, service_role;
