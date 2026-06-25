-- Renumbered from 20260622173159 (original timestamped migration: 20260622173159_atomic_customer_update_audit.sql).
-- Update the editable customer master fields and their audit rows atomically.
-- The function remains SECURITY INVOKER so the existing customers/audit_logs
-- RLS policies continue to authorize both writes.

CREATE OR REPLACE FUNCTION public.update_customer_with_audit(
  p_customer_id BIGINT,
  p_updates JSONB,
  p_changed_by UUID,
  p_justification TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_before public.customers%ROWTYPE;
  v_after public.customers%ROWTYPE;
  v_invalid_key TEXT;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para editar cliente.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_justification, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para editar cliente.' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_updates) <> 'object' OR p_updates = '{}'::JSONB THEN
    RETURN FALSE;
  END IF;

  SELECT key
  INTO v_invalid_key
  FROM jsonb_object_keys(p_updates) AS key
  WHERE key NOT IN (
    'name',
    'trade_name',
    'address',
    'city',
    'state',
    'zip',
    'notes',
    'payment_terms_days',
    'discount_pct',
    'commercial_notes'
  )
  LIMIT 1;

  IF v_invalid_key IS NOT NULL THEN
    RAISE EXCEPTION 'Campo de cliente nao editavel: %.', v_invalid_key USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_before
  FROM public.customers
  WHERE id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente % nao encontrado.', p_customer_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.customers
  SET
    name = CASE WHEN p_updates ? 'name' THEN p_updates->>'name' ELSE name END,
    trade_name = CASE WHEN p_updates ? 'trade_name' THEN NULLIF(p_updates->>'trade_name', '') ELSE trade_name END,
    address = CASE WHEN p_updates ? 'address' THEN NULLIF(p_updates->>'address', '') ELSE address END,
    city = CASE WHEN p_updates ? 'city' THEN NULLIF(p_updates->>'city', '') ELSE city END,
    state = CASE WHEN p_updates ? 'state' THEN NULLIF(p_updates->>'state', '') ELSE state END,
    zip = CASE WHEN p_updates ? 'zip' THEN NULLIF(p_updates->>'zip', '') ELSE zip END,
    notes = CASE WHEN p_updates ? 'notes' THEN NULLIF(p_updates->>'notes', '') ELSE notes END,
    payment_terms_days = CASE
      WHEN p_updates ? 'payment_terms_days' THEN NULLIF(p_updates->>'payment_terms_days', '')::INTEGER
      ELSE payment_terms_days
    END,
    discount_pct = CASE
      WHEN p_updates ? 'discount_pct' THEN NULLIF(p_updates->>'discount_pct', '')::NUMERIC
      ELSE discount_pct
    END,
    commercial_notes = CASE
      WHEN p_updates ? 'commercial_notes' THEN NULLIF(p_updates->>'commercial_notes', '')
      ELSE commercial_notes
    END
  WHERE id = p_customer_id
  RETURNING * INTO v_after;

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    justification
  )
  SELECT
    'customer',
    p_customer_id::TEXT,
    changed.field_name,
    changed.old_value,
    changed.new_value,
    p_changed_by,
    BTRIM(p_justification)
  FROM (
    VALUES
      ('name', v_before.name, v_after.name),
      ('trade_name', v_before.trade_name, v_after.trade_name),
      ('address', v_before.address, v_after.address),
      ('city', v_before.city, v_after.city),
      ('state', v_before.state, v_after.state),
      ('zip', v_before.zip, v_after.zip),
      ('notes', v_before.notes, v_after.notes),
      ('payment_terms_days', v_before.payment_terms_days::TEXT, v_after.payment_terms_days::TEXT),
      ('discount_pct', v_before.discount_pct::TEXT, v_after.discount_pct::TEXT),
      ('commercial_notes', v_before.commercial_notes, v_after.commercial_notes)
  ) AS changed(field_name, old_value, new_value)
  WHERE p_updates ? changed.field_name
    AND changed.old_value IS DISTINCT FROM changed.new_value;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.update_customer_with_audit(
  BIGINT, JSONB, UUID, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_customer_with_audit(
  BIGINT, JSONB, UUID, TEXT
) TO authenticated;
