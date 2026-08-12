-- 288: Mantém o CNPJ de login do Portal canônico, somente com dígitos.

UPDATE public.customer_portal_accounts AS a
SET login_cnpj = regexp_replace(c.cnpj_cpf, '\D', '', 'g')
FROM public.customers AS c
WHERE c.id = a.customer_id
  AND NULLIF(regexp_replace(c.cnpj_cpf, '\D', '', 'g'), '') IS NOT NULL
  AND a.login_cnpj IS DISTINCT FROM regexp_replace(c.cnpj_cpf, '\D', '', 'g');

CREATE OR REPLACE FUNCTION public.portal_sync_login_cnpj()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  UPDATE public.customer_portal_accounts
  SET login_cnpj = regexp_replace(NEW.cnpj_cpf, '\D', '', 'g')
  WHERE customer_id = NEW.id
    AND login_cnpj IS DISTINCT FROM regexp_replace(NEW.cnpj_cpf, '\D', '', 'g');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portal_sync_login_cnpj ON public.customers;
CREATE TRIGGER trg_portal_sync_login_cnpj
AFTER UPDATE OF cnpj_cpf ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.portal_sync_login_cnpj();

CREATE OR REPLACE FUNCTION public.portal_normalize_login_cnpj()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.login_cnpj IS NOT NULL THEN
    NEW.login_cnpj := regexp_replace(NEW.login_cnpj, '\D', '', 'g');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portal_normalize_login_cnpj ON public.customer_portal_accounts;
CREATE TRIGGER trg_portal_normalize_login_cnpj
BEFORE INSERT OR UPDATE OF login_cnpj ON public.customer_portal_accounts
FOR EACH ROW EXECUTE FUNCTION public.portal_normalize_login_cnpj();
