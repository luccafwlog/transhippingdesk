-- 203 / Spec §14: o backfill inicial do Portal foi concluído; suas RPCs deixam o catálogo.
-- O self-heal portal_repair_missing_accounts da migration 198 permanece vigente.
-- Rollback operacional: restaurar as funções a partir da migration histórica 192.

DROP FUNCTION IF EXISTS public.portal_provisioning_preflight();
DROP FUNCTION IF EXISTS public.portal_provisioning_backfill(TEXT);
