-- 190: Pendência geral de prontidão do Portal (issue #370).
-- A falta de Portal não bloqueia revisão/faturamento; fica visível como alerta.

CREATE OR REPLACE FUNCTION public.portal_refresh_general_pendencies()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
  SELECT DISTINCT 'portal_pendencia_geral', 'customer', c.id::text,
         'Cliente com processo ativo sem Portal ativo ou sem Email de Recuperação.',
         'open'
  FROM public.customers c
  JOIN public.bls b ON b.customer_id = c.id
  LEFT JOIN public.customer_portal_accounts a ON a.customer_id = c.id
  WHERE (a.id IS NULL OR a.recovery_email IS NULL OR a.account_situation <> 'ativo')
    AND COALESCE(a.provisioning_decision, 'aguardando_analise') <> 'provisionamento_nao_necessario'
    AND NOT EXISTS (
      SELECT 1 FROM public.alerts al
      WHERE al.type = 'portal_pendencia_geral'
        AND al.entity_type = 'customer'
        AND al.entity_id = c.id::text
        AND al.status <> 'closed');

  UPDATE public.alerts al
  SET status = 'closed', closed_at = now()
  WHERE al.type = 'portal_pendencia_geral'
    AND al.status <> 'closed'
    AND EXISTS (
      SELECT 1 FROM public.customer_portal_accounts a
      WHERE a.customer_id = al.entity_id::bigint
        AND (a.account_situation = 'ativo'
             OR a.provisioning_decision = 'provisionamento_nao_necessario'));
END;
$$;

REVOKE ALL ON FUNCTION public.portal_refresh_general_pendencies() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'portal-refresh-general-pendencies') THEN
      PERFORM cron.unschedule('portal-refresh-general-pendencies');
    END IF;
    PERFORM cron.schedule(
      'portal-refresh-general-pendencies', '*/15 * * * *',
      $cron$SELECT public.portal_refresh_general_pendencies();$cron$
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_reopen_on_new_process()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    UPDATE public.customer_portal_accounts a
    SET provisioning_decision = 'aguardando_analise'
    WHERE a.customer_id = NEW.customer_id
      AND a.provisioning_decision = 'provisionamento_nao_necessario';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portal_reopen_on_new_process ON public.bls;
CREATE TRIGGER trg_portal_reopen_on_new_process
AFTER INSERT OR UPDATE OF customer_id ON public.bls
FOR EACH ROW EXECUTE FUNCTION public.portal_reopen_on_new_process();
