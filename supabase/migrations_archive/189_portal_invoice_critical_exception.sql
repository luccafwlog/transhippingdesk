-- 189: Exceção crítica da fatura (issue #370).
-- Abre na transição para issued quando falta email de recuperação ou Portal ativo.
-- Encerra quando a fatura deixa de estar aberta; não toca a pendência geral.

CREATE OR REPLACE FUNCTION public.portal_invoice_exception_on_issue()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_missing BOOLEAN;
BEGIN
  IF NEW.status <> 'issued' OR OLD.status = 'issued' OR NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT (a.recovery_email IS NULL OR a.account_situation <> 'ativo')
    INTO v_missing
  FROM public.customer_portal_accounts a
  WHERE a.customer_id = NEW.customer_id;
  v_missing := COALESCE(v_missing, true);
  IF NOT v_missing THEN RETURN NEW; END IF;

  INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
  SELECT 'portal_excecao_critica_fatura', 'invoice', NEW.id::text,
         'Fatura emitida sem Email de Recuperação ou Portal ativo. Provisionar acesso do Cliente.',
         'open'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.alerts al
    WHERE al.type = 'portal_excecao_critica_fatura'
      AND al.entity_type = 'invoice'
      AND al.entity_id = NEW.id::text
      AND al.status <> 'closed');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portal_invoice_exception_open ON public.invoices;
CREATE TRIGGER trg_portal_invoice_exception_open
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.portal_invoice_exception_on_issue();

CREATE OR REPLACE FUNCTION public.portal_invoice_exception_on_close()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF NEW.status IN ('paid', 'covered', 'cancelled', 'obsolete')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.alerts
    SET status = 'closed', closed_at = now()
    WHERE type = 'portal_excecao_critica_fatura'
      AND entity_type = 'invoice'
      AND entity_id = NEW.id::text
      AND status <> 'closed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portal_invoice_exception_close ON public.invoices;
CREATE TRIGGER trg_portal_invoice_exception_close
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.portal_invoice_exception_on_close();
