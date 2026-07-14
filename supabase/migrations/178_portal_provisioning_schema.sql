-- 178: Provisionamento do Portal do Cliente — máquina de estados e convites.
-- Tokens e senhas nunca são persistidos em claro.

ALTER TABLE public.customer_portal_accounts
  ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE public.customer_portal_accounts
  ADD COLUMN IF NOT EXISTS provisioning_decision TEXT NOT NULL DEFAULT 'aguardando_analise'
    CHECK (provisioning_decision IN ('aguardando_analise','aprovado_para_provisionar','provisionamento_nao_necessario')),
  ADD COLUMN IF NOT EXISTS account_situation TEXT NOT NULL DEFAULT 'sem_conta'
    CHECK (account_situation IN ('sem_conta','convite_pendente','convite_expirado','falha_no_envio','ativo','suspenso')),
  ADD COLUMN IF NOT EXISTS recovery_email TEXT,
  ADD COLUMN IF NOT EXISTS recovery_email_source TEXT
    CHECK (recovery_email_source IN ('candidato','informado_manualmente'));

CREATE INDEX IF NOT EXISTS idx_portal_accounts_recovery_email
  ON public.customer_portal_accounts (lower(recovery_email))
  WHERE recovery_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_portal_accounts_situation
  ON public.customer_portal_accounts (account_situation, provisioning_decision);

CREATE TABLE IF NOT EXISTS public.portal_invites (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES public.customer_portal_accounts(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('convite','recuperacao')),
  token_hash TEXT NOT NULL UNIQUE,
  sent_to_email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','consumido','expirado','cancelado','invalidado_por_reenvio')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ,
  cancelled_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_portal_invites_account_pending
  ON public.portal_invites (account_id, expires_at) WHERE status = 'pendente';

CREATE TABLE IF NOT EXISTS public.portal_email_attempts (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT REFERENCES public.customer_portal_accounts(id) ON DELETE SET NULL,
  invite_id BIGINT REFERENCES public.portal_invites(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('convite','reenvio','recuperacao','alteracao_email','alerta_critico','resumo_diario')),
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_message_id TEXT,
  recipient_masked TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aceito'
    CHECK (status IN ('aceito','entregue','bounce','complaint','falha_transitoria','falha_permanente')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS set_portal_email_attempts_updated_at ON public.portal_email_attempts;
CREATE TRIGGER set_portal_email_attempts_updated_at BEFORE UPDATE ON public.portal_email_attempts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.portal_email_events (
  id BIGSERIAL PRIMARY KEY,
  provider_event_id TEXT NOT NULL UNIQUE,
  attempt_id BIGINT REFERENCES public.portal_email_attempts(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.portal_suppressed_emails (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL CHECK (reason IN ('bounce_permanente','complaint')),
  suppressed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.portal_provisioning_events (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  account_id BIGINT REFERENCES public.customer_portal_accounts(id) ON DELETE SET NULL,
  invite_id BIGINT REFERENCES public.portal_invites(id) ON DELETE SET NULL,
  previous_decision TEXT,
  new_decision TEXT,
  previous_situation TEXT,
  new_situation TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('documentacao','administrativo','cliente','sistema')),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_events_customer
  ON public.portal_provisioning_events (customer_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.portal_events_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'portal_provisioning_events é somente inclusão'; END;
$$;
DROP TRIGGER IF EXISTS portal_events_no_update ON public.portal_provisioning_events;
CREATE TRIGGER portal_events_no_update BEFORE UPDATE OR DELETE ON public.portal_provisioning_events
FOR EACH ROW EXECUTE FUNCTION public.portal_events_block_mutation();

ALTER TABLE public.portal_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_email_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_email_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_suppressed_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_provisioning_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY portal_invites_internal_read ON public.portal_invites FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = auth.uid() AND p.active = true));
CREATE POLICY portal_email_attempts_internal_read ON public.portal_email_attempts FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = auth.uid() AND p.active = true));
CREATE POLICY portal_email_events_internal_read ON public.portal_email_events FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = auth.uid() AND p.active = true));
CREATE POLICY portal_suppressed_internal_read ON public.portal_suppressed_emails FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = auth.uid() AND p.active = true));
CREATE POLICY portal_events_internal_read ON public.portal_provisioning_events FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = auth.uid() AND p.active = true));
