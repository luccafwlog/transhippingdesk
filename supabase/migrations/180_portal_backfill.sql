-- 180: Pré-voo e backfill inicial do Portal; nenhuma identidade Auth é criada.
CREATE OR REPLACE FUNCTION public.portal_provisioning_preflight()
RETURNS TABLE(total_customers BIGINT, existing_portal_records BIGINT, existing_auth_links BIGINT, existing_recovery_emails BIGINT, customers_missing_record BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
SELECT (SELECT count(*) FROM public.customers),
       (SELECT count(*) FROM public.customer_portal_accounts),
       (SELECT count(*) FROM public.customer_portal_accounts WHERE auth_user_id IS NOT NULL),
       (SELECT count(*) FROM public.customer_portal_accounts WHERE recovery_email IS NOT NULL),
       (SELECT count(*) FROM public.customers c WHERE NOT EXISTS (SELECT 1 FROM public.customer_portal_accounts a WHERE a.customer_id=c.id));
$$;
GRANT EXECUTE ON FUNCTION public.portal_provisioning_preflight() TO authenticated;
REVOKE ALL ON FUNCTION public.portal_provisioning_preflight() FROM anon;

CREATE OR REPLACE FUNCTION public.portal_provisioning_backfill(p_request_id TEXT DEFAULT NULL)
RETURNS TABLE(created_records BIGINT) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_role TEXT := public._portal_actor_role(); v_created BIGINT;
BEGIN
  IF v_role <> 'administrativo' THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  WITH inserted AS (
    INSERT INTO public.customer_portal_accounts(customer_id,active,provisioning_decision,account_situation,login_cnpj)
    SELECT c.id,false,'aguardando_analise','sem_conta',regexp_replace(c.cnpj_cpf,'\D','','g')
    FROM public.customers c WHERE NOT EXISTS (SELECT 1 FROM public.customer_portal_accounts a WHERE a.customer_id=c.id)
    RETURNING id,customer_id
  )
  INSERT INTO public.portal_provisioning_events(customer_id,account_id,new_decision,new_situation,actor_type,actor_id,reason,request_id)
  SELECT customer_id,id,'aguardando_analise','sem_conta','sistema',auth.uid(),'Backfill inicial do Portal',p_request_id FROM inserted;
  GET DIAGNOSTICS v_created=ROW_COUNT;
  RETURN QUERY SELECT v_created;
END; $$;
GRANT EXECUTE ON FUNCTION public.portal_provisioning_backfill(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.portal_provisioning_backfill(TEXT) FROM anon;
