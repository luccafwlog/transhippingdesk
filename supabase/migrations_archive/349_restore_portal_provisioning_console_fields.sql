-- 349: restaura os sinais de entrega do Email de Recuperação no read model.
--
-- A migration 299 adicionou recovery_email_status e
-- recovery_email_suppressed ao payload do console, mas a 325 reconstruiu a
-- mesma RPC com CREATE OR REPLACE e omitiu os dois campos. O frontend valida
-- o contrato completo e, por isso, a resposta antiga falha no parsing.
-- Reversão: se necessário, reverta o deploy do frontend junto com esta
-- migration; manter os campos no read model é compatível com as colunas
-- existentes e não altera a situação operacional da conta.

DO $$
DECLARE
  v_def TEXT;
  v_anchor TEXT := '''shared_email_count'',';
  v_new_keys TEXT := '''recovery_email_status'', CASE WHEN v_full_access THEN a.recovery_email_status ELSE NULL END, '
    || '''recovery_email_suppressed'', CASE WHEN v_full_access AND a.recovery_email IS NOT NULL THEN EXISTS (SELECT 1 FROM public.portal_suppressed_emails s WHERE s.email = lower(a.recovery_email)) ELSE false END, ';
BEGIN
  v_def := pg_get_functiondef('public.portal_list_provisioning_console(bigint)'::regprocedure);

  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora shared_email_count não encontrada em portal_list_provisioning_console; revise a migration 349.';
  END IF;

  IF position('recovery_email_status' IN v_def) > 0 THEN
    RAISE NOTICE 'portal_list_provisioning_console já expõe recovery_email_status; nada a fazer.';
    RETURN;
  END IF;

  v_def := replace(v_def, v_anchor, v_new_keys || v_anchor);
  EXECUTE v_def;
END $$;

GRANT EXECUTE ON FUNCTION public.portal_list_provisioning_console(BIGINT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_list_provisioning_console(BIGINT) FROM PUBLIC, anon;
