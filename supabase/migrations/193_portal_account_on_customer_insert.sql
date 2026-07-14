-- 193: Create the Portal queue row whenever a Customer is created.
-- No Auth identity, password, invite, recovery email, or outbound email is created here.

CREATE OR REPLACE FUNCTION public.portal_create_account_on_customer_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_account_id BIGINT;
BEGIN
  INSERT INTO public.customer_portal_accounts (
    customer_id, active, provisioning_decision, account_situation, login_cnpj
  )
  VALUES (
    NEW.id, false, 'aguardando_analise', 'sem_conta',
    regexp_replace(NEW.cnpj_cpf, '\D', '', 'g')
  )
  ON CONFLICT (customer_id) DO NOTHING
  RETURNING id INTO v_account_id;

  IF v_account_id IS NOT NULL THEN
    INSERT INTO public.portal_provisioning_events (
      customer_id, account_id, previous_decision, new_decision,
      previous_situation, new_situation, actor_type, actor_id,
      reason, request_id
    )
    VALUES (
      NEW.id, v_account_id, NULL, 'aguardando_analise',
      NULL, 'sem_conta', 'sistema', NULL,
      'Conta de Portal criada automaticamente no cadastro do Cliente.', NULL
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_create_account_on_customer_insert()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_portal_create_account_on_customer_insert
ON public.customers;
CREATE TRIGGER trg_portal_create_account_on_customer_insert
AFTER INSERT ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.portal_create_account_on_customer_insert();

WITH inserted AS (
  INSERT INTO public.customer_portal_accounts (
    customer_id, active, provisioning_decision, account_situation, login_cnpj
  )
  SELECT
    c.id, false, 'aguardando_analise', 'sem_conta',
    regexp_replace(c.cnpj_cpf, '\D', '', 'g')
  FROM public.customers AS c
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.customer_portal_accounts AS a
    WHERE a.customer_id = c.id
  )
  ON CONFLICT (customer_id) DO NOTHING
  RETURNING id, customer_id
)
INSERT INTO public.portal_provisioning_events (
  customer_id, account_id, previous_decision, new_decision,
  previous_situation, new_situation, actor_type, actor_id,
  reason, request_id
)
SELECT
  customer_id, id, NULL, 'aguardando_analise',
  NULL, 'sem_conta', 'sistema', NULL,
  'Reparo automático da conta de Portal para Cliente existente.', NULL
FROM inserted;
