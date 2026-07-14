-- 184: Protege CNPJ após convite/conta e oferece alteração administrativa auditada.
CREATE OR REPLACE FUNCTION public.portal_protect_customer_cnpj()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
  IF NEW.cnpj_cpf IS DISTINCT FROM OLD.cnpj_cpf AND current_setting('portal.allow_cnpj_change', true) IS DISTINCT FROM 'true' AND EXISTS (
    SELECT 1 FROM public.customer_portal_accounts a
    WHERE a.customer_id=OLD.id AND (a.account_situation <> 'sem_conta' OR EXISTS (
      SELECT 1 FROM public.portal_invites i WHERE i.account_id=a.id AND i.status='pendente'))
  ) THEN
    RAISE EXCEPTION 'CNPJ protegido: Cliente possui convite ou Conta de Portal. Use a alteração administrativa auditada.' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_portal_protect_customer_cnpj ON public.customers;
CREATE TRIGGER trg_portal_protect_customer_cnpj BEFORE UPDATE OF cnpj_cpf ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.portal_protect_customer_cnpj();

CREATE OR REPLACE FUNCTION public.portal_admin_change_cnpj(p_customer_id BIGINT, p_new_cnpj TEXT, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_role TEXT:=public._portal_actor_role(); v_normalized TEXT:=regexp_replace(coalesce(p_new_cnpj,''),'\D','','g'); v_account public.customer_portal_accounts%ROWTYPE;
BEGIN
  IF v_role <> 'administrativo' THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  IF length(v_normalized)<>14 THEN RAISE EXCEPTION 'CNPJ inválido.' USING ERRCODE='22023'; END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_account FROM public.customer_portal_accounts WHERE customer_id=p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro de Portal não encontrado para o Cliente.' USING ERRCODE='P0002'; END IF;
  PERFORM set_config('portal.allow_cnpj_change','true',true);
  UPDATE public.customers SET cnpj_cpf=v_normalized WHERE id=p_customer_id;
  UPDATE public.customer_portal_accounts SET login_cnpj=v_normalized WHERE id=v_account.id;
  PERFORM public._portal_log_event(p_customer_id,v_account.id,NULL,v_account.provisioning_decision,v_account.provisioning_decision,v_account.account_situation,v_account.account_situation,'administrativo',p_reason,NULL);
END; $$;
GRANT EXECUTE ON FUNCTION public.portal_admin_change_cnpj(BIGINT,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.portal_admin_change_cnpj(BIGINT,TEXT,TEXT) FROM anon;
