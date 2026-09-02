-- 197: Corrige cast de alerts.entity_id (invoice_number textual, migration 168)
-- e inclui BLs com financial_status nulo em has_active_process.
CREATE OR REPLACE FUNCTION public.portal_list_provisioning_console(p_customer_id BIGINT DEFAULT NULL)
RETURNS SETOF JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_full_access BOOLEAN := v_role IN ('administrativo','documentacao','financeiro');
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('administrativo','documentacao','financeiro','operacoes') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'account_id', a.id,
    'customer_id', c.id,
    'customer_name', c.name,
    'cnpj_cpf', c.cnpj_cpf,
    'provisioning_decision', a.provisioning_decision,
    'account_situation', CASE WHEN a.account_situation = 'convite_pendente' AND pi.expires_at < now() THEN 'convite_expirado' ELSE a.account_situation END,
    'recovery_email', CASE WHEN v_full_access THEN a.recovery_email ELSE NULL END,
    'recovery_email_source', CASE WHEN v_full_access THEN a.recovery_email_source ELSE NULL END,
    'pending_invite_expires_at', pi.expires_at,
    'latest_delivery_status', CASE WHEN v_full_access THEN ea.status ELSE NULL END,
    'exception_reason', CASE WHEN v_full_access THEN ex.reason ELSE NULL END,
    'last_event_at', ev.created_at,
    'has_critical_alert', EXISTS (
      SELECT 1 FROM public.alerts al
      WHERE al.status <> 'closed'
        AND al.type IN ('portal_excecao_critica_fatura','portal_convite_expirado','portal_falha_envio','portal_abuso_login')
        AND (
          (al.entity_type = 'customer' AND al.entity_id = c.id::text)
          OR (al.entity_type = 'invoice' AND EXISTS (
            SELECT 1 FROM public.invoices ai
            WHERE ai.customer_id = c.id
              AND (ai.invoice_number = al.entity_id
                   OR ai.id = CASE WHEN al.entity_id ~ '^[0-9]+$' THEN al.entity_id::bigint END)
          ))
        )
    ),
    'has_open_invoice', EXISTS (SELECT 1 FROM public.invoices i WHERE i.customer_id = c.id AND i.status IN ('issued','overdue')),
    'has_active_process', EXISTS (SELECT 1 FROM public.bls b WHERE b.customer_id = c.id AND b.financial_status IS DISTINCT FROM 'cancelled'),
    'candidates', CASE WHEN v_full_access THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('email', cc.email, 'purpose', cc.purpose, 'origin', 'Contato do Cliente') ORDER BY cc.id) FROM public.customer_contacts cc WHERE cc.customer_id = c.id AND cc.email IS NOT NULL AND cc.purpose IN ('geral','financeiro','operacional','faturamento')), '[]'::jsonb) ELSE '[]'::jsonb END,
    'shared_email_count', CASE WHEN v_full_access AND a.recovery_email IS NOT NULL THEN (SELECT count(*) FROM public.customer_portal_accounts other WHERE lower(other.recovery_email) = lower(a.recovery_email) AND other.id <> a.id) ELSE 0 END
  )
  FROM public.customer_portal_accounts a
  JOIN public.customers c ON c.id = a.customer_id
  LEFT JOIN LATERAL (SELECT expires_at FROM public.portal_invites WHERE account_id = a.id AND purpose = 'convite' AND status = 'pendente' ORDER BY created_at DESC LIMIT 1) pi ON true
  LEFT JOIN LATERAL (SELECT status FROM public.portal_email_attempts WHERE account_id = a.id ORDER BY created_at DESC LIMIT 1) ea ON true
  LEFT JOIN LATERAL (SELECT reason, created_at FROM public.portal_provisioning_events WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1) ev ON true
  LEFT JOIN LATERAL (SELECT reason FROM public.portal_provisioning_events WHERE customer_id = c.id AND new_decision = 'provisionamento_nao_necessario' ORDER BY created_at DESC LIMIT 1) ex ON true
  WHERE p_customer_id IS NULL OR c.id = p_customer_id
  ORDER BY c.name;
END; $$;
GRANT EXECUTE ON FUNCTION public.portal_list_provisioning_console(BIGINT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_list_provisioning_console(BIGINT) FROM PUBLIC, anon;
