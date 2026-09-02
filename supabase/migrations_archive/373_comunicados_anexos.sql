-- 373: anexos privados e templates versionados do canal de Comunicados.
--
-- O bucket nunca e publico. A UI consulta templates, mas toda escrita de
-- template, upload de arquivo e persistencia de comunicado passa pelo
-- service_role/Edge Function. O limite do bucket e por arquivo; a regra de
-- tres arquivos e 10 MB no total tambem e validada pelo cliente e pela Edge.
--
-- Rollback operacional: desabilitar o disparo global e remover somente
-- templates/anexos criados para este canal em ambiente descartavel. O bucket
-- nao e apagado automaticamente porque os objetos podem ser evidencia de
-- comunicados ja enviados.

CREATE TABLE IF NOT EXISTS public.customer_communication_templates (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN (
    'aviso_chegada_noa',
    'aviso_prontidao_nor',
    'aviso_atracacao_nob',
    'institucional',
    'livre'
  )),
  subject_template TEXT NOT NULL CHECK (char_length(btrim(subject_template)) > 0),
  body_html_template TEXT NOT NULL CHECK (char_length(btrim(body_html_template)) > 0),
  body_text_template TEXT NOT NULL CHECK (char_length(btrim(body_text_template)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_communication_templates_kind_unique UNIQUE (kind)
);

DROP TRIGGER IF EXISTS set_customer_communication_templates_updated_at
  ON public.customer_communication_templates;
CREATE TRIGGER set_customer_communication_templates_updated_at
  BEFORE UPDATE ON public.customer_communication_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.customer_communication_templates (
  kind, subject_template, body_html_template, body_text_template
)
VALUES
  (
    'aviso_chegada_noa',
    'Notice of Arrival / Aviso de Chegada — {{vessel_name}} / {{voyage_number}} — Porto de {{port}}',
    '<p>Olá, {{customer_name}}.</p><p>O navio <strong>{{vessel_name}}</strong>, viagem <strong>{{voyage_number}}</strong>, tem chegada prevista para <strong>{{milestone_at}}</strong> no Porto de {{port}}.</p><p>B/Ls relacionados: {{bl_list}}.</p>',
    'Olá, {{customer_name}}. O navio {{vessel_name}}, viagem {{voyage_number}}, tem chegada prevista para {{milestone_at}} no Porto de {{port}}. B/Ls relacionados: {{bl_list}}.'
  ),
  (
    'aviso_prontidao_nor',
    'Notice of Readiness / Prontidão de Descarga — {{vessel_name}} / {{voyage_number}} — Porto de {{port}}',
    '<p>Olá, {{customer_name}}.</p><p>Registramos a prontidão de descarga do navio <strong>{{vessel_name}}</strong>, viagem <strong>{{voyage_number}}</strong>, em <strong>{{milestone_at}}</strong> no Porto de {{port}}.</p><p>B/Ls relacionados: {{bl_list}}.</p>',
    'Olá, {{customer_name}}. Registramos a prontidão de descarga do navio {{vessel_name}}, viagem {{voyage_number}}, em {{milestone_at}} no Porto de {{port}}. B/Ls relacionados: {{bl_list}}.'
  ),
  (
    'aviso_atracacao_nob',
    'Notice of Berthing / Aviso de Atracação — {{vessel_name}} / {{voyage_number}} — Porto de {{port}} ({{terminal_name}})',
    '<p>Olá, {{customer_name}}.</p><p>O navio <strong>{{vessel_name}}</strong>, viagem <strong>{{voyage_number}}</strong>, atracou em <strong>{{milestone_at}}</strong> no terminal {{terminal_name}}, Porto de {{port}}.</p><p>B/Ls relacionados: {{bl_list}}.</p>',
    'Olá, {{customer_name}}. O navio {{vessel_name}}, viagem {{voyage_number}}, atracou em {{milestone_at}} no terminal {{terminal_name}}, Porto de {{port}}. B/Ls relacionados: {{bl_list}}.'
  ),
  (
    'institucional',
    '{{subject}}',
    '<p>Olá, {{customer_name}}.</p><p>{{body}}</p>',
    'Olá, {{customer_name}}. {{body}}'
  ),
  (
    'livre',
    '{{subject}}',
    '<p>Olá, {{customer_name}}.</p><p>{{body}}</p>',
    'Olá, {{customer_name}}. {{body}}'
  )
ON CONFLICT (kind) DO NOTHING;

-- O corpo do arquivo vai para o provider como bytes, mas a referência ao
-- objeto e seus metadados também ficam no histórico. Assim o comunicado
-- continua explicando exatamente quais anexos foram enviados mesmo depois
-- que a origem operacional seja alterada ou removida.
CREATE TABLE IF NOT EXISTS public.customer_communication_attachments (
  id BIGSERIAL PRIMARY KEY,
  communication_id BIGINT NOT NULL
    REFERENCES public.customer_communications(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL CHECK (char_length(btrim(file_name)) > 0),
  mime_type TEXT NOT NULL CHECK (mime_type IN (
    'application/pdf', 'image/jpeg', 'image/png', 'text/plain'
  )),
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 10485760),
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_communication_attachments_communication
  ON public.customer_communication_attachments (communication_id, created_at);

ALTER TABLE public.customer_communication_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customer_communication_attachments FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.customer_communication_attachments TO authenticated;
GRANT ALL ON TABLE public.customer_communication_attachments TO service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.customer_communication_attachments FROM authenticated;
REVOKE ALL ON SEQUENCE public.customer_communication_attachments_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.customer_communication_attachments_id_seq TO service_role;

DROP POLICY IF EXISTS customer_communication_attachments_internal_read
  ON public.customer_communication_attachments;
CREATE POLICY customer_communication_attachments_internal_read
  ON public.customer_communication_attachments FOR SELECT TO authenticated
  USING (public.is_active_read_user());

ALTER TABLE public.customer_communication_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customer_communication_templates FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.customer_communication_templates TO authenticated;
GRANT ALL ON TABLE public.customer_communication_templates TO service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.customer_communication_templates FROM authenticated;
REVOKE ALL ON SEQUENCE public.customer_communication_templates_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.customer_communication_templates_id_seq TO service_role;

DROP POLICY IF EXISTS customer_communication_templates_internal_read
  ON public.customer_communication_templates;
CREATE POLICY customer_communication_templates_internal_read
  ON public.customer_communication_templates FOR SELECT TO authenticated
  USING (public.is_active_read_user());

-- Storage pode nao existir no Postgres descartavel usado pelos testes locais.
-- O bloco dinamico aplica o mesmo contrato quando executado no Supabase.
DO $storage$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL
     AND to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO storage.buckets (
        id, name, public, file_size_limit, allowed_mime_types
      )
      VALUES (
        'customer-communications',
        'customer-communications',
        false,
        10485760,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'text/plain']
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        public = false,
        file_size_limit = 10485760,
        allowed_mime_types = EXCLUDED.allowed_mime_types
    $sql$;

    EXECUTE 'DROP POLICY IF EXISTS customer_communications_objects_read ON storage.objects';
    EXECUTE $sql$
      CREATE POLICY customer_communications_objects_read ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'customer-communications'
        AND public.is_active_read_user()
      )
    $sql$;

    EXECUTE 'DROP POLICY IF EXISTS customer_communications_objects_insert ON storage.objects';
    EXECUTE $sql$
      CREATE POLICY customer_communications_objects_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'customer-communications'
        AND public.is_active_user()
      )
    $sql$;

    EXECUTE 'DROP POLICY IF EXISTS customer_communications_objects_update ON storage.objects';
    EXECUTE $sql$
      CREATE POLICY customer_communications_objects_update ON storage.objects
      FOR UPDATE TO authenticated
      USING (
        bucket_id = 'customer-communications'
        AND public.is_active_user()
      )
      WITH CHECK (
        bucket_id = 'customer-communications'
        AND public.is_active_user()
      )
    $sql$;

    EXECUTE 'DROP POLICY IF EXISTS customer_communications_objects_delete ON storage.objects';
    EXECUTE $sql$
      CREATE POLICY customer_communications_objects_delete ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'customer-communications'
        AND public.is_active_user()
      )
    $sql$;
  END IF;
END;
$storage$;

-- A Edge Function chama esta RPC com service_role. A consulta inicial por
-- todas as colunas da chave torna o reenvio idempotente mesmo quando o status
-- do comunicado anterior ja foi atualizado de simulado para enviado/falha.
CREATE OR REPLACE FUNCTION public.create_customer_communication_atomic(
  p_customer_id BIGINT,
  p_kind TEXT,
  p_nature TEXT,
  p_anchor_voyage_id BIGINT DEFAULT NULL,
  p_anchor_port TEXT DEFAULT NULL,
  p_anchor_atracacao_id UUID DEFAULT NULL,
  p_anchor_invoice_id BIGINT DEFAULT NULL,
  p_attempt_discriminator INTEGER DEFAULT 0,
  p_dispatch_id UUID DEFAULT NULL,
  p_vessel_name TEXT DEFAULT NULL,
  p_voyage_number TEXT DEFAULT NULL,
  p_terminal_name TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_bl_ids TEXT[] DEFAULT '{}'
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_communication_id BIGINT;
  v_requested_bls INTEGER := COALESCE(cardinality(p_bl_ids), 0);
  v_valid_bls INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  IF p_attempt_discriminator < 0 THEN
    RAISE EXCEPTION 'O discriminador de tentativa nao pode ser negativo.' USING ERRCODE = '22023';
  END IF;

  IF p_kind IN ('aviso_chegada_noa', 'aviso_prontidao_nor', 'aviso_atracacao_nob')
     AND p_dispatch_id IS NOT NULL THEN
    RAISE EXCEPTION 'Avisos operacionais nao usam dispatch_id.' USING ERRCODE = '22023';
  END IF;

  IF p_kind IN ('institucional', 'livre')
     AND p_dispatch_id IS NULL THEN
    RAISE EXCEPTION 'Comunicado sem ancora exige dispatch_id.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'Cliente nao encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.customer_communication_kinds
    WHERE kind = p_kind AND nature = p_nature
  ) THEN
    RAISE EXCEPTION 'Natureza invalida para o tipo de comunicado.' USING ERRCODE = '22023';
  END IF;

  IF v_requested_bls > 0 THEN
    IF p_kind = 'institucional' THEN
      RAISE EXCEPTION 'Comunicado institucional nao pode conter B/Ls.' USING ERRCODE = '22023';
    END IF;
    SELECT count(*)::INTEGER INTO v_valid_bls
    FROM public.bls
    WHERE id = ANY(p_bl_ids) AND customer_id = p_customer_id;
    IF v_valid_bls <> v_requested_bls THEN
      RAISE EXCEPTION 'B/L fora do cliente do comunicado.' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT id
    INTO v_communication_id
  FROM public.customer_communications
  WHERE kind = p_kind
    AND customer_id = p_customer_id
    AND nature = p_nature
    AND anchor_voyage_id IS NOT DISTINCT FROM p_anchor_voyage_id
    AND anchor_port IS NOT DISTINCT FROM NULLIF(btrim(p_anchor_port), '')
    AND anchor_atracacao_id IS NOT DISTINCT FROM p_anchor_atracacao_id
    AND anchor_invoice_id IS NOT DISTINCT FROM p_anchor_invoice_id
    AND dispatch_id IS NOT DISTINCT FROM p_dispatch_id
    AND attempt_discriminator = p_attempt_discriminator
  ORDER BY id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_communication_id IS NULL THEN
    INSERT INTO public.customer_communications (
      customer_id, kind, nature,
      anchor_voyage_id, anchor_port, anchor_atracacao_id, anchor_invoice_id,
      attempt_discriminator, status, dispatch_id,
      vessel_name, voyage_number, terminal_name, created_by
    )
    VALUES (
      p_customer_id, p_kind, p_nature,
      p_anchor_voyage_id, NULLIF(btrim(p_anchor_port), ''),
      p_anchor_atracacao_id, p_anchor_invoice_id,
      p_attempt_discriminator, 'simulado', p_dispatch_id,
      NULLIF(btrim(p_vessel_name), ''), NULLIF(btrim(p_voyage_number), ''),
      NULLIF(btrim(p_terminal_name), ''), p_created_by
    )
    RETURNING id INTO v_communication_id;
  END IF;

  IF v_requested_bls > 0 THEN
    INSERT INTO public.customer_communication_bls (communication_id, bl_id)
    SELECT v_communication_id, value
    FROM unnest(p_bl_ids) AS requested(value)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_communication_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_customer_communication_atomic(
  BIGINT, TEXT, TEXT, BIGINT, TEXT, UUID, BIGINT, INTEGER, UUID,
  TEXT, TEXT, TEXT, UUID, TEXT[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_communication_atomic(
  BIGINT, TEXT, TEXT, BIGINT, TEXT, UUID, BIGINT, INTEGER, UUID,
  TEXT, TEXT, TEXT, UUID, TEXT[]
) TO service_role;
