-- 317: catálogo transversal de Alertas e Notificações Internas.
--
-- A gravidade é dado de domínio, não uma lista copiada em cada read model.
-- Producers futuros devem usar alert_type_catalog/upsert_alert_item; as
-- migrations históricas 196, 197 e 198 permanecem imutáveis.

CREATE TABLE IF NOT EXISTS public.alert_type_catalog (
  type TEXT PRIMARY KEY,
  severity TEXT NOT NULL CHECK (severity IN ('normal', 'critical')),
  responsible_department TEXT,
  audience_departments TEXT[] NOT NULL DEFAULT '{}',
  default_destination TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.alert_type_catalog IS
  'Catálogo único de tipo, gravidade, audiência e destino dos itens de alerta.';

INSERT INTO public.alert_type_catalog (
  type, severity, responsible_department, audience_departments, default_destination
)
VALUES
  ('review_customer_unlinked', 'critical', 'documentacao', ARRAY['documentacao'], '/revisao'),
  ('review_customer_email_missing', 'critical', 'documentacao', ARRAY['documentacao'], '/revisao'),
  ('review_portal_not_ready', 'critical', 'documentacao', ARRAY['documentacao'], '/clientes/portal'),
  ('review_breakbulk_weight_missing', 'critical', 'documentacao', ARRAY['documentacao'], '/revisao'),
  ('review_granite_customer_unlinked', 'critical', 'documentacao', ARRAY['documentacao'], '/revisao'),
  ('billing_calculation_blocked', 'critical', 'documentacao', ARRAY['documentacao'], '/taxas-locais'),
  ('billing_auto_issue_failed', 'critical', 'documentacao', ARRAY['documentacao'], '/taxas-locais'),
  ('invoice_overdue', 'normal', 'documentacao', ARRAY['documentacao'], '/taxas-locais'),
  ('pix_unreconciled', 'critical', 'documentacao', ARRAY['documentacao', 'equipamentos'], '/reconciliacao'),
  ('portal_dispute_opened', 'normal', 'equipamentos', ARRAY['equipamentos'], '/demurrage'),
  ('portal_pendencia_geral', 'normal', 'documentacao', ARRAY['documentacao'], '/clientes/portal'),
  ('portal_convite_expirado', 'normal', 'documentacao', ARRAY['documentacao'], '/clientes/portal'),
  ('portal_falha_envio', 'normal', 'documentacao', ARRAY['documentacao'], '/clientes/portal'),
  ('portal_email_suprimido', 'normal', 'documentacao', ARRAY['documentacao'], '/clientes/portal'),
  ('portal_abuso_login', 'critical', 'documentacao', ARRAY['documentacao'], '/clientes/portal'),
  ('portal_excecao_critica_fatura', 'critical', 'documentacao', ARRAY['documentacao'], '/manifestos'),
  ('voyage_bl_expected', 'critical', 'documentacao', ARRAY['documentacao'], '/viagens'),
  ('voyage_baplie_missing', 'critical', 'documentacao', ARRAY['documentacao'], '/baplie'),
  ('voyage_baplie_documentary_coverage', 'critical', 'documentacao', ARRAY['documentacao'], '/baplie'),
  ('voyage_ce_mercante_missing', 'critical', 'documentacao', ARRAY['documentacao'], '/viagens'),
  ('voyage_schedule_date_pending', 'normal', 'operacoes', ARRAY['operacoes', 'documentacao'], '/viagens'),
  ('voyage_terminal_date_pending', 'normal', 'operacoes', ARRAY['operacoes', 'documentacao'], '/viagens'),
  ('voyage_export_after_atd', 'normal', 'operacoes', ARRAY['operacoes'], '/viagens'),
  ('agency_report_department_pending', 'normal', 'documentacao', ARRAY['documentacao'], '/viagens'),
  ('agency_report_deadline_missed', 'critical', 'documentacao', ARRAY['documentacao'], '/viagens')
ON CONFLICT (type) DO UPDATE SET
  severity = EXCLUDED.severity,
  responsible_department = EXCLUDED.responsible_department,
  audience_departments = EXCLUDED.audience_departments,
  default_destination = EXCLUDED.default_destination,
  active = EXCLUDED.active;

CREATE INDEX IF NOT EXISTS idx_alert_type_catalog_critical
  ON public.alert_type_catalog (type)
  WHERE active AND severity = 'critical';

ALTER TABLE public.alert_type_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alert_type_catalog_select_active ON public.alert_type_catalog;
CREATE POLICY alert_type_catalog_select_active
  ON public.alert_type_catalog FOR SELECT TO authenticated
  USING (public.is_active_user());

GRANT SELECT ON public.alert_type_catalog TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.alert_type_catalog FROM authenticated, anon, PUBLIC;

-- The console read model remains the same contract, but its critical flag now
-- reads the catalog rather than embedding a second list of types.
CREATE OR REPLACE FUNCTION public.portal_list_provisioning_console(p_customer_id BIGINT DEFAULT NULL)
RETURNS SETOF JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_full_access BOOLEAN := v_role IN ('administrativo','documentacao','financeiro');
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('administrativo','documentacao','financeiro','operacoes') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;

  PERFORM public.portal_repair_missing_accounts();

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
      SELECT 1
      FROM public.alerts al
      JOIN public.alert_type_catalog atc ON atc.type = al.type AND atc.active AND atc.severity = 'critical'
      WHERE al.status <> 'closed'
        AND (
          (al.entity_type = 'customer' AND al.entity_id = c.id::text)
          OR (al.entity_type = 'invoice' AND EXISTS (
            SELECT 1 FROM public.invoices ai
            WHERE ai.customer_id = c.id
              AND (ai.invoice_number = al.entity_id OR ai.id = CASE WHEN al.entity_id ~ '^[0-9]+$' THEN al.entity_id::bigint END)
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_list_provisioning_console(BIGINT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_list_provisioning_console(BIGINT) FROM PUBLIC, anon;
