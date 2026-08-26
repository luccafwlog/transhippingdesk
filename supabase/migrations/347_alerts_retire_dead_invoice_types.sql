-- 347: aposenta no catálogo os dois tipos de alerta que já não têm produtor.
--
-- A migration 327 retirou 'invoice_payment_invalid' e 'invoice_cancel_blocked'
-- do gatilho route_catalog_alert_insert e fechou os itens abertos. Desde então
-- nenhuma função abre item desses tipos: register_invoice_payment e
-- cancel_invoice apenas registram a recusa em audit_logs e devolvem erro ao
-- operador. O catálogo, porém, continuava marcando os dois como ativos, o que
-- fazia a tela /alertas/regras prometer alertas que nunca chegam.
--
-- Efeito de active = false: route_catalog_alert_insert e a sobrecarga de
-- compatibilidade upsert_alert_item/7 deixam de aceitar o tipo. Ambos já eram
-- inalcançáveis para estes dois tipos, então não há mudança de comportamento —
-- apenas o catálogo passa a dizer a verdade. resolve_alert_item não consulta o
-- catálogo e continua fechando qualquer item histórico.
--
-- Rollback: UPDATE public.alert_type_catalog SET active = true
--   WHERE type IN ('invoice_payment_invalid', 'invoice_cancel_blocked');

UPDATE public.alert_type_catalog
SET active = false
WHERE type IN ('invoice_payment_invalid', 'invoice_cancel_blocked');

DO $verify$
DECLARE
  v_active INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_active
  FROM public.alert_type_catalog
  WHERE active AND type IN ('invoice_payment_invalid', 'invoice_cancel_blocked');
  IF v_active <> 0 THEN
    RAISE EXCEPTION 'Tipos aposentados continuam ativos no catálogo de alertas.';
  END IF;
END;
$verify$;
