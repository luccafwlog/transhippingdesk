-- S09 — falha de recálculo de PTAX precisa ficar visível até a recuperação.
-- O runner usa o catálogo central e as funções de alerta já protegidas para
-- persistir um único item global, sem expor escrita de alertas ao browser.

INSERT INTO public.alert_type_catalog (
  type,
  severity,
  responsible_department,
  audience_departments,
  default_destination
)
VALUES (
  'demurrage_ptax_recalc_failed',
  'critical',
  'documentacao',
  ARRAY['documentacao'],
  '/demurrage'
)
ON CONFLICT (type) DO UPDATE SET
  severity = EXCLUDED.severity,
  responsible_department = EXCLUDED.responsible_department,
  audience_departments = EXCLUDED.audience_departments,
  default_destination = EXCLUDED.default_destination,
  active = EXCLUDED.active;
