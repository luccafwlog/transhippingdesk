-- 284: separa sugestao por nome do vinculo confirmado por documento.
-- Rollback: remover a coluna sugerida e restaurar as funcoes 205/025/approve
-- a partir do historico versionado, somente em banco descartavel.

ALTER TABLE public.bls
  ADD COLUMN IF NOT EXISTS suggested_customer_id BIGINT;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bls_suggested_customer_id_fkey'
      AND conrelid = 'public.bls'::regclass
  ) THEN
    ALTER TABLE public.bls
      ADD CONSTRAINT bls_suggested_customer_id_fkey
      FOREIGN KEY (suggested_customer_id)
      REFERENCES public.customers(id)
      ON DELETE SET NULL;
  END IF;
END;
$migration$;

CREATE INDEX IF NOT EXISTS idx_bls_suggested_customer_id
  ON public.bls (suggested_customer_id);

CREATE OR REPLACE FUNCTION public.sync_customer_reconciliation_queue_for_bl(p_bl_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bl RECORD;
  v_detection_type TEXT;
  v_status TEXT;
BEGIN
  SELECT
    b.id,
    b.batch_id,
    b.customer_id,
    b.suggested_customer_id,
    b.manifest_customer_cnpj_cpf,
    b.manifest_customer_name,
    b.manifest_customer_email,
    b.customer_reconciliation_status,
    b.customer_reconciliation_notes
  INTO v_bl
  FROM public.bls AS b
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_status := COALESCE(v_bl.customer_reconciliation_status, 'missing_customer');
  v_detection_type := CASE v_status
    WHEN 'matched_name' THEN 'name'
    WHEN 'matched_document' THEN 'document'
    WHEN 'reconciled' THEN 'manual'
    WHEN 'rejected' THEN 'manual'
    ELSE 'missing'
  END;

  INSERT INTO public.customer_reconciliation_queue (
    manifest_id,
    bl_id,
    customer_id,
    cnpj_cpf,
    manifest_customer_name,
    manifest_customer_email,
    detection_type,
    status,
    notes,
    resolution_notes,
    approved_at,
    rejected_at
  )
  VALUES (
    v_bl.batch_id,
    v_bl.id,
    COALESCE(v_bl.customer_id, v_bl.suggested_customer_id),
    v_bl.manifest_customer_cnpj_cpf,
    v_bl.manifest_customer_name,
    v_bl.manifest_customer_email,
    v_detection_type,
    CASE
      WHEN v_status IN ('matched_document', 'reconciled') THEN 'approved'
      WHEN v_status = 'rejected' THEN 'rejected'
      ELSE 'pending'
    END,
    v_bl.customer_reconciliation_notes,
    CASE
      WHEN v_status IN ('matched_document', 'reconciled') THEN COALESCE(v_bl.customer_reconciliation_notes, 'Cliente reconciliado.')
      WHEN v_status = 'rejected' THEN COALESCE(v_bl.customer_reconciliation_notes, 'Reconciliacao rejeitada.')
      ELSE NULL
    END,
    CASE WHEN v_status IN ('matched_document', 'reconciled') THEN now() ELSE NULL END,
    CASE WHEN v_status = 'rejected' THEN now() ELSE NULL END
  )
  ON CONFLICT (bl_id) DO UPDATE
  SET
    manifest_id = EXCLUDED.manifest_id,
    customer_id = EXCLUDED.customer_id,
    cnpj_cpf = EXCLUDED.cnpj_cpf,
    manifest_customer_name = EXCLUDED.manifest_customer_name,
    manifest_customer_email = EXCLUDED.manifest_customer_email,
    detection_type = EXCLUDED.detection_type,
    status = EXCLUDED.status,
    notes = EXCLUDED.notes,
    resolution_notes = CASE
      WHEN EXCLUDED.status = 'pending' THEN NULL
      ELSE EXCLUDED.resolution_notes
    END,
    approved_at = CASE
      WHEN EXCLUDED.status = 'approved' THEN COALESCE(public.customer_reconciliation_queue.approved_at, now())
      ELSE NULL
    END,
    rejected_at = CASE
      WHEN EXCLUDED.status = 'rejected' THEN COALESCE(public.customer_reconciliation_queue.rejected_at, now())
      ELSE NULL
    END,
    updated_at = now();
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_customer_reconciliation_queue_for_bl(TEXT) FROM PUBLIC, anon, authenticated;

-- Keep the large, already-tested import implementation as an internal delegate;
-- this wrapper adds the new column without changing its atomic return contract.
ALTER FUNCTION public.import_bl_freight_transactional(jsonb, uuid)
  RENAME TO import_bl_freight_transactional_legacy_205;

REVOKE ALL ON FUNCTION public.import_bl_freight_transactional_legacy_205(jsonb, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional(p_bls jsonb, p_changed_by uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result JSONB;
  v_bl_id TEXT;
BEGIN
  v_result := public.import_bl_freight_transactional_legacy_205(p_bls, p_changed_by);

  UPDATE public.bls AS b
  SET
    suggested_customer_id = NULLIF(item->>'suggested_customer_id', '')::BIGINT,
    notes = CASE
      WHEN b.customer_reconciliation_status = 'matched_name' THEN regexp_replace(
        COALESCE(b.notes, ''),
        'Cliente vinculado por nome[^\n]*',
        'Cliente nao vinculado',
        'ig'
      )
      ELSE b.notes
    END
  FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item
  WHERE b.id = item->>'id';

  FOR v_bl_id IN
    SELECT item->>'id'
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item
    WHERE item->>'id' IS NOT NULL
  LOOP
    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl_id);
  END LOOP;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_bl_freight_transactional(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bl_freight_transactional(jsonb, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_customer_reconciliation(
  p_queue_id BIGINT,
  p_customer_id BIGINT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_queue RECORD;
  v_actor UUID;
  v_target_customer_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT * INTO v_queue
  FROM public.customer_reconciliation_queue
  WHERE id = p_queue_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de reconciliacao % nao encontrado.', p_queue_id USING ERRCODE = 'P0002';
  END IF;

  v_target_customer_id := COALESCE(p_customer_id, v_queue.customer_id);
  IF v_target_customer_id IS NULL THEN
    RAISE EXCEPTION 'Informe um cliente para aprovar a reconciliacao.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bls
  SET
    customer_id = v_target_customer_id,
    suggested_customer_id = NULL,
    customer_reconciliation_status = 'reconciled',
    customer_reconciliation_notes = COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.'),
    billing_hold_reason = NULL
  WHERE id = v_queue.bl_id;

  UPDATE public.customer_reconciliation_queue
  SET
    customer_id = v_target_customer_id,
    status = 'approved',
    resolution_notes = COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.'),
    approved_by = v_actor,
    approved_at = now(),
    rejected_by = NULL,
    rejected_at = NULL
  WHERE id = p_queue_id;

  IF v_queue.manifest_customer_email IS NOT NULL AND NULLIF(TRIM(v_queue.manifest_customer_email), '') IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
    SELECT v_target_customer_id, 'Contato manifesto', lower(trim(v_queue.manifest_customer_email)), 'financeiro', false
    WHERE NOT EXISTS (
      SELECT 1 FROM public.customer_contacts cc
      WHERE cc.customer_id = v_target_customer_id
        AND lower(trim(cc.email)) = lower(trim(v_queue.manifest_customer_email))
    );
  END IF;

  PERFORM public.sync_customer_reconciliation_queue_for_bl(v_queue.bl_id);

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES (
    'bl', v_queue.bl_id, 'customer_reconciliation_status', COALESCE(v_queue.status, 'pending'), 'reconciled',
    v_actor, now(), COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), 'Cliente reconciliado manualmente.')
  );

  RETURN jsonb_build_object('queue_id', p_queue_id, 'bl_id', v_queue.bl_id, 'customer_id', v_target_customer_id, 'status', 'approved');
END;
$function$;

REVOKE ALL ON FUNCTION public.approve_customer_reconciliation(BIGINT, BIGINT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_customer_reconciliation(BIGINT, BIGINT, TEXT, UUID) TO authenticated;

-- The billing gate remains: customer_reconciliation_status IN ('matched_document', 'reconciled').
