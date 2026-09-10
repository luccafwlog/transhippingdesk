-- S05 — alerta persistente para efeitos que precisam de investigação.

INSERT INTO public.alert_type_catalog (
  type, severity, responsible_department, audience_departments, default_destination
)
VALUES (
  'import_effect_blocked',
  'critical',
  'documentacao',
  ARRAY['documentacao'],
  '/alertas'
)
ON CONFLICT (type) DO UPDATE SET
  severity = EXCLUDED.severity,
  responsible_department = EXCLUDED.responsible_department,
  audience_departments = EXCLUDED.audience_departments,
  default_destination = EXCLUDED.default_destination,
  active = true;
