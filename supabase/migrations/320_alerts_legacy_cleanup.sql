-- 320: encerra o tipo legado de alerta do ADR.
--
-- A migration 225 tornou a unidade departamental; esta limpeza preserva as
-- linhas antigas para auditoria, mas não deixa o tipo aposentado na fila viva.
UPDATE public.alerts
SET status = 'closed', closed_at = COALESCE(closed_at, now())
WHERE type = 'agency_report_section_pending'
  AND status <> 'closed';

COMMENT ON COLUMN public.alerts.type IS
  'Tipo histórico ou aggregate; itens novos vivem em alert_items e usam o catálogo central.';
