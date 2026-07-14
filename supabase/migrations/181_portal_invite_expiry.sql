-- 181: Expiração idempotente de convites vencidos.
CREATE OR REPLACE FUNCTION public.portal_mark_expired_invites()
RETURNS TABLE(expired_count BIGINT) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_count BIGINT:=0; r RECORD;
BEGIN
  FOR r IN SELECT i.id invite_id,i.account_id,a.customer_id,a.provisioning_decision,a.account_situation
    FROM public.portal_invites i JOIN public.customer_portal_accounts a ON a.id=i.account_id
    WHERE i.status='pendente' AND i.purpose='convite' AND i.expires_at<now() FOR UPDATE OF i
  LOOP
    UPDATE public.portal_invites SET status='expirado' WHERE id=r.invite_id;
    UPDATE public.customer_portal_accounts SET account_situation='convite_expirado' WHERE id=r.account_id AND account_situation='convite_pendente';
    PERFORM public._portal_log_event(r.customer_id,r.account_id,r.invite_id,r.provisioning_decision,r.provisioning_decision,r.account_situation,'convite_expirado','sistema','Convite expirado após 48 horas',NULL);
    INSERT INTO public.alerts(type,entity_type,entity_id,message,status)
    SELECT 'portal_convite_expirado','customer',r.customer_id::text,'Convite do Portal expirou sem ativação. Reenvio manual necessário.','open'
    WHERE NOT EXISTS (SELECT 1 FROM public.alerts al WHERE al.type='portal_convite_expirado' AND al.entity_type='customer' AND al.entity_id=r.customer_id::text AND al.status<>'closed');
    v_count:=v_count+1;
  END LOOP;
  RETURN QUERY SELECT v_count;
END; $$;
REVOKE ALL ON FUNCTION public.portal_mark_expired_invites() FROM PUBLIC,anon,authenticated;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'portal-mark-expired-invites') THEN
      PERFORM cron.unschedule('portal-mark-expired-invites');
    END IF;
    PERFORM cron.schedule('portal-mark-expired-invites','*/15 * * * *',$$SELECT public.portal_mark_expired_invites();$$);
  END IF;
END;
$do$;
