-- 008: catalogo de caixas de comunicacao, vinculos contato-caixa,
-- disponibilidade, auditoria append-only e RPCs do Portal/Ficha (Issue 609).
--
-- ADR 0064: substitui a antiga selecao de quatro Naturezas por tres Caixas de
-- Comunicacao objetivas (Documentacao e Operacao, Financeiro e Demurrage).
-- Cada contato possui vinculos explicitos a uma ou mais caixas; o contato
-- principal nasce vinculado as tres e qualquer alteracao de contatos no Portal
-- ou internamente e gravada de forma transacional e auditada em customer_contact_change_events.

-- ===========================================================================
-- 1. Campos de ciclo de vida, normalizacao e unicidade em customer_contacts
-- ===========================================================================

ALTER TABLE public.customer_contacts
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS email_normalized text GENERATED ALWAYS AS (
    NULLIF(lower(btrim(email)), '')
  ) STORED,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'interno';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_contacts_origin_check'
  ) THEN
    ALTER TABLE public.customer_contacts
      ADD CONSTRAINT customer_contacts_origin_check
      CHECK (origin IN ('portal', 'interno', 'bl_automatico', 'sistema'));
  END IF;
END $$;

-- Sanitizacao defensiva para evitar quebra em bases existentes com duplicidades
WITH duplicates AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY customer_id, NULLIF(lower(btrim(email)), '')
    ORDER BY is_primary DESC, id ASC
  ) AS rn
  FROM public.customer_contacts
  WHERE customer_id IS NOT NULL AND NULLIF(lower(btrim(email)), '') IS NOT NULL
)
UPDATE public.customer_contacts
SET deactivated_at = COALESCE(deactivated_at, now())
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

WITH ranked_primaries AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY customer_id
    ORDER BY id DESC
  ) AS rn
  FROM public.customer_contacts
  WHERE customer_id IS NOT NULL AND is_primary = true AND deactivated_at IS NULL
)
UPDATE public.customer_contacts
SET is_primary = false
WHERE id IN (SELECT id FROM ranked_primaries WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS customer_contacts_customer_email_normalized_uidx
  ON public.customer_contacts (customer_id, email_normalized)
  WHERE customer_id IS NOT NULL AND email_normalized IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customer_contacts_one_active_primary_uidx
  ON public.customer_contacts (customer_id)
  WHERE customer_id IS NOT NULL
    AND is_primary = true
    AND deactivated_at IS NULL;

-- ===========================================================================
-- 2. Catalogo extensivel de caixas e mapa de modelos (kinds)
-- ===========================================================================

CREATE TABLE public.customer_communication_boxes (
  code text PRIMARY KEY,
  label text NOT NULL,
  description text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.customer_communication_box_kinds (
  box_code text NOT NULL REFERENCES public.customer_communication_boxes(code) ON DELETE CASCADE,
  kind text NOT NULL,
  PRIMARY KEY (box_code, kind)
);

INSERT INTO public.customer_communication_boxes (code, label, description, sort_order)
VALUES
  ('documentacao_operacao', 'Documentação e Operação', 'CE e Taxas, NOA, NOR e NOB.', 1),
  ('financeiro', 'Financeiro', 'CE e Taxas e Cobranças de Demurrage.', 2),
  ('demurrage', 'Demurrage', 'Cobranças de Demurrage e futuros comunicados de Demurrage.', 3)
ON CONFLICT (code) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    sort_order = EXCLUDED.sort_order,
    active = true;

INSERT INTO public.customer_communication_box_kinds (box_code, kind)
VALUES
  ('documentacao_operacao', 'aviso_chegada_noa'),
  ('documentacao_operacao', 'aviso_prontidao_nor'),
  ('documentacao_operacao', 'aviso_atracacao_nob'),
  ('documentacao_operacao', 'ce_mercante_taxas'),
  ('financeiro', 'ce_mercante_taxas'),
  ('financeiro', 'cobranca_demurrage'),
  ('demurrage', 'cobranca_demurrage')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 3. Vinculos por contato e eventos agrupados de alteracao
-- ===========================================================================

CREATE TABLE public.customer_contact_box_links (
  contact_id bigint NOT NULL REFERENCES public.customer_contacts(id) ON DELETE CASCADE,
  box_code text NOT NULL REFERENCES public.customer_communication_boxes(code) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, box_code)
);

CREATE INDEX IF NOT EXISTS customer_contact_box_links_box_code_idx
  ON public.customer_contact_box_links (box_code, contact_id);

CREATE TABLE public.customer_contact_change_events (
  id bigserial PRIMARY KEY,
  action_id uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('portal', 'interno', 'bl_automatico', 'sistema')),
  actor_id uuid,
  portal_account_id bigint,
  related_bl_id text,
  before_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  after_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  change_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_contact_change_events_customer_idx
  ON public.customer_contact_change_events (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS customer_contact_change_events_action_idx
  ON public.customer_contact_change_events (action_id);

-- ===========================================================================
-- 4. RLS e Concessoes
-- ===========================================================================

ALTER TABLE public.customer_communication_boxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_communication_box_kinds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_contact_box_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_contact_change_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.customer_communication_boxes FROM PUBLIC, anon;
REVOKE ALL ON public.customer_communication_box_kinds FROM PUBLIC, anon;
REVOKE ALL ON public.customer_contact_box_links FROM PUBLIC, anon;
REVOKE ALL ON public.customer_contact_change_events FROM PUBLIC, anon;

REVOKE INSERT, UPDATE, DELETE ON public.customer_contact_change_events FROM authenticated;

GRANT SELECT ON public.customer_communication_boxes TO authenticated, service_role;
GRANT SELECT ON public.customer_communication_box_kinds TO authenticated, service_role;
GRANT SELECT ON public.customer_contact_box_links TO authenticated, service_role;
GRANT SELECT ON public.customer_contact_change_events TO authenticated, service_role;

DROP POLICY IF EXISTS customer_communication_boxes_select ON public.customer_communication_boxes;
CREATE POLICY customer_communication_boxes_select ON public.customer_communication_boxes
  FOR SELECT TO authenticated
  USING (public.is_active_read_user() OR public.current_portal_customer_id() IS NOT NULL);

DROP POLICY IF EXISTS customer_communication_box_kinds_select ON public.customer_communication_box_kinds;
CREATE POLICY customer_communication_box_kinds_select ON public.customer_communication_box_kinds
  FOR SELECT TO authenticated
  USING (public.is_active_read_user() OR public.current_portal_customer_id() IS NOT NULL);

DROP POLICY IF EXISTS customer_contact_box_links_select ON public.customer_contact_box_links;
CREATE POLICY customer_contact_box_links_select ON public.customer_contact_box_links
  FOR SELECT TO authenticated
  USING (public.is_active_read_user());

DROP POLICY IF EXISTS customer_contact_change_events_select ON public.customer_contact_change_events;
CREATE POLICY customer_contact_change_events_select ON public.customer_contact_change_events FOR SELECT TO authenticated USING (public.is_active_read_user());

-- ===========================================================================
-- 5. Desligar seed do modelo antigo e fazer backfill dos vinculos
-- ===========================================================================

DROP TRIGGER IF EXISTS trg_seed_customer_contact_preferences ON public.customer_contacts;

-- Contatos principais ativos recebem todas as caixas
INSERT INTO public.customer_contact_box_links (contact_id, box_code)
SELECT cc.id, ccb.code
FROM public.customer_contacts cc
CROSS JOIN public.customer_communication_boxes ccb
WHERE cc.is_primary = true AND cc.deactivated_at IS NULL
ON CONFLICT DO NOTHING;

-- Contatos adicionais ativos sem vinculos recebem documentacao_operacao
INSERT INTO public.customer_contact_box_links (contact_id, box_code)
SELECT cc.id, 'documentacao_operacao'
FROM public.customer_contacts cc
WHERE (cc.is_primary = false OR cc.is_primary IS NULL) AND cc.deactivated_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.customer_contact_box_links l WHERE l.contact_id = cc.id)
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 6. Helper para projetar configuracao canônica de contatos e caixas
-- ===========================================================================

CREATE OR REPLACE FUNCTION public._build_customer_contact_configuration(p_customer_id bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_boxes jsonb;
  v_contacts jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'code', b.code,
      'label', b.label,
      'description', b.description,
      'sort_order', b.sort_order,
      'active', b.active
    ) ORDER BY b.sort_order, b.code
  )
  INTO v_boxes
  FROM public.customer_communication_boxes b
  WHERE b.active = true;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', cc.id,
      'customer_id', cc.customer_id,
      'name', cc.name,
      'email', cc.email,
      'email_normalized', cc.email_normalized,
      'phone', cc.phone,
      'is_primary', cc.is_primary,
      'active', (cc.deactivated_at IS NULL),
      'deactivated_at', cc.deactivated_at,
      'origin', cc.origin,
      'box_codes', COALESCE((
        SELECT jsonb_agg(l.box_code ORDER BY b.sort_order, l.box_code)
        FROM public.customer_contact_box_links l
        JOIN public.customer_communication_boxes b ON b.code = l.box_code
        WHERE l.contact_id = cc.id
      ), '[]'::jsonb),
      'suppression_reason', (
        CASE
          WHEN EXISTS (
            SELECT 1 FROM public.portal_suppressed_emails pse
            WHERE lower(btrim(pse.email)) = cc.email_normalized
              AND pse.reason = 'bounce_permanente'
          ) THEN 'suprimido_bounce'
          WHEN EXISTS (
            SELECT 1 FROM public.customer_communication_suppressions ccs
            WHERE lower(btrim(ccs.email)) = cc.email_normalized
          ) THEN 'suprimido_complaint'
          ELSE NULL
        END
      ),
      'sendable', (
        cc.deactivated_at IS NULL
        AND cc.email_normalized IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.portal_suppressed_emails pse
          WHERE lower(btrim(pse.email)) = cc.email_normalized
            AND pse.reason = 'bounce_permanente'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communication_suppressions ccs
          WHERE lower(btrim(ccs.email)) = cc.email_normalized
        )
      )
    ) ORDER BY cc.is_primary DESC, (cc.deactivated_at IS NOT NULL), cc.id ASC
  ), '[]'::jsonb)
  INTO v_contacts
  FROM public.customer_contacts cc
  WHERE cc.customer_id = p_customer_id;

  RETURN jsonb_build_object(
    'boxes', COALESCE(v_boxes, '[]'::jsonb),
    'contacts', COALESCE(v_contacts, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public._build_customer_contact_configuration(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._build_customer_contact_configuration(bigint) TO service_role;

-- ===========================================================================
-- 7. Nucleo Privado Transacional: _apply_customer_contact_configuration
-- ===========================================================================

CREATE OR REPLACE FUNCTION public._apply_customer_contact_configuration(
  p_customer_id bigint,
  p_contacts jsonb,
  p_source text,
  p_actor_id uuid DEFAULT NULL,
  p_portal_account_id bigint DEFAULT NULL,
  p_related_bl_id text DEFAULT NULL,
  p_justification text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_before_config jsonb;
  v_after_config jsonb;
  v_item jsonb;
  v_item_id bigint;
  v_item_name text;
  v_item_email text;
  v_item_phone text;
  v_item_is_primary boolean;
  v_item_active boolean;
  v_item_boxes jsonb;
  v_box_code text;
  v_active_primary_count integer := 0;
  v_seen_emails text[] := ARRAY[]::text[];
  v_target_contact_ids bigint[] := ARRAY[]::bigint[];
  v_existing_dup record;
  v_active_box record;
  v_box_has_recipient boolean;
  v_new_id bigint;
  v_action_id uuid := gen_random_uuid();
  v_contact_box_codes text[];
  v_suppression_reason text;
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'ID do cliente é obrigatório.' USING ERRCODE = '22023';
  END IF;

  IF p_source NOT IN ('portal', 'interno', 'bl_automatico', 'sistema') THEN
    RAISE EXCEPTION 'Origem inválida: %', p_source USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_contacts) <> 'array' THEN
    RAISE EXCEPTION 'Payload de contatos inválido (esperado array).' USING ERRCODE = '22023';
  END IF;

  -- Lock pessimista no cliente para serializar mutacoes
  PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente % não encontrado.', p_customer_id USING ERRCODE = '02000';
  END IF;

  -- Pre-popular IDs dos contatos enviados no payload para evitar sensibilidade à ordem de validação
  SELECT COALESCE(array_agg(NULLIF(elem->>'id', '')::bigint), ARRAY[]::bigint[])
  INTO v_target_contact_ids
  FROM jsonb_array_elements(p_contacts) elem
  WHERE NULLIF(elem->>'id', '') IS NOT NULL;

  -- Snapshot anterior
  v_before_config := public._build_customer_contact_configuration(p_customer_id);

  -- -------------------------------------------------------------------------
  -- Validacao pre-transacao em lote
  -- -------------------------------------------------------------------------
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_contacts)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Item de contato inválido.' USING ERRCODE = '22023';
    END IF;

    v_item_id := NULLIF(v_item->>'id', '')::bigint;
    v_item_name := NULLIF(btrim(COALESCE(v_item->>'name', '')), '');
    v_item_email := NULLIF(lower(btrim(COALESCE(v_item->>'email', ''))), '');
    v_item_phone := NULLIF(btrim(COALESCE(v_item->>'phone', '')), '');
    v_item_is_primary := COALESCE((v_item->>'is_primary')::boolean, false);
    v_item_active := COALESCE((v_item->>'active')::boolean, true);
    v_item_boxes := COALESCE(v_item->'box_codes', '[]'::jsonb);

    -- Pertencimento ao cliente
    IF v_item_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.customer_contacts
        WHERE id = v_item_id AND customer_id = p_customer_id
      ) THEN
        RAISE EXCEPTION 'Contato % não pertence ao cliente %.', v_item_id, p_customer_id USING ERRCODE = '42501';
      END IF;
    END IF;

    -- Validacao de e-mail em contatos ativos ou novos
    IF v_item_active OR v_item_id IS NULL THEN
      IF v_item_email IS NULL THEN
        RAISE EXCEPTION 'E-mail é obrigatório para contato ativo.' USING ERRCODE = '22023';
      END IF;

      IF v_item_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
        RAISE EXCEPTION 'E-mail inválido: %', v_item_email USING ERRCODE = '22023';
      END IF;

      -- Unicidade dentro do payload
      IF v_item_email = ANY(v_seen_emails) THEN
        RAISE EXCEPTION 'E-mail duplicado no envio: %', v_item_email USING ERRCODE = '23505';
      END IF;
      v_seen_emails := array_append(v_seen_emails, v_item_email);

      -- Unicidade contra registros existentes do mesmo cliente fora do payload
      SELECT id, name, email INTO v_existing_dup
      FROM public.customer_contacts
      WHERE customer_id = p_customer_id
        AND email_normalized = v_item_email
        AND (v_item_id IS NULL OR id <> v_item_id)
        AND id <> ALL(v_target_contact_ids);

      IF FOUND THEN
        RAISE EXCEPTION 'E-mail % já cadastrado para o contato "%" (ID %).',
          v_item_email, COALESCE(v_existing_dup.name, 'sem nome'), v_existing_dup.id
          USING ERRCODE = '23505';
      END IF;
    END IF;

    -- Regras do contato principal e caixas
    IF v_item_active THEN
      IF v_item_is_primary THEN
        v_active_primary_count := v_active_primary_count + 1;
        -- Principal ativo nasce vinculado as 3 caixas se nao especificadas
        IF jsonb_array_length(v_item_boxes) = 0 THEN
          v_item_boxes := '["documentacao_operacao", "financeiro", "demurrage"]'::jsonb;
        END IF;
      ELSE
        IF jsonb_array_length(v_item_boxes) = 0 THEN
          RAISE EXCEPTION 'Contato adicional ativo deve ter ao menos uma caixa vinculada.' USING ERRCODE = '22023';
        END IF;
      END IF;

      -- Validar caixas existentes
      FOR v_box_code IN SELECT jsonb_array_elements_text(v_item_boxes)
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM public.customer_communication_boxes
          WHERE code = v_box_code AND active = true
        ) THEN
          RAISE EXCEPTION 'Caixa de comunicação inválida: %', v_box_code USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- Exatamente um contato principal ativo
  IF v_active_primary_count <> 1 THEN
    RAISE EXCEPTION 'O cliente deve ter exatamente um contato principal ativo.' USING ERRCODE = '22023';
  END IF;

  -- -------------------------------------------------------------------------
  -- Invariante global: nenhuma caixa ativa pode terminar sem destinatario elegivel
  -- -------------------------------------------------------------------------
  FOR v_active_box IN
    SELECT code, label FROM public.customer_communication_boxes WHERE active = true
  LOOP
    v_box_has_recipient := false;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_contacts)
    LOOP
      v_item_active := COALESCE((v_item->>'active')::boolean, true);
      v_item_email := NULLIF(lower(btrim(COALESCE(v_item->>'email', ''))), '');
      v_item_is_primary := COALESCE((v_item->>'is_primary')::boolean, false);
      v_item_boxes := COALESCE(v_item->'box_codes', '[]'::jsonb);
      IF v_item_is_primary AND jsonb_array_length(v_item_boxes) = 0 THEN
        v_item_boxes := '["documentacao_operacao", "financeiro", "demurrage"]'::jsonb;
      END IF;

      IF v_item_active AND v_item_email IS NOT NULL THEN
        -- Verificar supressao
        IF NOT EXISTS (
          SELECT 1 FROM public.portal_suppressed_emails pse
          WHERE lower(btrim(pse.email)) = v_item_email AND pse.reason = 'bounce_permanente'
        ) AND NOT EXISTS (
          SELECT 1 FROM public.customer_communication_suppressions ccs
          WHERE lower(btrim(ccs.email)) = v_item_email
        ) THEN
          IF v_item_boxes ? v_active_box.code THEN
            v_box_has_recipient := true;
            EXIT;
          END IF;
        END IF;
      END IF;
    END LOOP;

    IF NOT v_box_has_recipient THEN
      RAISE EXCEPTION 'A caixa "%" ficaria sem nenhum destinatário ativo elegível. Vincule outro e-mail antes de remover.',
        v_active_box.label USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- Aplicacao das alteracoes no banco
  -- -------------------------------------------------------------------------

  -- Desativar contatos nao mencionados no payload (se estavam ativos)
  UPDATE public.customer_contacts
  SET deactivated_at = COALESCE(deactivated_at, now()),
      is_primary = false,
      updated_at = now()
  WHERE customer_id = p_customer_id
    AND id <> ALL(v_target_contact_ids)
    AND deactivated_at IS NULL;

  -- Processar cada contato do payload
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_contacts)
  LOOP
    v_item_id := NULLIF(v_item->>'id', '')::bigint;
    v_item_name := NULLIF(btrim(COALESCE(v_item->>'name', '')), '');
    v_item_email := NULLIF(lower(btrim(COALESCE(v_item->>'email', ''))), '');
    v_item_phone := NULLIF(btrim(COALESCE(v_item->>'phone', '')), '');
    v_item_is_primary := COALESCE((v_item->>'is_primary')::boolean, false);
    v_item_active := COALESCE((v_item->>'active')::boolean, true);
    v_item_boxes := COALESCE(v_item->'box_codes', '[]'::jsonb);
    IF v_item_is_primary AND jsonb_array_length(v_item_boxes) = 0 THEN
      v_item_boxes := '["documentacao_operacao", "financeiro", "demurrage"]'::jsonb;
    END IF;

    IF v_item_id IS NOT NULL THEN
      -- Atualizar existente
      UPDATE public.customer_contacts
      SET name = COALESCE(v_item_name, name),
          email = COALESCE(v_item_email, email),
          phone = v_item_phone,
          is_primary = v_item_is_primary,
          deactivated_at = CASE WHEN v_item_active THEN NULL ELSE COALESCE(deactivated_at, now()) END,
          updated_at = now()
      WHERE id = v_item_id;

      IF v_item_active THEN
        -- Sincronizar vinculos da caixa para contato ativo
        SELECT array_agg(value) INTO v_contact_box_codes
        FROM jsonb_array_elements_text(v_item_boxes);

        DELETE FROM public.customer_contact_box_links
        WHERE contact_id = v_item_id
          AND box_code <> ALL(COALESCE(v_contact_box_codes, ARRAY[]::text[]));

        INSERT INTO public.customer_contact_box_links (contact_id, box_code)
        SELECT v_item_id, unnest(COALESCE(v_contact_box_codes, ARRAY[]::text[]))
        ON CONFLICT DO NOTHING;
      END IF;
      -- Contatos inativos preservam os vinculos no banco para historico
    ELSE
      -- Inserir novo contato
      INSERT INTO public.customer_contacts (
        customer_id, name, email, phone, is_primary, origin, deactivated_at
      )
      VALUES (
        p_customer_id,
        COALESCE(v_item_name, 'Contato'),
        v_item_email,
        v_item_phone,
        v_item_is_primary,
        p_source,
        CASE WHEN v_item_active THEN NULL ELSE now() END
      )
      RETURNING id INTO v_new_id;

      IF v_item_active THEN
        SELECT array_agg(value) INTO v_contact_box_codes
        FROM jsonb_array_elements_text(v_item_boxes);

        INSERT INTO public.customer_contact_box_links (contact_id, box_code)
        SELECT v_new_id, unnest(COALESCE(v_contact_box_codes, ARRAY[]::text[]))
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END LOOP;

  -- Snapshot posterior
  v_after_config := public._build_customer_contact_configuration(p_customer_id);

  -- Registrar evento append-only de auditoria
  INSERT INTO public.customer_contact_change_events (
    action_id, customer_id, source, actor_id, portal_account_id, related_bl_id,
    before_snapshot, after_snapshot, change_summary
  )
  VALUES (
    v_action_id,
    p_customer_id,
    p_source,
    p_actor_id,
    p_portal_account_id,
    p_related_bl_id,
    v_before_config->'contacts',
    v_after_config->'contacts',
    jsonb_build_object(
      'action', 'save_contact_configuration',
      'justification', p_justification,
      'contacts_count', jsonb_array_length(v_after_config->'contacts')
    )
  );

  RETURN v_after_config;
END;
$$;

REVOKE ALL ON FUNCTION public._apply_customer_contact_configuration(
  bigint, jsonb, text, uuid, bigint, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._apply_customer_contact_configuration(
  bigint, jsonb, text, uuid, bigint, text, text
) TO service_role;

-- ===========================================================================
-- 8. Wrappers de Seguranca: Portal e Interno
-- ===========================================================================

CREATE FUNCTION public.portal_get_contact_configuration()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_customer_id bigint := public.current_portal_customer_id();
BEGIN
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Acesso não autorizado ao Portal do Cliente.' USING ERRCODE = '42501';
  END IF;

  RETURN public._build_customer_contact_configuration(v_customer_id);
END;
$$;

CREATE FUNCTION public.portal_inspect_get_contact_configuration(p_customer_id bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM public._portal_inspect_guard(p_customer_id);
  RETURN public._build_customer_contact_configuration(p_customer_id);
END;
$$;

CREATE FUNCTION public.portal_save_contact_configuration(p_contacts jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_customer_id bigint := public.current_portal_customer_id();
  v_portal_account_id bigint;
BEGIN
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Acesso não autorizado ao Portal do Cliente.' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_portal_account_id
  FROM public.customer_portal_accounts
  WHERE auth_user_id = auth.uid() AND active = true
  LIMIT 1;

  RETURN public._apply_customer_contact_configuration(
    v_customer_id,
    p_contacts,
    'portal',
    auth.uid(),
    v_portal_account_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.internal_save_customer_contact_configuration(
  p_customer_id bigint,
  p_contacts jsonb,
  p_justification text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Permissão negada para editar contatos do cliente.' USING ERRCODE = '42501';
  END IF;

  RETURN public._apply_customer_contact_configuration(
    p_customer_id,
    p_contacts,
    'interno',
    auth.uid(),
    NULL,
    NULL,
    p_justification
  );
END;
$$;

REVOKE ALL ON FUNCTION public.portal_get_contact_configuration() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_get_contact_configuration() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.portal_inspect_get_contact_configuration(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_inspect_get_contact_configuration(bigint) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.portal_save_contact_configuration(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_save_contact_configuration(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.internal_save_customer_contact_configuration(bigint, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.internal_save_customer_contact_configuration(bigint, jsonb, text) TO authenticated, service_role;

-- ===========================================================================
-- 9. Criacao atomica de cliente com contato principal obrigatorio
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.create_customer_with_contacts(
  p_customer jsonb,
  p_contacts jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_contact jsonb;
  v_has_primary boolean := false;
  v_primary_email text;
  v_contact_id bigint;
  v_box_codes jsonb;
  v_box_code text;
  v_email text;
  v_is_primary boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas para criar cliente.' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_customer) <> 'object'
     OR jsonb_typeof(p_contacts) <> 'array'
     OR NULLIF(btrim(p_customer->>'cnpj_cpf'), '') IS NULL
     OR NULLIF(btrim(p_customer->>'name'), '') IS NULL THEN
    RAISE EXCEPTION 'Cadastro de cliente invalido.' USING ERRCODE = '22023';
  END IF;

  -- Exige pelo menos um contato que seja principal e tenha e-mail
  FOR v_contact IN SELECT * FROM jsonb_array_elements(p_contacts)
  LOOP
    IF COALESCE((v_contact->>'is_primary')::boolean, false) = true THEN
      v_has_primary := true;
      v_primary_email := NULLIF(lower(btrim(COALESCE(v_contact->>'email', ''))), '');
    END IF;
  END LOOP;

  IF NOT v_has_primary OR v_primary_email IS NULL THEN
    RAISE EXCEPTION 'Criação de cliente exige ao menos um contato principal com e-mail válido.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.customers (
    cnpj_cpf, name, trade_name, address, city, state, zip, notes
  )
  VALUES (
    btrim(p_customer->>'cnpj_cpf'),
    btrim(p_customer->>'name'),
    NULLIF(btrim(p_customer->>'trade_name'), ''),
    NULLIF(btrim(p_customer->>'address'), ''),
    NULLIF(btrim(p_customer->>'city'), ''),
    NULLIF(btrim(p_customer->>'state'), ''),
    NULLIF(btrim(p_customer->>'zip'), ''),
    NULLIF(btrim(p_customer->>'notes'), '')
  )
  RETURNING * INTO v_customer;

  -- Inserir contatos e vincular caixas
  FOR v_contact IN SELECT * FROM jsonb_array_elements(p_contacts)
  LOOP
    v_email := NULLIF(lower(btrim(COALESCE(v_contact->>'email', ''))), '');
    v_is_primary := COALESCE((v_contact->>'is_primary')::boolean, false);
    v_box_codes := v_contact->'box_codes';

    IF v_email IS NOT NULL THEN
      INSERT INTO public.customer_contacts (
        customer_id, name, email, phone, purpose, is_primary, origin
      )
      VALUES (
        v_customer.id,
        COALESCE(NULLIF(btrim(v_contact->>'name'), ''), 'Contato'),
        v_email,
        NULLIF(btrim(v_contact->>'phone'), ''),
        COALESCE(NULLIF(btrim(v_contact->>'purpose'), ''), 'geral'),
        v_is_primary,
        'interno'
      )
      RETURNING id INTO v_contact_id;

      IF v_is_primary THEN
        -- Principal recebe as 3 caixas
        INSERT INTO public.customer_contact_box_links (contact_id, box_code)
        SELECT v_contact_id, code
        FROM public.customer_communication_boxes
        WHERE active = true
        ON CONFLICT DO NOTHING;
      ELSE
        -- Adicionais recebem as caixas informadas ou documentacao_operacao
        IF v_box_codes IS NOT NULL AND jsonb_array_length(v_box_codes) > 0 THEN
          FOR v_box_code IN SELECT jsonb_array_elements_text(v_box_codes)
          LOOP
            INSERT INTO public.customer_contact_box_links (contact_id, box_code)
            VALUES (v_contact_id, v_box_code)
            ON CONFLICT DO NOTHING;
          END LOOP;
        ELSE
          INSERT INTO public.customer_contact_box_links (contact_id, box_code)
          VALUES (v_contact_id, 'documentacao_operacao')
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- Registrar evento inicial
  INSERT INTO public.customer_contact_change_events (
    customer_id, source, actor_id, after_snapshot, change_summary
  )
  VALUES (
    v_customer.id,
    'interno',
    auth.uid(),
    (public._build_customer_contact_configuration(v_customer.id))->'contacts',
    jsonb_build_object('action', 'customer_created')
  );

  RETURN to_jsonb(v_customer);
END;
$$;

-- Catálogo de alertas operacionais para caixas sem destinatário e contatos inativos no B/L
INSERT INTO public.alert_type_catalog (
  type, severity, responsible_department, audience_departments, default_destination, active
)
VALUES
  ('caixa_sem_destinatario', 'critical', 'documentacao', ARRAY['documentacao', 'administrativo'], '/clientes', true),
  ('cliente_sem_contato_principal', 'critical', 'documentacao', ARRAY['documentacao', 'administrativo'], '/clientes', true)
ON CONFLICT (type) DO UPDATE SET
  severity = EXCLUDED.severity,
  responsible_department = EXCLUDED.responsible_department,
  audience_departments = EXCLUDED.audience_departments,
  default_destination = EXCLUDED.default_destination,
  active = EXCLUDED.active;

-- ===========================================================================
-- 10. Fallback e Reparo por Disponibilidade: repair_customer_contact_box_fallbacks
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.repair_customer_contact_box_fallbacks(
  p_customer_id bigint,
  p_kind text DEFAULT NULL,
  p_box_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_box_codes text[] := ARRAY[]::text[];
  v_box text;
  v_primary_id bigint;
  v_substitute_id bigint;
  v_relinked_boxes text[] := ARRAY[]::text[];
  v_blocked_boxes text[] := ARRAY[]::text[];
  v_has_recipient boolean;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'customer_id obrigatorio');
  END IF;

  PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;

  -- Identificar caixas-alvo
  IF p_box_code IS NOT NULL THEN
    v_box_codes := ARRAY[p_box_code];
  ELSIF p_kind IS NOT NULL THEN
    SELECT COALESCE(array_agg(box_code), ARRAY[]::text[]) INTO v_box_codes
    FROM public.customer_communication_box_kinds
    WHERE kind = p_kind;
  ELSE
    SELECT COALESCE(array_agg(code), ARRAY[]::text[]) INTO v_box_codes
    FROM public.customer_communication_boxes
    WHERE active = true;
  END IF;

  -- 1. Para contatos com bounce permanente, desvincular das caixas
  DELETE FROM public.customer_contact_box_links l
  USING public.customer_contacts cc, public.portal_suppressed_emails pse
  WHERE l.contact_id = cc.id
    AND cc.customer_id = p_customer_id
    AND cc.email_normalized = lower(btrim(pse.email))
    AND pse.reason = 'bounce_permanente'
    AND l.box_code = ANY(v_box_codes);

  -- 2. Para cada caixa afetada, verificar se ficou sem destinatario ativo
  FOREACH v_box IN ARRAY v_box_codes
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.customer_contacts cc
      JOIN public.customer_contact_box_links l ON l.contact_id = cc.id
      WHERE cc.customer_id = p_customer_id
        AND cc.deactivated_at IS NULL
        AND cc.email_normalized IS NOT NULL
        AND l.box_code = v_box
        AND NOT EXISTS (
          SELECT 1 FROM public.portal_suppressed_emails pse
          WHERE lower(btrim(pse.email)) = cc.email_normalized AND pse.reason = 'bounce_permanente'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communication_suppressions ccs
          WHERE lower(btrim(ccs.email)) = cc.email_normalized
        )
    ) INTO v_has_recipient;

    IF NOT v_has_recipient THEN
      -- Tenta religar contato principal ativo e elegivel
      SELECT cc.id INTO v_primary_id
      FROM public.customer_contacts cc
      WHERE cc.customer_id = p_customer_id
        AND cc.is_primary = true
        AND cc.deactivated_at IS NULL
        AND cc.email_normalized IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.portal_suppressed_emails pse
          WHERE lower(btrim(pse.email)) = cc.email_normalized AND pse.reason = 'bounce_permanente'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communication_suppressions ccs
          WHERE lower(btrim(ccs.email)) = cc.email_normalized
        )
      LIMIT 1;

      IF v_primary_id IS NOT NULL THEN
        INSERT INTO public.customer_contact_box_links (contact_id, box_code)
        VALUES (v_primary_id, v_box)
        ON CONFLICT DO NOTHING;

        v_relinked_boxes := array_append(v_relinked_boxes, v_box);

        INSERT INTO public.customer_contact_change_events (
          customer_id, source, change_summary
        )
        VALUES (
          p_customer_id,
          'sistema',
          jsonb_build_object('action', 'relink_primary_fallback', 'box_code', v_box, 'contact_id', v_primary_id)
        );
      ELSE
        -- Tenta outro contato adicional ativo elegivel
        SELECT cc.id INTO v_substitute_id
        FROM public.customer_contacts cc
        WHERE cc.customer_id = p_customer_id
          AND cc.deactivated_at IS NULL
          AND cc.email_normalized IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.portal_suppressed_emails pse
            WHERE lower(btrim(pse.email)) = cc.email_normalized AND pse.reason = 'bounce_permanente'
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.customer_communication_suppressions ccs
            WHERE lower(btrim(ccs.email)) = cc.email_normalized
          )
        LIMIT 1;

        IF v_substitute_id IS NOT NULL THEN
          INSERT INTO public.customer_contact_box_links (contact_id, box_code)
          VALUES (v_substitute_id, v_box)
          ON CONFLICT DO NOTHING;

          v_relinked_boxes := array_append(v_relinked_boxes, v_box);

          INSERT INTO public.customer_contact_change_events (
            customer_id, source, change_summary
          )
          VALUES (
            p_customer_id,
            'sistema',
            jsonb_build_object('action', 'relink_substitute_fallback', 'box_code', v_box, 'contact_id', v_substitute_id)
          );
        ELSE
          -- Bloqueado: nenhum substituto elegivel
          v_blocked_boxes := array_append(v_blocked_boxes, v_box);
          PERFORM public.upsert_alert_item(
            'caixa_sem_destinatario',
            'customer',
            p_customer_id::text,
            'A caixa ' || v_box || ' não possui contatos ativos elegíveis.',
            'sistema',
            jsonb_build_object('customer_id', p_customer_id, 'box_code', v_box),
            '/clientes'
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'relinked_boxes', to_jsonb(v_relinked_boxes),
    'blocked_boxes', to_jsonb(v_blocked_boxes)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.repair_customer_contact_box_fallbacks(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repair_customer_contact_box_fallbacks(bigint, text, text) TO authenticated, service_role;

-- ===========================================================================
-- 11. Autorizacao de destinatario para envio real: customer_communication_recipient_allowed
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.customer_communication_recipient_allowed(
  p_customer_id bigint,
  p_contact_id bigint,
  p_kind text DEFAULT NULL,
  p_audience_mode text DEFAULT 'caixa',
  p_recipient_box_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_contact record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Acesso negado para consultar autorização de destinatário.' USING ERRCODE = '42501';
  END IF;

  IF p_customer_id IS NULL OR p_contact_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT id, customer_id, email_normalized, deactivated_at
  INTO v_contact
  FROM public.customer_contacts
  WHERE id = p_contact_id AND customer_id = p_customer_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_contact.deactivated_at IS NOT NULL OR v_contact.email_normalized IS NULL THEN
    RETURN false;
  END IF;

  IF v_contact.email_normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RETURN false;
  END IF;

  -- Checar supressoes
  IF EXISTS (
    SELECT 1 FROM public.portal_suppressed_emails pse
    WHERE lower(btrim(pse.email)) = v_contact.email_normalized AND pse.reason = 'bounce_permanente'
  ) OR EXISTS (
    SELECT 1 FROM public.customer_communication_suppressions ccs
    WHERE lower(btrim(ccs.email)) = v_contact.email_normalized
  ) THEN
    RETURN false;
  END IF;

  -- Audiencia todos / avisos gerais
  IF p_audience_mode = 'todos' OR p_kind = 'institucional' THEN
    RETURN true;
  END IF;

  -- Audiencia caixa especifica
  IF p_recipient_box_code IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM public.customer_contact_box_links
      WHERE contact_id = p_contact_id AND box_code = p_recipient_box_code
    );
  END IF;

  -- Audiencia baseada no modelo (kind)
  IF p_kind IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM public.customer_contact_box_links l
      JOIN public.customer_communication_box_kinds k ON k.box_code = l.box_code
      WHERE l.contact_id = p_contact_id AND k.kind = p_kind
    );
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.customer_communication_recipient_allowed(
  bigint, bigint, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_communication_recipient_allowed(
  bigint, bigint, text, text, text
) TO authenticated, service_role;

-- ===========================================================================
-- 12. Atualizar produtoras automaticas para consultar customer_contact_box_links
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.claim_due_demurrage_dunning_invoices(
  p_limit integer DEFAULT 25,
  p_as_of timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_interval_days INTEGER := 7;
  v_candidates JSONB := '[]'::JSONB;
  v_invoice RECORD;
  v_inserted INT;
  v_claimed_at TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Acesso negado para cobrança de demurrage.' USING ERRCODE = '42501';
  END IF;

  FOR v_invoice IN
    SELECT di.id, di.customer_id, di.bl_id, di.doc_number, di.total_usd,
      di.first_billed_at,
      concat_ws(':', di.id::text, to_char(COALESCE(p_as_of, now()) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')) AS attempt_discriminator
    FROM public.demurrage_invoices AS di
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE prior_claim.released_at IS NULL)::INTEGER AS attempt_count,
        max(prior_claim.claimed_at) FILTER (WHERE prior_claim.released_at IS NULL) AS claimed_at
      FROM public.demurrage_dunning_claims AS prior_claim
      WHERE prior_claim.demurrage_invoice_id = di.id
    ) AS claims ON true
    WHERE COALESCE(di.status, 'issued') IN ('issued', 'overdue')
      AND di.first_billed_at IS NOT NULL AND di.paid_at IS NULL
      AND COALESCE(di.dispute_open, false) = false
      AND EXISTS (
        SELECT 1 FROM public.customer_contacts AS cc
        JOIN public.customer_contact_box_links AS bl ON bl.contact_id = cc.id
        WHERE cc.customer_id = di.customer_id
          AND cc.deactivated_at IS NULL
          AND bl.box_code IN ('demurrage', 'financeiro')
          AND cc.email_normalized IS NOT NULL
          AND cc.email_normalized ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
          AND NOT EXISTS (
            SELECT 1 FROM public.portal_suppressed_emails pse
            WHERE lower(btrim(pse.email)) = cc.email_normalized AND pse.reason = 'bounce_permanente'
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.customer_communication_suppressions ccs
            WHERE lower(btrim(ccs.email)) = cc.email_normalized
          )
      )
      AND COALESCE(p_as_of, now()) >= (di.first_billed_at::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo' + make_interval(days => v_interval_days * COALESCE(claims.attempt_count, 0)))
    ORDER BY di.id
    LIMIT v_limit
    FOR UPDATE OF di SKIP LOCKED
  LOOP
    v_inserted := 0;
    v_claimed_at := NULL;
    INSERT INTO public.demurrage_dunning_claims (demurrage_invoice_id, attempt_discriminator)
    VALUES (v_invoice.id, v_invoice.attempt_discriminator)
    ON CONFLICT (demurrage_invoice_id, attempt_discriminator) DO UPDATE
      SET claimed_at = now(), released_at = NULL
      WHERE demurrage_dunning_claims.released_at IS NOT NULL
    RETURNING claimed_at INTO v_claimed_at;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 1 THEN
      v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
        'invoice_id', v_invoice.id, 'customer_id', v_invoice.customer_id, 'bl_id', v_invoice.bl_id,
        'doc_number', v_invoice.doc_number, 'total_usd', v_invoice.total_usd,
        'first_billed_at', v_invoice.first_billed_at,
        'attempt_discriminator', v_invoice.attempt_discriminator,
        'claimed_at', v_claimed_at
      ));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'candidates', v_candidates,
    'claimed_count', jsonb_array_length(v_candidates),
    'as_of', COALESCE(p_as_of, now())
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.find_due_customer_communication_automations(
  p_as_of timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_voyage_id bigint DEFAULT NULL::bigint
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_as_of TIMESTAMPTZ := COALESCE(p_as_of, now());
  v_candidates JSONB := '[]'::JSONB;
  v_candidate RECORD;
  v_customer_bl RECORD;
  v_kind TEXT;
  v_port TEXT;
  v_voyage_id BIGINT;
  v_voyage_number TEXT;
  v_vessel_name TEXT;
  v_milestone TIMESTAMPTZ;
  v_key TEXT;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Acesso negado para automação de comunicados.' USING ERRCODE = '42501';
  END IF;

  FOR v_candidate IN
    SELECT v.id AS voyage_id, v.voyage_number, vs.name AS vessel_name,
      b.pod AS port, 'aviso_chegada_noa' AS kind, v.eta AS milestone_at
    FROM public.voyages v
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    JOIN public.bls b ON b.voyage_id = v.id
    WHERE v.eta IS NOT NULL
      AND (p_voyage_id IS NULL OR v.id = p_voyage_id)
      AND v_as_of >= (v.eta - interval '72 hours')
      AND v_as_of < (v.eta + interval '24 hours')
    GROUP BY v.id, v.voyage_number, vs.name, b.pod, v.eta
    UNION ALL
    SELECT v.id AS voyage_id, v.voyage_number, vs.name AS vessel_name,
      b.pod AS port, 'aviso_prontidao_nor' AS kind, v.eta AS milestone_at
    FROM public.voyages v
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    JOIN public.bls b ON b.voyage_id = v.id
    WHERE v.eta IS NOT NULL
      AND (p_voyage_id IS NULL OR v.id = p_voyage_id)
      AND v_as_of >= (v.eta - interval '24 hours')
      AND v_as_of < (v.eta + interval '24 hours')
    GROUP BY v.id, v.voyage_number, vs.name, b.pod, v.eta
    UNION ALL
    SELECT v.id AS voyage_id, v.voyage_number, vs.name AS vessel_name,
      b.pod AS port, 'aviso_atracacao_nob' AS kind, v.ata AS milestone_at
    FROM public.voyages v
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    JOIN public.bls b ON b.voyage_id = v.id
    WHERE v.ata IS NOT NULL
      AND (p_voyage_id IS NULL OR v.id = p_voyage_id)
      AND v_as_of >= v.ata
      AND v_as_of < (v.ata + interval '48 hours')
    GROUP BY v.id, v.voyage_number, vs.name, b.pod, v.ata
  LOOP
    v_kind := v_candidate.kind;
    v_port := v_candidate.port;
    v_voyage_id := v_candidate.voyage_id;
    v_voyage_number := v_candidate.voyage_number;
    v_vessel_name := v_candidate.vessel_name;
    v_milestone := v_candidate.milestone_at;

    FOR v_customer_bl IN
      SELECT b.customer_id, array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids,
        c.name AS customer_name, c.cnpj_cpf,
        array_agg(DISTINCT cc.email_normalized ORDER BY cc.email_normalized)
          FILTER (WHERE cc.email_normalized IS NOT NULL
            AND cc.email_normalized ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') AS emails
      FROM public.bls b
      JOIN public.customers c ON c.id = b.customer_id
      LEFT JOIN public.customer_contacts cc ON cc.customer_id = b.customer_id
      JOIN public.customer_contact_box_links bl ON bl.contact_id = cc.id
      WHERE b.voyage_id = v_voyage_id
        AND upper(btrim(b.pod)) = upper(btrim(v_port))
        AND b.customer_id IS NOT NULL
        AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
        AND cc.deactivated_at IS NULL
        AND bl.box_code = 'documentacao_operacao'
        AND cc.email_normalized IS NOT NULL
        AND cc.email_normalized ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        AND NOT EXISTS (
          SELECT 1 FROM public.portal_suppressed_emails pse
          WHERE lower(btrim(pse.email)) = cc.email_normalized AND pse.reason = 'bounce_permanente'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communication_suppressions ccs
          WHERE lower(btrim(ccs.email)) = cc.email_normalized
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_communications sent
          WHERE sent.customer_id = b.customer_id
            AND sent.kind = v_kind
            AND sent.status IN ('enviado', 'simulado')
            AND sent.anchor_voyage_id = v_voyage_id
            AND upper(btrim(sent.anchor_port)) = upper(btrim(v_port))
        )
      GROUP BY b.customer_id, c.name, c.cnpj_cpf
    LOOP
      v_key := v_kind || ':' || v_customer_bl.customer_id || ':' || v_voyage_id || ':' || upper(v_port);
      INSERT INTO public.customer_communication_automation_claims (claim_key)
      VALUES (v_key)
      ON CONFLICT (claim_key) DO UPDATE
        SET claimed_at = now(), released_at = NULL
        WHERE customer_communication_automation_claims.released_at IS NOT NULL
           OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes';
      IF FOUND THEN
        v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
          'claim_key', v_key, 'kind', v_kind, 'nature', 'avisos_operacionais',
          'customer_id', v_customer_bl.customer_id, 'customer_name', v_customer_bl.customer_name,
          'customer_cnpj', v_customer_bl.cnpj_cpf, 'voyage_id', v_voyage_id,
          'vessel_name', v_vessel_name, 'voyage_number', v_voyage_number,
          'port', upper(v_port), 'milestone_at', v_milestone,
          'bl_ids', to_jsonb(v_customer_bl.bl_ids), 'emails', to_jsonb(v_customer_bl.emails)
        ));
      END IF;
    END LOOP;
  END LOOP;

  -- CE Mercante: produtor server-side duravel
  FOR v_customer_bl IN
    SELECT b.voyage_id, b.customer_id, c.name AS customer_name, c.cnpj_cpf,
      v.voyage_number, vs.name AS vessel_name, min(b.pod) AS port,
      v.eta AS milestone_at, array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids,
      array_agg(DISTINCT cc.email_normalized ORDER BY cc.email_normalized) AS emails
    FROM public.bls b
    JOIN public.customers c ON c.id = b.customer_id
    JOIN public.voyages v ON v.id = b.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    JOIN public.customer_contacts cc ON cc.customer_id = b.customer_id
    JOIN public.customer_contact_box_links bl ON bl.contact_id = cc.id
    WHERE b.customer_id IS NOT NULL
      AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
      AND cc.deactivated_at IS NULL
      AND bl.box_code IN ('documentacao_operacao', 'financeiro')
      AND cc.email_normalized IS NOT NULL
      AND cc.email_normalized ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      AND NOT EXISTS (
        SELECT 1 FROM public.portal_suppressed_emails pse
        WHERE lower(btrim(pse.email)) = cc.email_normalized AND pse.reason = 'bounce_permanente'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_communication_suppressions ccs
        WHERE lower(btrim(ccs.email)) = cc.email_normalized
      )
      AND (public.customer_local_charges_communication_readiness(b.voyage_id, b.customer_id)->>'ready')::BOOLEAN
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_communications sent
        WHERE sent.customer_id = b.customer_id AND sent.kind = 'ce_mercante_taxas'
          AND sent.status IN ('enviado', 'simulado')
          AND sent.anchor_voyage_id = b.voyage_id
      )
    GROUP BY b.voyage_id, b.customer_id, c.name, c.cnpj_cpf, v.voyage_number, vs.name, v.eta
  LOOP
    v_key := 'ce_mercante_taxas:' || v_customer_bl.customer_id || ':' || v_customer_bl.voyage_id;
    INSERT INTO public.customer_communication_automation_claims (claim_key)
    VALUES (v_key)
    ON CONFLICT (claim_key) DO UPDATE
      SET claimed_at = now(), released_at = NULL
      WHERE customer_communication_automation_claims.released_at IS NOT NULL
         OR customer_communication_automation_claims.claimed_at < v_as_of - interval '30 minutes';
    IF FOUND THEN
      v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
        'claim_key', v_key, 'kind', 'ce_mercante_taxas', 'nature', 'documentacao',
        'customer_id', v_customer_bl.customer_id, 'customer_name', v_customer_bl.customer_name,
        'customer_cnpj', v_customer_bl.cnpj_cpf, 'voyage_id', v_customer_bl.voyage_id,
        'vessel_name', v_customer_bl.vessel_name, 'voyage_number', v_customer_bl.voyage_number,
        'port', upper(v_customer_bl.port), 'milestone_at', v_customer_bl.milestone_at,
        'bl_ids', to_jsonb(v_customer_bl.bl_ids), 'emails', to_jsonb(v_customer_bl.emails)
      ));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'candidates', v_candidates,
    'claimed_count', jsonb_array_length(v_candidates),
    'as_of', v_as_of
  );
END;
$$;

-- ===========================================================================
-- 13. Captura automatica de B/L e mapeamento em caixas
-- ===========================================================================

DROP FUNCTION IF EXISTS public.ensure_customer_contact_email(bigint, text, text, text);

CREATE OR REPLACE FUNCTION public.ensure_customer_contact_email(
  p_customer_id bigint,
  p_email text,
  p_contact_name text DEFAULT 'Contato manifesto'::text,
  p_purpose text DEFAULT 'financeiro'::text,
  p_related_bl_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_email text;
  v_has_primary boolean := false;
  v_existing record;
  v_contact_id bigint;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Acesso negado para cadastrar contato.' USING ERRCODE = '42501';
  END IF;

  IF p_customer_id IS NULL THEN
    RETURN false;
  END IF;

  v_email := lower(NULLIF(btrim(COALESCE(p_email, '')), ''));
  IF v_email IS NULL THEN
    RETURN false;
  END IF;

  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'E-mail inválido.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;

  SELECT id, is_primary, deactivated_at
  INTO v_existing
  FROM public.customer_contacts
  WHERE customer_id = p_customer_id
    AND email_normalized = v_email
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM public.customer_contacts
    WHERE customer_id = p_customer_id
      AND is_primary = true
      AND deactivated_at IS NULL
  )
  INTO v_has_primary;

  IF v_existing.id IS NOT NULL THEN
    -- Ativo ou inativo: nao duplica, nao reativa, nao altera caixas
    IF v_existing.deactivated_at IS NOT NULL AND NOT v_has_primary THEN
      PERFORM public.upsert_alert_item(
        'cliente_sem_contato_principal',
        'customer',
        p_customer_id::text,
        'Endereço reapareceu no B/L mas cadastro permanece inativo',
        'bl_automatico',
        jsonb_build_object('customer_id', p_customer_id, 'email', v_email),
        '/clientes'
      );
    END IF;
    RETURN false;
  END IF;

  INSERT INTO public.customer_contacts (
    customer_id, name, email, origin, is_primary, purpose
  )
  VALUES (
    p_customer_id,
    COALESCE(NULLIF(btrim(p_contact_name), ''), 'Contato manifesto'),
    v_email,
    'bl_automatico',
    NOT v_has_primary,
    COALESCE(NULLIF(btrim(p_purpose), ''), 'financeiro')
  )
  RETURNING id INTO v_contact_id;

  INSERT INTO public.customer_contact_box_links (contact_id, box_code)
  SELECT v_contact_id, code
  FROM public.customer_communication_boxes
  WHERE active = true
    AND (NOT v_has_primary OR code = 'documentacao_operacao');

  INSERT INTO public.customer_contact_change_events (
    customer_id, source, related_bl_id, after_snapshot, change_summary
  )
  VALUES (
    p_customer_id,
    'bl_automatico',
    p_related_bl_id,
    jsonb_build_array(jsonb_build_object(
      'id', v_contact_id,
      'email', v_email,
      'is_primary', NOT v_has_primary,
      'origin', 'bl_automatico',
      'box_codes', CASE WHEN NOT v_has_primary THEN jsonb_build_array('documentacao_operacao', 'financeiro', 'demurrage') ELSE jsonb_build_array('documentacao_operacao') END
    )),
    jsonb_build_object('action', 'bl_contact_captured', 'contact_id', v_contact_id, 'email', v_email, 'is_primary', NOT v_has_primary)
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_customer_contact_email(bigint, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_customer_contact_email(bigint, text, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.capture_manifest_financial_contact(
  p_customer_id bigint,
  p_email text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN public.ensure_customer_contact_email(p_customer_id, p_email, 'Contato manifesto');
END;
$$;
