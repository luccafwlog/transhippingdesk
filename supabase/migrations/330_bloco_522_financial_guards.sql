-- 326: bloqueios forward para retirar Granito do faturamento financeiro.
--
-- As funções históricas permanecem no catálogo para preservar auditabilidade,
-- mas nenhum overload de create_invoice_from_granite_bls pode mais emitir uma
-- invoice. O trigger abaixo também impede que o cancelamento legado converta
-- novamente um B/L Granito para ready_for_billing.
-- Rollback: restaurar as definições históricas de 064 em banco descartável;
-- não reabrir o fluxo financeiro de Granito em produção.

CREATE OR REPLACE FUNCTION public.create_invoice_from_granite_bls(
  p_granite_bl_ids UUID[],
  p_customer_id BIGINT DEFAULT NULL,
  p_due_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'Granito não participa do faturamento financeiro.' USING ERRCODE = 'PT409';
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_invoice_from_granite_bls(
  p_granite_bl_ids UUID[],
  p_customer_id BIGINT,
  p_due_date DATE,
  p_notes TEXT,
  p_issue_now BOOLEAN,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'Granito não participa do faturamento financeiro.' USING ERRCODE = 'PT409';
END;
$function$;

REVOKE ALL ON FUNCTION public.create_invoice_from_granite_bls(UUID[], BIGINT, DATE, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_invoice_from_granite_bls(UUID[], BIGINT, DATE, TEXT, BOOLEAN, UUID)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_granite_financial_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.charge_status = 'ready_for_billing' THEN
    NEW.charge_status := 'calculated';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_granite_financial_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_granite_financial_status_on_change ON public.granite_bls;
CREATE TRIGGER guard_granite_financial_status_on_change
  BEFORE INSERT OR UPDATE OF charge_status ON public.granite_bls
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_granite_financial_status();

