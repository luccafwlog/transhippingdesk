-- 372: fundação do canal de Comunicados ao Cliente (Bloco 1, T2).
--
-- O canal nasce sem comunicados históricos e com o envio global desligado.
-- As âncoras são snapshots de valor: não apontam por FK para escalas,
-- atracações ou faturas, porque essas origens podem ser editadas ou removidas
-- sem apagar o histórico do que já foi comunicado.
--
-- Rollback operacional: interromper o uso do canal e restaurar a branch
-- anterior; não remover comunicados, tentativas ou supressões que já tenham
-- servido como histórico operacional.

CREATE TABLE IF NOT EXISTS public.customer_communication_kinds (
  kind TEXT NOT NULL,
  nature TEXT NOT NULL CHECK (nature IN ('avisos_gerais', 'avisos_operacionais', 'documentacao', 'demurrage')),
  PRIMARY KEY (kind, nature)
);

-- Os modelos fixos têm exatamente uma natureza. `livre` é a exceção: o autor
-- escolhe a natureza no disparo e, por isso, tem uma linha para cada opção.
CREATE UNIQUE INDEX IF NOT EXISTS customer_communication_fixed_kind_unique
  ON public.customer_communication_kinds (kind)
  WHERE kind <> 'livre';

INSERT INTO public.customer_communication_kinds (kind, nature)
VALUES
  ('aviso_chegada_noa', 'avisos_operacionais'),
  ('aviso_prontidao_nor', 'avisos_operacionais'),
  ('aviso_atracacao_nob', 'avisos_operacionais'),
  ('ce_mercante_taxas', 'documentacao'),
  ('cobranca_demurrage', 'demurrage'),
  ('institucional', 'avisos_gerais'),
  ('livre', 'avisos_gerais'),
  ('livre', 'avisos_operacionais'),
  ('livre', 'documentacao'),
  ('livre', 'demurrage')
ON CONFLICT (kind, nature) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.customer_communications (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  nature TEXT NOT NULL,
  anchor_voyage_id BIGINT,
  anchor_port TEXT CHECK (anchor_port IS NULL OR btrim(anchor_port) <> ''),
  anchor_atracacao_id UUID,
  anchor_invoice_id BIGINT,
  attempt_discriminator INTEGER NOT NULL DEFAULT 0 CHECK (attempt_discriminator >= 0),
  status TEXT NOT NULL DEFAULT 'simulado'
    CHECK (status IN ('enviado', 'simulado', 'falha')),
  dispatch_id UUID,
  vessel_name TEXT,
  voyage_number TEXT,
  terminal_name TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_communications_kind_nature_fkey
    FOREIGN KEY (kind, nature)
    REFERENCES public.customer_communication_kinds(kind, nature)
    ON DELETE RESTRICT
);

-- `NULLS NOT DISTINCT` é parte do contrato: NULL em qualquer âncora ainda
-- representa o mesmo primeiro disparo e não pode permitir duplo clique.
CREATE UNIQUE INDEX IF NOT EXISTS customer_communications_idempotency
  ON public.customer_communications (
    kind,
    customer_id,
    status,
    anchor_voyage_id,
    anchor_port,
    anchor_atracacao_id,
    anchor_invoice_id,
    dispatch_id,
    attempt_discriminator
  ) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_customer_communications_customer
  ON public.customer_communications (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_communications_anchor_voyage
  ON public.customer_communications (anchor_voyage_id, anchor_port);
CREATE INDEX IF NOT EXISTS idx_customer_communications_anchor_atracacao
  ON public.customer_communications (anchor_atracacao_id);
CREATE INDEX IF NOT EXISTS idx_customer_communications_anchor_invoice
  ON public.customer_communications (anchor_invoice_id);

CREATE TABLE IF NOT EXISTS public.customer_communication_bls (
  communication_id BIGINT NOT NULL
    REFERENCES public.customer_communications(id) ON DELETE CASCADE,
  bl_id TEXT NOT NULL REFERENCES public.bls(id) ON DELETE RESTRICT,
  PRIMARY KEY (communication_id, bl_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_communication_bls_bl
  ON public.customer_communication_bls (bl_id);

CREATE TABLE IF NOT EXISTS public.customer_communication_attempts (
  id BIGSERIAL PRIMARY KEY,
  communication_id BIGINT NOT NULL
    REFERENCES public.customer_communications(id) ON DELETE CASCADE,
  recipient_masked TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aceito'
    CHECK (status IN ('aceito', 'entregue', 'bounce', 'complaint', 'falha_transitoria', 'falha_permanente')),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  provider_message_id TEXT,
  last_error TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_communication_attempts_communication
  ON public.customer_communication_attempts (communication_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_communication_attempts_provider
  ON public.customer_communication_attempts (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_customer_communication_attempts_updated_at
  ON public.customer_communication_attempts;
CREATE TRIGGER set_customer_communication_attempts_updated_at
  BEFORE UPDATE ON public.customer_communication_attempts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.customer_communication_suppressions (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL DEFAULT 'complaint' CHECK (reason = 'complaint'),
  suppressed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_contact_preferences (
  contact_id BIGINT NOT NULL REFERENCES public.customer_contacts(id) ON DELETE CASCADE,
  nature TEXT NOT NULL CHECK (nature IN ('avisos_gerais', 'avisos_operacionais', 'documentacao', 'demurrage')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL DEFAULT 'interno' CHECK (source IN ('interno', 'cliente')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, nature)
);

CREATE TABLE IF NOT EXISTS public.app_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  communications_enabled BOOLEAN NOT NULL DEFAULT false,
  demurrage_dunning_interval_days INTEGER NOT NULL DEFAULT 7
    CHECK (demurrage_dunning_interval_days > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.app_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- A notificação automática de bounce continua na mesma trilha transacional do
-- Portal, mas tem uma natureza própria para impedir que um novo bounce dela
-- abra outra cascata. A tabela foi criada na migration 178, por isso a
-- constraint é ampliada aqui sem alterar as tentativas históricas.
ALTER TABLE public.portal_email_attempts
  DROP CONSTRAINT IF EXISTS portal_email_attempts_kind_check;
ALTER TABLE public.portal_email_attempts
  ADD CONSTRAINT portal_email_attempts_kind_check
  CHECK (kind IN ('convite', 'reenvio', 'recuperacao', 'alteracao_email', 'alerta_critico', 'resumo_diario', 'contato_bounced_notificacao'));

-- Um evento do Resend pode apontar para uma tentativa do Portal ou para uma
-- tentativa de Comunicado, nunca para ambas. A coluna nova fica sem FK pelo
-- mesmo motivo das âncoras: é trilha de evento, não dono do ciclo de vida.
ALTER TABLE public.portal_email_events
  ADD COLUMN IF NOT EXISTS communication_attempt_id BIGINT;

ALTER TABLE public.portal_email_events
  DROP CONSTRAINT IF EXISTS portal_email_events_single_attempt_check;
ALTER TABLE public.portal_email_events
  ADD CONSTRAINT portal_email_events_single_attempt_check
  CHECK (NOT (attempt_id IS NOT NULL AND communication_attempt_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_portal_email_events_communication_attempt
  ON public.portal_email_events (communication_attempt_id)
  WHERE communication_attempt_id IS NOT NULL;

-- Contatos existentes recebem as quatro preferências ligadas. O mesmo bloco é
-- aplicado a todo contato criado depois da migration, sem reaproveitar
-- `purpose`, que continua tendo o significado do cadastro/Portal.
INSERT INTO public.customer_contact_preferences (contact_id, nature, enabled, source)
SELECT cc.id, n.nature, true, 'interno'
FROM public.customer_contacts AS cc
CROSS JOIN (VALUES
  ('avisos_gerais'::TEXT),
  ('avisos_operacionais'::TEXT),
  ('documentacao'::TEXT),
  ('demurrage'::TEXT)
) AS n(nature)
ON CONFLICT (contact_id, nature) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_customer_contact_preferences()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  INSERT INTO public.customer_contact_preferences (contact_id, nature, enabled, source)
  VALUES
    (NEW.id, 'avisos_gerais', true, 'interno'),
    (NEW.id, 'avisos_operacionais', true, 'interno'),
    (NEW.id, 'documentacao', true, 'interno'),
    (NEW.id, 'demurrage', true, 'interno')
  ON CONFLICT (contact_id, nature) DO NOTHING;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.seed_customer_contact_preferences() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_seed_customer_contact_preferences ON public.customer_contacts;
CREATE TRIGGER trg_seed_customer_contact_preferences
  AFTER INSERT ON public.customer_contacts
  FOR EACH ROW EXECUTE FUNCTION public.seed_customer_contact_preferences();

CREATE OR REPLACE FUNCTION public.set_communications_enabled(p_enabled BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_previous BOOLEAN;
BEGIN
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'O estado da chave de Comunicados é obrigatório.' USING ERRCODE = '22023';
  END IF;

  IF v_role IS DISTINCT FROM 'administrativo' THEN
    RAISE EXCEPTION 'Somente o perfil administrativo pode alterar a chave de Comunicados.'
      USING ERRCODE = '42501';
  END IF;

  SELECT communications_enabled
    INTO v_previous
    FROM public.app_settings
    WHERE id = 1
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuração global não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.app_settings
  SET communications_enabled = p_enabled
  WHERE id = 1;

  IF v_previous IS DISTINCT FROM p_enabled THEN
    INSERT INTO public.audit_logs (
      entity_type,
      entity_id,
      field_name,
      old_value,
      new_value,
      changed_by,
      justification
    )
    VALUES (
      'app_settings',
      '1',
      'communications_enabled',
      v_previous::TEXT,
      p_enabled::TEXT,
      auth.uid(),
      'Alteração da chave global de envio de Comunicados'
    );
  END IF;

  RETURN p_enabled;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_communications_enabled(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_communications_enabled(BOOLEAN) TO authenticated;

-- RLS: o histórico é consultável por usuários internos ativos; gravações de
-- Comunicados, tentativas, eventos e supressões ficam no service_role. As
-- preferências são a exceção editável pela operação de cadastro.
ALTER TABLE public.customer_communication_kinds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_communications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_communication_bls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_communication_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_communication_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_contact_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.customer_communication_kinds FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.customer_communications FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.customer_communication_bls FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.customer_communication_attempts FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.customer_communication_suppressions FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.customer_contact_preferences FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.app_settings FROM PUBLIC, anon;

GRANT SELECT ON TABLE public.customer_communication_kinds TO authenticated;
GRANT SELECT ON TABLE public.customer_communications TO authenticated;
GRANT SELECT ON TABLE public.customer_communication_bls TO authenticated;
GRANT SELECT ON TABLE public.customer_communication_attempts TO authenticated;
GRANT SELECT ON TABLE public.customer_communication_suppressions TO authenticated;
GRANT SELECT ON TABLE public.customer_contact_preferences TO authenticated;
GRANT SELECT ON TABLE public.app_settings TO authenticated;

DROP POLICY IF EXISTS customer_communication_kinds_internal_read ON public.customer_communication_kinds;
CREATE POLICY customer_communication_kinds_internal_read
  ON public.customer_communication_kinds FOR SELECT TO authenticated
  USING (public.is_active_read_user());

DROP POLICY IF EXISTS customer_communications_internal_read ON public.customer_communications;
CREATE POLICY customer_communications_internal_read
  ON public.customer_communications FOR SELECT TO authenticated
  USING (public.is_active_read_user());

DROP POLICY IF EXISTS customer_communication_bls_internal_read ON public.customer_communication_bls;
CREATE POLICY customer_communication_bls_internal_read
  ON public.customer_communication_bls FOR SELECT TO authenticated
  USING (public.is_active_read_user());

DROP POLICY IF EXISTS customer_communication_attempts_internal_read ON public.customer_communication_attempts;
CREATE POLICY customer_communication_attempts_internal_read
  ON public.customer_communication_attempts FOR SELECT TO authenticated
  USING (public.is_active_read_user());

DROP POLICY IF EXISTS customer_communication_suppressions_internal_read ON public.customer_communication_suppressions;
CREATE POLICY customer_communication_suppressions_internal_read
  ON public.customer_communication_suppressions FOR SELECT TO authenticated
  USING (public.is_active_read_user());

DROP POLICY IF EXISTS customer_contact_preferences_internal_read ON public.customer_contact_preferences;
CREATE POLICY customer_contact_preferences_internal_read
  ON public.customer_contact_preferences FOR SELECT TO authenticated
  USING (public.is_active_read_user());

DROP POLICY IF EXISTS customer_contact_preferences_edit ON public.customer_contact_preferences;
CREATE POLICY customer_contact_preferences_edit
  ON public.customer_contact_preferences FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles
      WHERE id = auth.uid()
        AND active = true
        AND role IN ('admin', 'administrativo', 'operator', 'documentacao', 'equipamentos')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_profiles
      WHERE id = auth.uid()
        AND active = true
        AND role IN ('admin', 'administrativo', 'operator', 'documentacao', 'equipamentos')
    )
    AND source = 'interno'
  );

DROP POLICY IF EXISTS app_settings_communications_read ON public.app_settings;
CREATE POLICY app_settings_communications_read
  ON public.app_settings FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles
      WHERE id = auth.uid()
        AND active = true
        AND role IN ('admin', 'administrativo', 'operator', 'documentacao', 'equipamentos')
    )
  );

-- Mantém a guarda explícita também na policy, embora a aplicação use a RPC
-- SECURITY DEFINER. A ausência de GRANT UPDATE para authenticated impede uma
-- escrita direta sem a trilha da função.
DROP POLICY IF EXISTS app_settings_administrativo_update ON public.app_settings;
CREATE POLICY app_settings_administrativo_update
  ON public.app_settings FOR UPDATE TO authenticated
  USING (public._portal_actor_role() = 'administrativo')
  WITH CHECK (public._portal_actor_role() = 'administrativo');

-- Registra o alerta de contato sem alternativa no catálogo para que a emissão
-- pelo webhook crie alert_items com severidade, setor e destino corretos.
INSERT INTO public.alert_type_catalog (
  type, severity, responsible_department, audience_departments, default_destination
)
VALUES (
  'cliente_contato_bounced_sem_alternativa',
  'critical',
  'documentacao',
  ARRAY['documentacao', 'administrativo'],
  '/clientes'
)
ON CONFLICT (type) DO UPDATE SET
  severity = EXCLUDED.severity,
  responsible_department = EXCLUDED.responsible_department,
  audience_departments = EXCLUDED.audience_departments,
  default_destination = EXCLUDED.default_destination,
  active = true;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.customer_communications FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.customer_communication_bls FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.customer_communication_attempts FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.customer_communication_suppressions FROM authenticated;
REVOKE INSERT, DELETE ON TABLE public.customer_contact_preferences FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.app_settings FROM authenticated;

GRANT ALL ON TABLE public.customer_communication_kinds TO service_role;
GRANT ALL ON TABLE public.customer_communications TO service_role;
GRANT ALL ON TABLE public.customer_communication_bls TO service_role;
GRANT ALL ON TABLE public.customer_communication_attempts TO service_role;
GRANT ALL ON TABLE public.customer_communication_suppressions TO service_role;
GRANT ALL ON TABLE public.customer_contact_preferences TO service_role;
GRANT ALL ON TABLE public.app_settings TO service_role;

