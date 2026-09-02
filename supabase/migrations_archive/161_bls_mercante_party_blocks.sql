-- 161: capture full positional party blocks on bls for Mercante EDI (M5).
--
-- The carrier manifest carries full multi-line shipper/consignee/notify blocks
-- (name + address + CNPJ + contacts) plus a second "ALSO NOTIFY" party and the
-- package count/unit. The import parser previously kept only the company names,
-- which is insufficient to generate a Mercante-acceptable M5 manifest. These
-- nullable columns persist the raw blocks; the EDI generator formats them.
--
-- The core import_manifest_transactional() is left untouched; the new columns
-- are persisted by a transactional UPDATE inside the postprocess wrapper, which
-- already receives the full p_bls JSON. Existing rows keep NULL and the EDI
-- generator falls back to the name-only fields.

ALTER TABLE public.bls
  ADD COLUMN IF NOT EXISTS consignee_block TEXT,
  ADD COLUMN IF NOT EXISTS consignee_address TEXT,
  ADD COLUMN IF NOT EXISTS consignee_phone TEXT,
  ADD COLUMN IF NOT EXISTS shipper_block TEXT,
  ADD COLUMN IF NOT EXISTS notify_cnpj_cpf TEXT,
  ADD COLUMN IF NOT EXISTS notify_block TEXT,
  ADD COLUMN IF NOT EXISTS notify2_block TEXT,
  ADD COLUMN IF NOT EXISTS total_packages INTEGER,
  ADD COLUMN IF NOT EXISTS packages_unit TEXT;

CREATE OR REPLACE FUNCTION public.import_manifest_with_postprocess_transactional(
  p_filename TEXT,
  p_voyage_id BIGINT,
  p_uploaded_by UUID,
  p_cargo_mode TEXT,
  p_file_hash TEXT,
  p_total_bls INTEGER,
  p_total_containers INTEGER,
  p_bls JSONB,
  p_containers JSONB,
  p_errors JSONB,
  p_pol_etd JSONB DEFAULT '[]'::jsonb,
  p_pod_linked JSONB DEFAULT '[]'::jsonb,
  p_contact_emails JSONB DEFAULT '[]'::jsonb
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_batch_id BIGINT;
  v_bl_ids TEXT[];
BEGIN
  v_batch_id := public.import_manifest_transactional(
    p_filename,
    p_voyage_id,
    p_uploaded_by,
    p_cargo_mode,
    p_file_hash,
    p_total_bls,
    p_total_containers,
    p_bls,
    p_containers,
    p_errors
  );

  -- Persist full positional party blocks captured at parse time (Mercante EDI).
  UPDATE public.bls b SET
    consignee_block = NULLIF(x.consignee_block, ''),
    consignee_address = NULLIF(x.consignee_address, ''),
    consignee_phone = NULLIF(x.consignee_phone, ''),
    shipper_block = NULLIF(x.shipper_block, ''),
    notify_cnpj_cpf = NULLIF(x.notify_cnpj_cpf, ''),
    notify_block = NULLIF(x.notify_block, ''),
    notify2_block = NULLIF(x.notify2_block, ''),
    total_packages = x.total_packages,
    packages_unit = NULLIF(x.packages_unit, '')
  FROM jsonb_to_recordset(p_bls) AS x(
    id TEXT,
    consignee_block TEXT,
    consignee_address TEXT,
    consignee_phone TEXT,
    shipper_block TEXT,
    notify_cnpj_cpf TEXT,
    notify_block TEXT,
    notify2_block TEXT,
    total_packages INTEGER,
    packages_unit TEXT
  )
  WHERE b.id = x.id
    AND b.batch_id = v_batch_id;

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
    'voyage_pol_schedule',
    row.entity_id,
    'etd',
    latest.new_value,
    row.etd,
    p_uploaded_by,
    'ETD importado do manifesto por POL'
  FROM jsonb_to_recordset(p_pol_etd) AS row(entity_id TEXT, etd TEXT)
  LEFT JOIN LATERAL (
    SELECT al.new_value
    FROM public.audit_logs al
    WHERE al.entity_type = 'voyage_pol_schedule'
      AND al.entity_id = row.entity_id
      AND al.field_name = 'etd'
    ORDER BY al.changed_at DESC, al.id DESC
    LIMIT 1
  ) latest ON true
  WHERE NULLIF(row.etd, '') IS NOT NULL
    AND COALESCE(latest.new_value, '') IS DISTINCT FROM row.etd;

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
    'voyage_pod_schedule',
    row.entity_id,
    'linked',
    latest.new_value,
    'true',
    p_uploaded_by,
    'POD reconciliado automaticamente ao importar manifesto'
  FROM jsonb_to_recordset(p_pod_linked) AS row(entity_id TEXT)
  JOIN LATERAL (
    SELECT al.new_value
    FROM public.audit_logs al
    WHERE al.entity_type = 'voyage_pod_schedule'
      AND al.entity_id = row.entity_id
    ORDER BY al.changed_at DESC, al.id DESC
    LIMIT 1
  ) latest ON true
  WHERE latest.new_value IS DISTINCT FROM 'true';

  INSERT INTO public.customer_contacts (
    customer_id,
    name,
    email,
    purpose,
    is_primary
  )
  SELECT DISTINCT
    row.customer_id,
    'Contato manifesto',
    lower(trim(row.email)),
    'financeiro',
    false
  FROM jsonb_to_recordset(p_contact_emails) AS row(customer_id BIGINT, email TEXT)
  WHERE row.customer_id IS NOT NULL
    AND NULLIF(trim(row.email), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.customer_contacts cc
      WHERE cc.customer_id = row.customer_id
        AND lower(trim(cc.email)) = lower(trim(row.email))
    );

  SELECT COALESCE(array_agg(row.id), ARRAY[]::TEXT[])
  INTO v_bl_ids
  FROM jsonb_to_recordset(p_bls) AS row(id TEXT);

  PERFORM public.apply_bl_review_gate_after_import(v_bl_ids, p_uploaded_by);

  RETURN v_batch_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_manifest_with_postprocess_transactional(
  TEXT, BIGINT, UUID, TEXT, TEXT, INTEGER, INTEGER, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_manifest_with_postprocess_transactional(
  TEXT, BIGINT, UUID, TEXT, TEXT, INTEGER, INTEGER, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB
) TO authenticated;
