-- 299: Sinal próprio para Email de Recuperação quebrado em conta ativa.
--
-- Problema de negócio: o webhook do Resend só rebaixa a situação da conta
-- quando ela está em `convite_pendente`. Uma conta **ativa** cujo Email de
-- Recuperação sofre bounce permanente continua `ativo`, e a recuperação de
-- senha devolve `accepted()` em silêncio ao ver o endereço bloqueado -- correto
-- contra enumeração, mas o cliente espera por um email que o sistema já sabia
-- que não sairia. O único sinal era um alerta na fila.
--
-- Por que uma coluna nova e não `account_situation`: aquela coluna é de valor
-- único e `ativo`/`falha_no_envio` são excludentes (178). Marcar
-- `falha_no_envio` numa conta ativa afirmaria que ela não está ativa -- e está,
-- o cliente continua entrando com a senha -- e ofereceria no console a ação
-- "Revisar email e reenviar", que é de convite e não serve a quem já é cliente.
-- São dois fatos independentes (a conta funciona / o email de recuperação
-- quebrou) e a coluna única faz um apagar o outro.
--
-- Rollback: DROP da coluna e restaurar o console pela definição da 295.

ALTER TABLE public.customer_portal_accounts
  ADD COLUMN IF NOT EXISTS recovery_email_status TEXT NOT NULL DEFAULT 'ok'
    CHECK (recovery_email_status IN ('ok','bounce_permanente','complaint'));

COMMENT ON COLUMN public.customer_portal_accounts.recovery_email_status IS
  'Saúde do endereço em recovery_email, marcada pelo webhook de bounce/complaint. Independente de account_situation.';

-- O console de provisionamento é reconstruído a partir da definição vigente
-- (198 + alargamento de papéis da 295), acrescentando só as duas chaves novas.
-- Reescrever o corpo inteiro aqui duplicaria o self-heal da fila e os papéis da
-- 295, que continuariam válidos em dois lugares.
DO $$
DECLARE
  v_def TEXT;
  v_anchor TEXT := '''shared_email_count'',';
  v_new_keys TEXT := '''recovery_email_status'', CASE WHEN v_full_access THEN a.recovery_email_status ELSE NULL END, '
    || '''recovery_email_suppressed'', CASE WHEN v_full_access AND a.recovery_email IS NOT NULL THEN EXISTS (SELECT 1 FROM public.portal_suppressed_emails s WHERE s.email = lower(a.recovery_email)) ELSE false END, ';
BEGIN
  v_def := pg_get_functiondef('public.portal_list_provisioning_console(bigint)'::regprocedure);
  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora shared_email_count não encontrada em portal_list_provisioning_console; revise a migration 299.';
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
