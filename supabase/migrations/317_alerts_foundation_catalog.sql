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
  ('invoice_payment_invalid', 'critical', 'documentacao', ARRAY['documentacao'], '/taxas-locais'),
  ('invoice_cancel_blocked', 'critical', 'documentacao', ARRAY['documentacao'], '/taxas-locais'),
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

-- Preserve the read model body assembled by migrations 292/295/299. Only the
-- critical-alert expression is patched, so recovery-email fields, role
-- widening, and the Equipamentos self-heal exemption cannot regress here.
DO $console$
DECLARE
  v_def TEXT;
  v_start INTEGER;
  v_end INTEGER;
  v_replacement TEXT := $replacement$
    'has_critical_alert', EXISTS (
      SELECT 1
      FROM public.alerts al
      JOIN public.alert_type_catalog atc
        ON atc.type = al.type AND atc.active AND atc.severity = 'critical'
      WHERE al.status <> 'closed'
        AND (
          (al.entity_type = 'customer' AND al.entity_id = c.id::text)
          OR (al.entity_type = 'invoice' AND EXISTS (
            SELECT 1 FROM public.invoices ai
            WHERE ai.customer_id = c.id
              AND (ai.invoice_number = al.entity_id
                OR ai.id = CASE WHEN al.entity_id ~ '^[0-9]+$' THEN al.entity_id::bigint END)
          ))
        )
    )
  $replacement$;
BEGIN
  v_def := pg_get_functiondef('public.portal_list_provisioning_console(bigint)'::regprocedure);
  v_start := position('''has_critical_alert''' IN v_def);
  v_end := position('''has_open_invoice'', EXISTS (' IN v_def);
  WHILE v_end > 0 AND substr(v_def, v_end - 1, 1) ~ '[[:space:]]' LOOP
    v_end := v_end - 1;
  END LOOP;
  v_end := v_end - 1;
  IF v_start = 0 OR v_end <= v_start THEN
    RAISE EXCEPTION 'Âncoras do has_critical_alert não encontradas; revise a migration 317.';
  END IF;
  v_def := substr(v_def, 1, v_start - 1) || v_replacement || substr(v_def, v_end);
  EXECUTE v_def;
END;
$console$;
