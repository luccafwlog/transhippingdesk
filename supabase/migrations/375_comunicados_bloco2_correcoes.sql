-- 375: correções de segurança e modelos reutilizáveis do Bloco 2.

-- O upload passa exclusivamente pela Edge Function, que valida o comunicado
-- e grava os metadados junto do histórico.
DO $storage$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS customer_communications_objects_insert ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS customer_communications_objects_update ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS customer_communications_objects_delete ON storage.objects';
  END IF;
END;
$storage$;

CREATE TABLE IF NOT EXISTS public.customer_communication_saved_templates (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  subject TEXT NOT NULL CHECK (char_length(btrim(subject)) > 0),
  body TEXT NOT NULL CHECK (char_length(btrim(body)) > 0),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_customer_communication_saved_templates_updated_at
  ON public.customer_communication_saved_templates;
CREATE TRIGGER set_customer_communication_saved_templates_updated_at
  BEFORE UPDATE ON public.customer_communication_saved_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.customer_communication_saved_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customer_communication_saved_templates FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.customer_communication_saved_templates TO authenticated;
GRANT ALL ON TABLE public.customer_communication_saved_templates TO service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.customer_communication_saved_templates FROM authenticated;
REVOKE ALL ON SEQUENCE public.customer_communication_saved_templates_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.customer_communication_saved_templates_id_seq TO service_role;

DROP POLICY IF EXISTS customer_communication_saved_templates_internal_read
  ON public.customer_communication_saved_templates;
CREATE POLICY customer_communication_saved_templates_internal_read
  ON public.customer_communication_saved_templates FOR SELECT TO authenticated
  USING (public.is_active_read_user());

CREATE OR REPLACE FUNCTION public.list_customer_communication_saved_templates()
RETURNS SETOF public.customer_communication_saved_templates
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.customer_communication_saved_templates
  WHERE public.is_active_read_user()
  ORDER BY name, id;
$$;

CREATE OR REPLACE FUNCTION public.save_customer_communication_saved_template(
  p_name TEXT, p_subject TEXT, p_body TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_id BIGINT;
BEGIN
  IF public._portal_actor_role() NOT IN ('admin', 'administrativo', 'operator', 'documentacao', 'equipamentos') THEN
    RAISE EXCEPTION 'Sem permissão para salvar modelos.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.customer_communication_saved_templates (name, subject, body, created_by)
  VALUES (btrim(p_name), btrim(p_subject), btrim(p_body), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_customer_communication_saved_templates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_customer_communication_saved_templates() TO authenticated;
REVOKE ALL ON FUNCTION public.save_customer_communication_saved_template(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_customer_communication_saved_template(TEXT, TEXT, TEXT) TO authenticated;

-- O estado "válido" para o canal é definido apenas por bounce permanente;
-- complaint do Portal é uma supressão de outro canal.
CREATE OR REPLACE FUNCTION public.resolve_customer_contact_bounce_alert_on_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NULLIF(btrim(NEW.email), '') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.portal_suppressed_emails pse
       WHERE lower(btrim(pse.email)) = lower(btrim(NEW.email))
         AND pse.reason = 'bounce_permanente'
     ) THEN
    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    PERFORM public.resolve_alert_item(
      'cliente_contato_bounced_sem_alternativa', 'customer', NEW.customer_id::TEXT,
      'customer_contact_change', jsonb_build_object('contact_id', NEW.id)
    );
    PERFORM set_config('alerts.foundation_trigger', 'off', true);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RAISE WARNING 'Reconciliação de alerta de bounce ignorada para customer_contacts.id=%: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS resolve_customer_contact_bounce_alert_on_change ON public.customer_contacts;
CREATE TRIGGER resolve_customer_contact_bounce_alert_on_change
  AFTER INSERT OR UPDATE OF email ON public.customer_contacts
  FOR EACH ROW EXECUTE FUNCTION public.resolve_customer_contact_bounce_alert_on_change();
