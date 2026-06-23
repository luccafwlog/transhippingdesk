-- Create the customer master record and its initial contacts atomically.
CREATE OR REPLACE FUNCTION public.create_customer_with_contacts(
  p_customer JSONB,
  p_contacts JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_customer public.customers%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas para criar cliente.' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_customer) <> 'object'
     OR jsonb_typeof(p_contacts) <> 'array'
     OR NULLIF(BTRIM(p_customer->>'cnpj_cpf'), '') IS NULL
     OR NULLIF(BTRIM(p_customer->>'name'), '') IS NULL THEN
    RAISE EXCEPTION 'Cadastro de cliente invalido.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.customers (
    cnpj_cpf, name, trade_name, address, city, state, zip, notes
  )
  VALUES (
    BTRIM(p_customer->>'cnpj_cpf'),
    BTRIM(p_customer->>'name'),
    NULLIF(BTRIM(p_customer->>'trade_name'), ''),
    NULLIF(BTRIM(p_customer->>'address'), ''),
    NULLIF(BTRIM(p_customer->>'city'), ''),
    NULLIF(BTRIM(p_customer->>'state'), ''),
    NULLIF(BTRIM(p_customer->>'zip'), ''),
    NULLIF(BTRIM(p_customer->>'notes'), '')
  )
  RETURNING * INTO v_customer;

  INSERT INTO public.customer_contacts (
    customer_id, name, email, phone, purpose, is_primary
  )
  SELECT
    v_customer.id,
    BTRIM(contact.name),
    NULLIF(BTRIM(contact.email), ''),
    NULLIF(BTRIM(contact.phone), ''),
    COALESCE(NULLIF(BTRIM(contact.purpose), ''), 'geral'),
    COALESCE(contact.is_primary, false)
  FROM jsonb_to_recordset(p_contacts) AS contact(
    name TEXT,
    email TEXT,
    phone TEXT,
    purpose TEXT,
    is_primary BOOLEAN
  )
  WHERE NULLIF(BTRIM(contact.name), '') IS NOT NULL;

  RETURN to_jsonb(v_customer);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_customer_with_contacts(JSONB, JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_customer_with_contacts(JSONB, JSONB)
  TO authenticated;
