-- 293: CNPJ canônico numérico ou alfanumérico em todo o sistema.
-- Rollback: remover as funções/triggers desta migration e restaurar as funções
-- Portal da migration 292; não executar rollback sobre dados já canonicalizados.

CREATE OR REPLACE FUNCTION public.normalize_cnpj(p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN NULLIF(upper(regexp_replace(p_value, '[^0-9A-Za-z]', '', 'g')), '');
END;
$$;

CREATE OR REPLACE FUNCTION public.is_valid_cnpj(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cnpj TEXT := public.normalize_cnpj(p_value);
  v_sum INTEGER;
  v_remainder INTEGER;
  v_digit INTEGER;
  v_weights INTEGER[];
  v_index INTEGER;
BEGIN
  IF v_cnpj !~ '^[0-9A-Z]{14}$' OR right(v_cnpj, 2) !~ '^[0-9]{2}$' THEN
    RETURN FALSE;
  END IF;

  v_weights := ARRAY[5,4,3,2,9,8,7,6,5,4,3,2];
  v_sum := 0;
  FOR v_index IN 1..12 LOOP
    v_sum := v_sum + (ascii(substr(v_cnpj, v_index, 1)) - 48) * v_weights[v_index];
  END LOOP;
  v_remainder := v_sum % 11;
  v_digit := 11 - v_remainder;
  IF v_digit >= 10 THEN v_digit := 0; END IF;
  IF v_digit <> substr(v_cnpj, 13, 1)::INTEGER THEN RETURN FALSE; END IF;

  v_weights := ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2];
  v_sum := 0;
  FOR v_index IN 1..13 LOOP
    v_sum := v_sum + (ascii(substr(v_cnpj, v_index, 1)) - 48) * v_weights[v_index];
  END LOOP;
  v_remainder := v_sum % 11;
  v_digit := 11 - v_remainder;
  IF v_digit >= 10 THEN v_digit := 0; END IF;
  RETURN v_digit = substr(v_cnpj, 14, 1)::INTEGER;
END;
$$;

-- Mantém os RPCs legados de reconciliação compatíveis com CNPJ alfanumérico.
CREATE OR REPLACE FUNCTION public.normalize_document_text(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.normalize_cnpj(COALESCE(p_value, ''));
$$;

REVOKE ALL ON FUNCTION public.normalize_cnpj(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_cnpj(TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_valid_cnpj(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_valid_cnpj(TEXT) TO authenticated, service_role;

-- O backfill também precisa atravessar a proteção de alteração de CNPJ da migration 184.
SET LOCAL portal.allow_cnpj_change = 'true';
UPDATE public.customers
SET cnpj_cpf = public.normalize_cnpj(cnpj_cpf)
WHERE cnpj_cpf IS DISTINCT FROM public.normalize_cnpj(cnpj_cpf);

UPDATE public.customer_portal_accounts AS a
SET login_cnpj = public.normalize_cnpj(c.cnpj_cpf)
FROM public.customers AS c
WHERE c.id = a.customer_id
  AND a.login_cnpj IS DISTINCT FROM public.normalize_cnpj(c.cnpj_cpf);

CREATE OR REPLACE FUNCTION public.canonicalize_customer_cnpj()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.cnpj_cpf := public.normalize_cnpj(NEW.cnpj_cpf);
  IF NEW.cnpj_cpf IS NULL OR NOT public.is_valid_cnpj(NEW.cnpj_cpf) THEN
    RAISE EXCEPTION 'CNPJ inválido.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.canonicalize_customer_cnpj() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_canonicalize_customer_cnpj ON public.customers;
CREATE TRIGGER trg_canonicalize_customer_cnpj
BEFORE INSERT OR UPDATE OF cnpj_cpf ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.canonicalize_customer_cnpj();

CREATE OR REPLACE FUNCTION public.portal_sync_login_cnpj()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.customer_portal_accounts
  SET login_cnpj = public.normalize_cnpj(NEW.cnpj_cpf)
  WHERE customer_id = NEW.id
    AND login_cnpj IS DISTINCT FROM public.normalize_cnpj(NEW.cnpj_cpf);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_sync_login_cnpj() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_portal_sync_login_cnpj ON public.customers;
CREATE TRIGGER trg_portal_sync_login_cnpj
AFTER UPDATE OF cnpj_cpf ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.portal_sync_login_cnpj();

CREATE OR REPLACE FUNCTION public.portal_normalize_login_cnpj()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.login_cnpj IS NOT NULL THEN
    NEW.login_cnpj := public.normalize_cnpj(NEW.login_cnpj);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_normalize_login_cnpj() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_portal_normalize_login_cnpj ON public.customer_portal_accounts;
CREATE TRIGGER trg_portal_normalize_login_cnpj
BEFORE INSERT OR UPDATE OF login_cnpj ON public.customer_portal_accounts
FOR EACH ROW EXECUTE FUNCTION public.portal_normalize_login_cnpj();

CREATE OR REPLACE FUNCTION public.portal_create_account_on_customer_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_account_id BIGINT;
BEGIN
  INSERT INTO public.customer_portal_accounts (customer_id, active, provisioning_decision, account_situation, login_cnpj)
  VALUES (NEW.id, false, 'aguardando_analise', 'sem_conta', public.normalize_cnpj(NEW.cnpj_cpf))
  ON CONFLICT (customer_id) DO NOTHING
  RETURNING id INTO v_account_id;

  IF v_account_id IS NOT NULL THEN
    INSERT INTO public.portal_provisioning_events (
      customer_id, account_id, previous_decision, new_decision,
      previous_situation, new_situation, actor_type, actor_id, reason, request_id
    ) VALUES (
      NEW.id, v_account_id, NULL, 'aguardando_analise', NULL, 'sem_conta',
      'sistema', NULL, 'Conta de Portal criada automaticamente no cadastro do Cliente.', NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_create_account_on_customer_insert() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_repair_missing_accounts()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_created BIGINT;
BEGIN
  WITH inserted AS (
    INSERT INTO public.customer_portal_accounts (customer_id, active, provisioning_decision, account_situation, login_cnpj)
    SELECT c.id, false, 'aguardando_analise', 'sem_conta', public.normalize_cnpj(c.cnpj_cpf)
    FROM public.customers AS c
    WHERE NOT EXISTS (SELECT 1 FROM public.customer_portal_accounts AS a WHERE a.customer_id = c.id)
    ON CONFLICT (customer_id) DO NOTHING
    RETURNING id, customer_id
  )
  INSERT INTO public.portal_provisioning_events (
    customer_id, account_id, previous_decision, new_decision,
    previous_situation, new_situation, actor_type, actor_id, reason, request_id
  )
  SELECT customer_id, id, NULL, 'aguardando_analise', NULL, 'sem_conta',
    'sistema', NULL, 'Reparo automático da fila do Portal durante a leitura.', NULL
  FROM inserted;
  GET DIAGNOSTICS v_created = ROW_COUNT;
  RETURN v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_repair_missing_accounts() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_provisioning_backfill(p_request_id TEXT DEFAULT NULL)
RETURNS TABLE(created_records BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_role TEXT := public._portal_actor_role(); v_created BIGINT;
BEGIN
  IF v_role IS DISTINCT FROM 'administrativo' THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  WITH inserted AS (
    INSERT INTO public.customer_portal_accounts (customer_id, active, provisioning_decision, account_situation, login_cnpj)
    SELECT c.id, false, 'aguardando_analise', 'sem_conta', public.normalize_cnpj(c.cnpj_cpf)
    FROM public.customers c
    WHERE NOT EXISTS (SELECT 1 FROM public.customer_portal_accounts a WHERE a.customer_id = c.id)
    RETURNING id, customer_id
  )
  INSERT INTO public.portal_provisioning_events (customer_id, account_id, new_decision, new_situation, actor_type, actor_id, reason, request_id)
  SELECT customer_id, id, 'aguardando_analise', 'sem_conta', 'sistema', auth.uid(), 'Backfill inicial do Portal', p_request_id FROM inserted;
  GET DIAGNOSTICS v_created = ROW_COUNT;
  RETURN QUERY SELECT v_created;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_admin_change_cnpj(p_customer_id BIGINT, p_new_cnpj TEXT, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_normalized TEXT := public.normalize_cnpj(COALESCE(p_new_cnpj, ''));
  v_account public.customer_portal_accounts%ROWTYPE;
BEGIN
  IF v_role IS DISTINCT FROM 'administrativo' THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  IF v_normalized IS NULL OR NOT public.is_valid_cnpj(v_normalized) THEN RAISE EXCEPTION 'CNPJ inválido.' USING ERRCODE='22023'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_account FROM public.customer_portal_accounts WHERE customer_id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro de Portal não encontrado para o Cliente.' USING ERRCODE='P0002'; END IF;
  PERFORM set_config('portal.allow_cnpj_change', 'true', true);
  UPDATE public.customers SET cnpj_cpf = v_normalized WHERE id = p_customer_id;
  UPDATE public.customer_portal_accounts SET login_cnpj = v_normalized WHERE id = v_account.id;
  PERFORM public._portal_log_event(p_customer_id, v_account.id, NULL, v_account.provisioning_decision, v_account.provisioning_decision, v_account.account_situation, v_account.account_situation, 'administrativo', p_reason, NULL);
  PERFORM set_config('portal.allow_cnpj_change', 'false', true);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_admin_change_cnpj(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_admin_change_cnpj(BIGINT, TEXT, TEXT) TO authenticated;
