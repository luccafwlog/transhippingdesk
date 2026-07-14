# Plano 1 — Schema e Máquina de Estados do Provisionamento

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o schema, a máquina de estados auditada e os RPCs de pré-voo/backfill do provisionamento do Portal, deixando os 309 Clientes em `Aguardando análise` sem criar Auth, senha ou email.

**Architecture:** Reutiliza `customer_portal_accounts` (já 1:1 com `customers`) como o "registro de Portal", adicionando os dois eixos da máquina de estados (decisão de provisionamento e situação da conta) e o Email de Recuperação. Tabelas novas para convites (hash de token), tentativas de email, eventos de webhook, supressões e o histórico append-only. Toda escrita passa por RPCs `SECURITY DEFINER` que validam papel interno; as tabelas negam escrita direta via RLS.

**Tech Stack:** PostgreSQL (Supabase), migration `178_`, RPCs plpgsql, vitest para contratos de serviço.

**Leitura obrigatória antes de começar:** skill `supabase-migration`; `CONTEXT.md` (seções "Aguardando análise", "Backfill inicial do Portal", "Convite pendente/expirado", "Provisionamento não necessário no momento"); issue #370 seção "Máquina de estados — decisão desta frente".

**Regras do domínio que este plano implementa (não desviar):**
- Decisão de provisionamento: `Aguardando análise` | `Aprovado para provisionar` | `Provisionamento não necessário no momento`.
- Situação da conta: `Sem conta` | `Convite pendente` | `Convite expirado` | `Falha no envio` | `Ativo` | `Suspenso`.
- Não existe fila separada de "aprovados aguardando envio": aprovar e enviar são a mesma operação (plano 5); a decisão `aprovado_para_provisionar` só é gravada dentro dela.
- Histórico é somente inclusão; senhas e tokens nunca entram na auditoria; emails mascarados.
- Backfill: cria registro por Cliente em `Aguardando análise`; NÃO cria Conta, Auth, senha, convite ou email. Pré-voo somente leitura antes; divergência cancela.
- Expiração de convite é idempotente e também é considerada na leitura (convite vencido nunca aparece como pendente, mesmo com job atrasado).

---

### Task 1: Migration de schema — eixos de estado, recovery_email e tabelas novas

**Files:**
- Create: `supabase/migrations/178_portal_provisioning_schema.sql`

- [x] **Step 1: Escrever a migration**

```sql
-- 178: Provisionamento do Portal do Cliente — máquina de estados e suporte a convites.
-- Referência: issue #370 (mapa) e CONTEXT.md (Portal do Cliente).
-- password_hash torna-se legado nullable: a senha passa a viver somente no Supabase Auth.

-- ============================================================
-- 1. Eixos de estado + Email de Recuperação no registro de Portal
-- ============================================================
ALTER TABLE public.customer_portal_accounts
  ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE public.customer_portal_accounts
  ADD COLUMN IF NOT EXISTS provisioning_decision TEXT NOT NULL DEFAULT 'aguardando_analise'
    CHECK (provisioning_decision IN
      ('aguardando_analise', 'aprovado_para_provisionar', 'provisionamento_nao_necessario')),
  ADD COLUMN IF NOT EXISTS account_situation TEXT NOT NULL DEFAULT 'sem_conta'
    CHECK (account_situation IN
      ('sem_conta', 'convite_pendente', 'convite_expirado', 'falha_no_envio', 'ativo', 'suspenso')),
  ADD COLUMN IF NOT EXISTS recovery_email TEXT,
  ADD COLUMN IF NOT EXISTS recovery_email_source TEXT
    CHECK (recovery_email_source IN ('candidato', 'informado_manualmente'));

COMMENT ON COLUMN public.customer_portal_accounts.recovery_email IS
  'Email de Recuperação do Portal: separado da identidade Auth, não único entre CNPJs.';

-- recovery_email NÃO é UNIQUE (decisão: email compartilhado entre CNPJs é permitido).
CREATE INDEX IF NOT EXISTS idx_portal_accounts_recovery_email
  ON public.customer_portal_accounts (lower(recovery_email))
  WHERE recovery_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_portal_accounts_situation
  ON public.customer_portal_accounts (account_situation, provisioning_decision);

-- ============================================================
-- 2. Convites (somente hash do token; valor bruto nunca é persistido)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.portal_invites (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES public.customer_portal_accounts(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('convite', 'recuperacao')),
  token_hash TEXT NOT NULL UNIQUE,
  sent_to_email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'consumido', 'expirado', 'cancelado', 'invalidado_por_reenvio')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ,
  cancelled_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_portal_invites_account_pending
  ON public.portal_invites (account_id, expires_at)
  WHERE status = 'pendente';

-- ============================================================
-- 3. Tentativas de email transacional (idempotência + entrega)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.portal_email_attempts (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT REFERENCES public.customer_portal_accounts(id) ON DELETE SET NULL,
  invite_id BIGINT REFERENCES public.portal_invites(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN
    ('convite', 'reenvio', 'recuperacao', 'alteracao_email', 'alerta_critico', 'resumo_diario')),
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_message_id TEXT,
  recipient_masked TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aceito'
    CHECK (status IN ('aceito', 'entregue', 'bounce', 'complaint', 'falha_transitoria', 'falha_permanente')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_portal_email_attempts_updated_at ON public.portal_email_attempts;
CREATE TRIGGER set_portal_email_attempts_updated_at
BEFORE UPDATE ON public.portal_email_attempts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Eventos de webhook (deduplicação por ID do evento do provedor)
CREATE TABLE IF NOT EXISTS public.portal_email_events (
  id BIGSERIAL PRIMARY KEY,
  provider_event_id TEXT NOT NULL UNIQUE,
  attempt_id BIGINT REFERENCES public.portal_email_attempts(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supressões (bounce permanente / complaint); histórico nunca é apagado
CREATE TABLE IF NOT EXISTS public.portal_suppressed_emails (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL CHECK (reason IN ('bounce_permanente', 'complaint')),
  suppressed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. Histórico append-only do provisionamento
-- ============================================================
CREATE TABLE IF NOT EXISTS public.portal_provisioning_events (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  account_id BIGINT REFERENCES public.customer_portal_accounts(id) ON DELETE SET NULL,
  invite_id BIGINT REFERENCES public.portal_invites(id) ON DELETE SET NULL,
  previous_decision TEXT,
  new_decision TEXT,
  previous_situation TEXT,
  new_situation TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('documentacao', 'administrativo', 'cliente', 'sistema')),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_events_customer
  ON public.portal_provisioning_events (customer_id, created_at DESC);

-- Append-only: bloqueia UPDATE/DELETE mesmo para service_role via trigger.
CREATE OR REPLACE FUNCTION public.portal_events_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'portal_provisioning_events é somente inclusão';
END;
$$;

DROP TRIGGER IF EXISTS portal_events_no_update ON public.portal_provisioning_events;
CREATE TRIGGER portal_events_no_update
BEFORE UPDATE OR DELETE ON public.portal_provisioning_events
FOR EACH ROW EXECUTE FUNCTION public.portal_events_block_mutation();

-- ============================================================
-- 5. RLS: leitura para equipe interna; escrita somente via RPC/service_role
-- ============================================================
ALTER TABLE public.portal_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_email_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_email_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_suppressed_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_provisioning_events ENABLE ROW LEVEL SECURITY;

-- Mesmo helper usado nas policies internas existentes: perfil interno ativo.
-- (Verifique em 041_rls_missing_tables.sql o nome do helper vigente; se o
-- projeto usa EXISTS direto em user_profiles, replique o padrão dessas policies.)
CREATE POLICY portal_invites_internal_read ON public.portal_invites
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.active = true
  ));

CREATE POLICY portal_email_attempts_internal_read ON public.portal_email_attempts
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.active = true
  ));

CREATE POLICY portal_email_events_internal_read ON public.portal_email_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.active = true
  ));

CREATE POLICY portal_suppressed_internal_read ON public.portal_suppressed_emails
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.active = true
  ));

CREATE POLICY portal_events_internal_read ON public.portal_provisioning_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.active = true
  ));

-- Nenhuma policy de INSERT/UPDATE/DELETE para authenticated/anon:
-- escrita acontece apenas via RPC SECURITY DEFINER ou service_role.
```

- [ ] **Step 2: Validar a migration com a skill do projeto**

Siga a skill `supabase-migration` para aplicar e validar localmente (ou na
branch do Supabase). Confirme que `\d customer_portal_accounts` mostra as
colunas novas e que `UPDATE portal_provisioning_events SET reason='x'` falha
com "somente inclusão".

- [ ] **Step 3: Regenerar tipos**

`src/types/database.ts` é protegido: regenere pelo fluxo oficial da skill
`supabase-migration` (nunca edite à mão).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/178_portal_provisioning_schema.sql src/types/database.ts
git commit -m "feat(portal): schema da máquina de estados do provisionamento"
```

---

### Task 2: RPC de auditoria interna + transições básicas

**Files:**
- Create: `supabase/migrations/179_portal_provisioning_rpcs.sql`

- [x] **Step 1: Escrever a migration com o helper de evento e as transições**

```sql
-- 179: RPCs da máquina de estados do provisionamento do Portal.
-- Toda transição grava evento append-only. Papéis: administrativo e documentacao.

-- Helper interno: papel efetivo do usuário logado (compatível com papéis legados)
CREATE OR REPLACE FUNCTION public._portal_actor_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
  SELECT CASE up.role
    WHEN 'admin' THEN 'administrativo'
    WHEN 'operator' THEN 'documentacao'
    ELSE up.role
  END
  FROM public.user_profiles up
  WHERE up.id = auth.uid() AND up.active = true;
$$;

REVOKE ALL ON FUNCTION public._portal_actor_role() FROM PUBLIC, anon;

-- Helper interno: grava evento de transição
CREATE OR REPLACE FUNCTION public._portal_log_event(
  p_customer_id BIGINT,
  p_account_id BIGINT,
  p_invite_id BIGINT,
  p_prev_decision TEXT, p_new_decision TEXT,
  p_prev_situation TEXT, p_new_situation TEXT,
  p_actor_type TEXT, p_reason TEXT, p_request_id TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  INSERT INTO public.portal_provisioning_events (
    customer_id, account_id, invite_id,
    previous_decision, new_decision, previous_situation, new_situation,
    actor_type, actor_id, reason, request_id
  ) VALUES (
    p_customer_id, p_account_id, p_invite_id,
    p_prev_decision, p_new_decision, p_prev_situation, p_new_situation,
    p_actor_type, auth.uid(), p_reason, p_request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public._portal_log_event(BIGINT,BIGINT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon;

-- Exceção formal: Provisionamento não necessário no momento (exige justificativa)
CREATE OR REPLACE FUNCTION public.portal_set_exception(
  p_customer_id BIGINT,
  p_reason TEXT,
  p_request_id TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_account public.customer_portal_accounts%ROWTYPE;
BEGIN
  IF v_role NOT IN ('administrativo', 'documentacao') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_account FROM public.customer_portal_accounts
  WHERE customer_id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro de Portal não encontrado para o Cliente.' USING ERRCODE = 'P0002';
  END IF;
  IF v_account.account_situation NOT IN ('sem_conta') THEN
    RAISE EXCEPTION 'Exceção só se aplica a Cliente sem conta/convite em andamento.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.customer_portal_accounts
  SET provisioning_decision = 'provisionamento_nao_necessario'
  WHERE id = v_account.id;

  PERFORM public._portal_log_event(
    p_customer_id, v_account.id, NULL,
    v_account.provisioning_decision, 'provisionamento_nao_necessario',
    v_account.account_situation, v_account.account_situation,
    v_role, p_reason, p_request_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_set_exception(BIGINT, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.portal_set_exception(BIGINT, TEXT, TEXT) FROM anon;

-- Devolver Cliente para Aguardando análise (novo processo/cobrança ou revisão manual)
CREATE OR REPLACE FUNCTION public.portal_return_to_analysis(
  p_customer_id BIGINT,
  p_reason TEXT,
  p_actor_type TEXT DEFAULT NULL,   -- NULL = deduz do usuário logado; 'sistema' para gatilhos
  p_request_id TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_actor TEXT := COALESCE(p_actor_type, v_role);
  v_account public.customer_portal_accounts%ROWTYPE;
BEGIN
  IF v_actor <> 'sistema' AND v_role NOT IN ('administrativo', 'documentacao') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_account FROM public.customer_portal_accounts
  WHERE customer_id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro de Portal não encontrado para o Cliente.' USING ERRCODE = 'P0002';
  END IF;
  IF v_account.provisioning_decision = 'aguardando_analise' THEN
    RETURN;  -- idempotente
  END IF;

  UPDATE public.customer_portal_accounts
  SET provisioning_decision = 'aguardando_analise'
  WHERE id = v_account.id;

  PERFORM public._portal_log_event(
    p_customer_id, v_account.id, NULL,
    v_account.provisioning_decision, 'aguardando_analise',
    v_account.account_situation, v_account.account_situation,
    v_actor, p_reason, p_request_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_return_to_analysis(BIGINT, TEXT, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.portal_return_to_analysis(BIGINT, TEXT, TEXT, TEXT) FROM anon;
```

- [ ] **Step 2: Validar transições no banco local**

Com um usuário `documentacao` simulado: `SELECT portal_set_exception(<id>, 'cliente histórico sem operação');`
deve mudar a decisão e criar 1 linha em `portal_provisioning_events`.
Sem justificativa deve falhar com "Justificativa é obrigatória".
Com usuário sem perfil ativo deve falhar com `permission denied`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/179_portal_provisioning_rpcs.sql
git commit -m "feat(portal): RPCs de transição da máquina de estados"
```

---

### Task 3: Pré-voo e backfill dos 309 Clientes

**Files:**
- Create: `supabase/migrations/180_portal_backfill.sql`

- [x] **Step 1: Escrever pré-voo (somente leitura) e backfill**

```sql
-- 180: Pré-voo e backfill inicial do Portal.
-- Backfill cria registro de Portal por Cliente em Aguardando análise.
-- NÃO cria Conta, identidade Auth, senha, convite ou email (decisão do mapa #370).

CREATE OR REPLACE FUNCTION public.portal_provisioning_preflight()
RETURNS TABLE (
  total_customers BIGINT,
  existing_portal_records BIGINT,
  existing_auth_links BIGINT,
  existing_recovery_emails BIGINT,
  customers_missing_record BIGINT
) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
  SELECT
    (SELECT count(*) FROM public.customers),
    (SELECT count(*) FROM public.customer_portal_accounts),
    (SELECT count(*) FROM public.customer_portal_accounts WHERE auth_user_id IS NOT NULL),
    (SELECT count(*) FROM public.customer_portal_accounts WHERE recovery_email IS NOT NULL),
    (SELECT count(*) FROM public.customers c
      WHERE NOT EXISTS (
        SELECT 1 FROM public.customer_portal_accounts a WHERE a.customer_id = c.id));
$$;

GRANT EXECUTE ON FUNCTION public.portal_provisioning_preflight() TO authenticated;
REVOKE ALL ON FUNCTION public.portal_provisioning_preflight() FROM anon;

CREATE OR REPLACE FUNCTION public.portal_provisioning_backfill(p_request_id TEXT DEFAULT NULL)
RETURNS TABLE (created_records BIGINT) LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_created BIGINT;
BEGIN
  -- Somente Administrativo executa o backfill (decisão: pré-voo + confirmação do Administrador)
  IF v_role <> 'administrativo' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  WITH inserted AS (
    INSERT INTO public.customer_portal_accounts
      (customer_id, active, provisioning_decision, account_situation, login_cnpj)
    SELECT c.id, false, 'aguardando_analise', 'sem_conta',
           regexp_replace(c.cnpj_cpf, '\D', '', 'g')
    FROM public.customers c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.customer_portal_accounts a WHERE a.customer_id = c.id)
    RETURNING id, customer_id
  )
  INSERT INTO public.portal_provisioning_events
    (customer_id, account_id, new_decision, new_situation, actor_type, actor_id, reason, request_id)
  SELECT i.customer_id, i.id, 'aguardando_analise', 'sem_conta', 'sistema', auth.uid(),
         'Backfill inicial do Portal', p_request_id
  FROM inserted i;

  GET DIAGNOSTICS v_created = ROW_COUNT;
  RETURN QUERY SELECT v_created;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_provisioning_backfill(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.portal_provisioning_backfill(TEXT) FROM anon;
```

- [ ] **Step 2: Validar no banco local**

1. `SELECT * FROM portal_provisioning_preflight();` — retorna totais coerentes.
2. Executar backfill como administrativo — cria N registros e N eventos.
3. Executar de novo — cria 0 (idempotente).
4. Executar como documentacao — `permission denied`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/180_portal_backfill.sql
git commit -m "feat(portal): pré-voo e backfill dos clientes em aguardando análise"
```

**Nota operacional (vai para o runbook, não para o código):** a execução real
em produção segue o GO LIVE do mapa: rodar o pré-voo, comparar com o esperado
(309 Clientes, 0 contas, 0 vínculos Auth — revalidar `auth.users` na hora),
e só então rodar o backfill. Divergência cancela até confirmação do Administrador.

---

### Task 4: Expiração idempotente de convites

**Files:**
- Create: `supabase/migrations/181_portal_invite_expiry.sql`

- [x] **Step 1: Escrever job de expiração + agendamento**

```sql
-- 181: Expiração idempotente de convites vencidos.
-- Marca convites 'pendente' vencidos como 'expirado', atualiza a situação da
-- conta, grava evento e cria alerta — tudo idempotente (sem duplicar).

CREATE OR REPLACE FUNCTION public.portal_mark_expired_invites()
RETURNS TABLE (expired_count BIGINT) LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_count BIGINT := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT i.id AS invite_id, i.account_id, a.customer_id,
           a.provisioning_decision, a.account_situation
    FROM public.portal_invites i
    JOIN public.customer_portal_accounts a ON a.id = i.account_id
    WHERE i.status = 'pendente' AND i.purpose = 'convite' AND i.expires_at < now()
    FOR UPDATE OF i
  LOOP
    UPDATE public.portal_invites SET status = 'expirado' WHERE id = r.invite_id;

    UPDATE public.customer_portal_accounts
    SET account_situation = 'convite_expirado'
    WHERE id = r.account_id AND account_situation = 'convite_pendente';

    PERFORM public._portal_log_event(
      r.customer_id, r.account_id, r.invite_id,
      r.provisioning_decision, r.provisioning_decision,
      r.account_situation, 'convite_expirado',
      'sistema', 'Convite expirado após 48 horas', NULL);

    -- Alerta persistente para Documentação (deduplicado por convite)
    INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
    SELECT 'portal_convite_expirado', 'customer', r.customer_id::text,
           'Convite do Portal expirou sem ativação. Reenvio manual necessário.', 'open'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.alerts al
      WHERE al.type = 'portal_convite_expirado'
        AND al.entity_type = 'customer'
        AND al.entity_id = r.customer_id::text
        AND al.status <> 'closed');

    v_count := v_count + 1;
  END LOOP;
  RETURN QUERY SELECT v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_mark_expired_invites() FROM PUBLIC, anon, authenticated;

-- Agendamento: a cada 15 minutos via pg_cron (disponível no Supabase).
-- Se pg_cron não estiver habilitado no projeto, habilite via Dashboard
-- (Extensions) antes de aplicar; alternativa: Scheduled Edge Function.
SELECT cron.schedule(
  'portal-mark-expired-invites',
  '*/15 * * * *',
  $$SELECT public.portal_mark_expired_invites();$$
);
```

- [ ] **Step 2: Validar idempotência no banco local**

Inserir convite com `expires_at = now() - interval '1 hour'`; rodar a função
duas vezes; conferir: 1 transição, 1 evento, 1 alerta (não duplicados).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/181_portal_invite_expiry.sql
git commit -m "feat(portal): expiração idempotente de convites com alerta"
```

---

### Task 5: Serviço + hook de leitura da fila (com vencimento na leitura)

**Files:**
- Create: `src/services/portalProvisioning.ts`
- Create: `src/hooks/usePortalProvisioning.ts`
- Test: `src/services/__tests__/portalProvisioning.test.ts`

Siga a skill `react-query-pattern` para chaves de cache e invalidation.

- [x] **Step 1: Escrever o teste que fixa a regra de vencimento na leitura**

```typescript
import { describe, expect, it } from 'vitest'
import { effectiveSituation } from '../portalProvisioning'

describe('effectiveSituation', () => {
  it('rebaixa convite_pendente vencido para convite_expirado na leitura', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    expect(effectiveSituation('convite_pendente', past)).toBe('convite_expirado')
  })

  it('mantém convite_pendente dentro do prazo', () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    expect(effectiveSituation('convite_pendente', future)).toBe('convite_pendente')
  })

  it('não altera as demais situações', () => {
    expect(effectiveSituation('ativo', null)).toBe('ativo')
    expect(effectiveSituation('sem_conta', null)).toBe('sem_conta')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- portalProvisioning`
Expected: FAIL (módulo inexistente)

- [x] **Step 3: Implementar serviço**

```typescript
import { supabase } from './supabase'
import type { Database } from '../types/database'

export type ProvisioningDecision =
  | 'aguardando_analise' | 'aprovado_para_provisionar' | 'provisionamento_nao_necessario'
export type AccountSituation =
  | 'sem_conta' | 'convite_pendente' | 'convite_expirado' | 'falha_no_envio' | 'ativo' | 'suspenso'

export type PortalProvisioningRow = {
  account_id: number
  customer_id: number
  customer_name: string
  cnpj_cpf: string
  provisioning_decision: ProvisioningDecision
  account_situation: AccountSituation
  recovery_email: string | null
  recovery_email_source: 'candidato' | 'informado_manualmente' | null
  pending_invite_expires_at: string | null
}

// Decisão do mapa: a leitura considera o vencimento para nunca exibir
// convite pendente após o prazo, mesmo se o job periódico atrasar.
export function effectiveSituation(
  situation: AccountSituation,
  pendingInviteExpiresAt: string | null,
): AccountSituation {
  if (situation === 'convite_pendente' && pendingInviteExpiresAt
      && new Date(pendingInviteExpiresAt).getTime() < Date.now()) {
    return 'convite_expirado'
  }
  return situation
}

export async function listPortalProvisioning(): Promise<PortalProvisioningRow[]> {
  const { data, error } = await supabase
    .from('customer_portal_accounts')
    .select(`
      id, customer_id, provisioning_decision, account_situation,
      recovery_email, recovery_email_source,
      customers ( name, cnpj_cpf ),
      portal_invites ( expires_at, status, purpose )
    `)
    .order('customer_id')
  if (error) throw error

  return (data ?? []).map((row) => {
    const pending = (row.portal_invites ?? []).find(
      (i) => i.status === 'pendente' && i.purpose === 'convite',
    )
    const situation = effectiveSituation(
      row.account_situation as AccountSituation,
      pending?.expires_at ?? null,
    )
    return {
      account_id: row.id,
      customer_id: row.customer_id,
      customer_name: row.customers?.name ?? '',
      cnpj_cpf: row.customers?.cnpj_cpf ?? '',
      provisioning_decision: row.provisioning_decision as ProvisioningDecision,
      account_situation: situation,
      recovery_email: row.recovery_email,
      recovery_email_source: row.recovery_email_source,
      pending_invite_expires_at: pending?.expires_at ?? null,
    }
  })
}

export async function runPreflight() {
  const { data, error } = await supabase.rpc('portal_provisioning_preflight')
  if (error) throw error
  return data
}

export async function runBackfill(requestId: string) {
  const { data, error } = await supabase.rpc('portal_provisioning_backfill', {
    p_request_id: requestId,
  })
  if (error) throw error
  return data
}

export async function setProvisioningException(customerId: number, reason: string) {
  const { error } = await supabase.rpc('portal_set_exception', {
    p_customer_id: customerId,
    p_reason: reason,
  })
  if (error) throw error
}

export async function returnToAnalysis(customerId: number, reason: string) {
  const { error } = await supabase.rpc('portal_return_to_analysis', {
    p_customer_id: customerId,
    p_reason: reason,
  })
  if (error) throw error
}
```

Ajuste os nomes dos RPCs no client tipado conforme os tipos regenerados na
Task 1; se o select aninhado divergir do schema real, alinhe com o padrão dos
serviços existentes (`src/services/customers.ts`).

- [x] **Step 4: Implementar hook**

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  listPortalProvisioning, returnToAnalysis, setProvisioningException,
} from '../services/portalProvisioning'

const KEY = ['portal-provisioning'] as const

export function usePortalProvisioning() {
  return useQuery({ queryKey: KEY, queryFn: listPortalProvisioning })
}

export function useSetProvisioningException() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ customerId, reason }: { customerId: number; reason: string }) =>
      setProvisioningException(customerId, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useReturnToAnalysis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ customerId, reason }: { customerId: number; reason: string }) =>
      returnToAnalysis(customerId, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
```

- [x] **Step 5: Rodar testes e lint**

Run: `npm test -- portalProvisioning && npm run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/portalProvisioning.ts src/hooks/usePortalProvisioning.ts src/services/__tests__/portalProvisioning.test.ts
git commit -m "feat(portal): serviço e hook do provisionamento com vencimento na leitura"
```

---

### Task 6: Documentação viva

**Files:**
- Modify: `docs/ARCHITECTURE.md` (seção Portal: novas tabelas e RPCs)
- Modify: `docs/RASTREABILIDADE.md` (novas entradas serviço/hook/RPC)
- Modify: `docs/modules/portal-cliente.md` (máquina de estados)

- [x] **Step 1: Atualizar os três documentos** descrevendo: os dois eixos de
estado, `recovery_email` separado da identidade Auth, tabelas novas
(`portal_invites`, `portal_email_attempts`, `portal_email_events`,
`portal_suppressed_emails`, `portal_provisioning_events`), RPCs criados e o
job de expiração. Seguir `docs/CONVENCOES.md`.

- [x] **Step 2: Verificar**

Run: `npm run docs:check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md docs/RASTREABILIDADE.md docs/modules/portal-cliente.md
git commit -m "docs(portal): máquina de estados e schema do provisionamento"
```
