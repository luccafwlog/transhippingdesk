# Plano 3 — Login por CNPJ e identidade técnica no backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover a resolução CNPJ→identidade técnica para uma Edge Function de login, eliminar a exposição do email técnico ao navegador e restringir o login visível a CNPJ + senha (sem CPF, sem email).

**Architecture:** Nova Edge Function `portal-login` recebe CNPJ+senha, normaliza o CNPJ para 14 dígitos, aplica rate limit (5 falhas/15min bloqueiam por 15min), resolve a identidade técnica via `service_role`, autentica no Supabase Auth e devolve apenas a sessão. Toda falha (CNPJ inexistente, conta inativa, senha errada, bloqueio) responde a MESMA mensagem genérica. `portal_resolve_login` deixa de ser executável por `anon`. O frontend `PortalLogin.tsx` passa a ter campo único de CNPJ com máscara.

**Tech Stack:** Supabase Edge Functions (Deno), supabase-js v2, React.

**Leitura obrigatória:** issue #370 seção "Modelo de identidade — decisão desta frente"; `CONTEXT.md` ("Identificador de Login do Portal", "Email Técnico do Portal", "Login do Portal", "Teste anti-enumeração e abuso"); `supabase/migrations/040_portal_login_rate_limit.sql` (infra de rate limit existente — reutilizar, não duplicar); `supabase/functions/notify-invoice-issued/index.ts` (estilo de Edge Function do projeto).

**Vínculo canônico:** CNPJ → `customer_portal_accounts` → identidade técnica (`auth_user_id` / email técnico aleatório) → `auth.uid()` → Cliente. A identidade técnica é criada na ativação do convite (plano 5); este plano apenas a resolve no login.

---

### Task 1: Edge Function `portal-login`

**Files:**
- Create: `supabase/functions/portal-login/index.ts`
- Test: `supabase/functions/portal-login/index.test.ts` (unit dos helpers puros, via `deno test`, se o projeto já testa functions; caso contrário, teste os helpers espelhados em `src/lib/` com vitest — ver Task 3)

- [x] **Step 1: Implementar a função**

```typescript
// Edge Function: portal-login
//
// Login do Portal do Cliente por CNPJ + senha (issue #370).
// - Normaliza o CNPJ para 14 dígitos ANTES do rate limit e da busca.
// - Resolve a identidade técnica somente aqui; o navegador nunca a recebe.
// - Resposta genérica única para CNPJ inexistente, conta inativa, senha
//   incorreta ou bloqueio por tentativas (anti-enumeração).
//
// Env vars: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GENERIC_ERROR = 'CNPJ ou senha inválidos.'
const MAX_FAILURES = 5
const WINDOW_MINUTES = 15
const BLOCK_MINUTES = 15

export function normalizeCnpj(input: string): string | null {
  const digits = (input ?? '').replace(/\D/g, '')
  return digits.length === 14 ? digits : null
}

function json(status: number, body: unknown, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin ?? '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  })
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return json(204, null, origin)
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, origin)

  const { cnpj, password } = await req.json().catch(() => ({}))
  const normalized = normalizeCnpj(cnpj ?? '')
  if (!normalized || typeof password !== 'string' || password.length === 0) {
    return json(401, { error: GENERIC_ERROR }, origin)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Rate limit por CNPJ normalizado — reutilize a infra da migration 040
  // (portal_login_rate_limit). Verifique o nome real da função/tabela em
  // 040_portal_login_rate_limit.sql e chame-a aqui; o contrato exigido é:
  // registrar tentativa e responder se o CNPJ está bloqueado.
  const { data: blocked } = await admin.rpc('portal_login_check_rate_limit', {
    p_login: normalized,
    p_max_failures: MAX_FAILURES,
    p_window_minutes: WINDOW_MINUTES,
    p_block_minutes: BLOCK_MINUTES,
  })
  if (blocked === true) {
    return json(401, { error: GENERIC_ERROR }, origin)
  }

  // Resolve identidade técnica (nunca sai desta função)
  const { data: account } = await admin
    .from('customer_portal_accounts')
    .select('auth_user_id, account_situation')
    .eq('login_cnpj', normalized)
    .maybeSingle()

  if (!account || account.account_situation !== 'ativo' || !account.auth_user_id) {
    await admin.rpc('portal_login_register_failure', { p_login: normalized })
    return json(401, { error: GENERIC_ERROR }, origin)
  }

  const { data: user } = await admin.auth.admin.getUserById(account.auth_user_id)
  const technicalEmail = user?.user?.email
  if (!technicalEmail) {
    await admin.rpc('portal_login_register_failure', { p_login: normalized })
    return json(401, { error: GENERIC_ERROR }, origin)
  }

  // Autentica com anon key (sessão normal do Auth, isolada do app interno)
  const authClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  )
  const { data: session, error } = await authClient.auth.signInWithPassword({
    email: technicalEmail,
    password,
  })
  if (error || !session.session) {
    await admin.rpc('portal_login_register_failure', { p_login: normalized })
    return json(401, { error: GENERIC_ERROR }, origin)
  }

  await admin.rpc('portal_login_register_success', { p_login: normalized })
  await admin
    .from('customer_portal_accounts')
    .update({ last_login_at: new Date().toISOString() })
    .eq('login_cnpj', normalized)

  // Devolve SOMENTE a sessão: sem email técnico, sem email de recuperação.
  return json(200, {
    access_token: session.session.access_token,
    refresh_token: session.session.refresh_token,
    expires_at: session.session.expires_at,
  }, origin)
})
```

Ajustes obrigatórios durante a execução:
1. Confirme os nomes reais das funções de rate limit em
   `040_portal_login_rate_limit.sql`. Se a infra existente contar por email e
   não por login normalizado, crie migration `18x_portal_login_rate_limit_cnpj.sql`
   adaptando-a (mesma semântica: 5 falhas/15min → bloqueio 15min; abuso
   recorrente gera alerta `portal_abuso_login` na tabela `alerts` para o
   Administrativo).
2. CORS: restrinja `Access-Control-Allow-Origin` aos domínios do Portal
   (Firebase `transhippingdesk.web.app` + localhost), seguindo o padrão das
   functions existentes.

- [x] **Step 2: Commit**

```bash
git add supabase/functions/portal-login/
git commit -m "feat(portal): edge function de login por CNPJ com resposta genérica"
```

---

### Task 2: Fechar a resolução no cliente (`portal_resolve_login`)

**Files:**
- Create: `supabase/migrations/182_portal_login_lockdown.sql`

- [x] **Step 1: Escrever a migration**

```sql
-- 182: Login do Portal passa a ser exclusivo da Edge Function portal-login.
-- portal_resolve_login deixa de ser executável por anon/authenticated:
-- o navegador não pode mais resolver CNPJ→email técnico (anti-enumeração,
-- decisão do issue #370; corrige o achado F-03 do audit 2026-06-25).

REVOKE EXECUTE ON FUNCTION public.portal_resolve_login(TEXT) FROM anon, authenticated, PUBLIC;

-- A função permanece para uso interno via service_role até a remoção completa
-- do fluxo legado (não dropar aqui: PortalForgotPassword ainda a referencia
-- até o plano 5 substituir o fluxo de recuperação).
```

- [ ] **Step 2: Validar**

No banco local: `SELECT portal_resolve_login('...')` como `anon` deve falhar
com `permission denied`.

- [x] **Step 3: Commit**

```bash
git add supabase/migrations/182_portal_login_lockdown.sql
git commit -m "feat(portal): revoga resolução de login no cliente (anti-enumeração)"
```

---

### Task 3: Frontend — login somente CNPJ

**Files:**
- Modify: `src/pages/PortalLogin.tsx`
- Modify: `src/hooks/usePortalAuth.tsx` (novo método de login via Edge Function)
- Create: `src/lib/cnpj.ts` (normalização/máscara compartilhada)
- Test: `src/lib/__tests__/cnpj.test.ts`

- [x] **Step 1: Teste dos helpers de CNPJ**

```typescript
import { describe, expect, it } from 'vitest'
import { normalizeCnpj, maskCnpj } from '../cnpj'

describe('normalizeCnpj', () => {
  it('aceita com e sem máscara', () => {
    expect(normalizeCnpj('12.345.678/0001-90')).toBe('12345678000190')
    expect(normalizeCnpj('12345678000190')).toBe('12345678000190')
  })
  it('rejeita tamanhos errados (inclusive CPF)', () => {
    expect(normalizeCnpj('12345678901')).toBeNull()
    expect(normalizeCnpj('')).toBeNull()
  })
})

describe('maskCnpj (exibição parcial: 2 primeiros dígitos + filial + DV)', () => {
  it('mascara conforme CONTEXT.md', () => {
    expect(maskCnpj('12345678000190')).toBe('12.***.***/0001-90')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- cnpj`
Expected: FAIL (módulo inexistente)

- [x] **Step 3: Implementar `src/lib/cnpj.ts`**

```typescript
export function normalizeCnpj(input: string): string | null {
  const digits = (input ?? '').replace(/\D/g, '')
  return digits.length === 14 ? digits : null
}

// Formato decidido no mapa: 12.***.***/0001-90 — preserva os dois primeiros
// dígitos, a filial e os dígitos verificadores.
export function maskCnpj(cnpj14: string): string {
  const d = cnpj14.replace(/\D/g, '')
  if (d.length !== 14) return cnpj14
  return `${d.slice(0, 2)}.***.***/${d.slice(8, 12)}-${d.slice(12)}`
}
```

- [x] **Step 4: Rodar e ver passar**

Run: `npm test -- cnpj`
Expected: PASS

- [x] **Step 5: Trocar o fluxo de login do Portal**

Em `usePortalAuth.tsx`, substitua a resolução via `portal_resolve_login` +
`signInWithPassword` por chamada à Edge Function e `setSession`:

```typescript
import { supabasePortal } from '../services/supabasePortal' // client isolado existente
import { normalizeCnpj } from '../lib/cnpj'

async function signInWithCnpj(cnpj: string, password: string): Promise<void> {
  const normalized = normalizeCnpj(cnpj)
  if (!normalized) throw new Error('CNPJ ou senha inválidos.')

  const { data, error } = await supabasePortal.functions.invoke('portal-login', {
    body: { cnpj: normalized, password },
  })
  if (error || !data?.access_token) throw new Error('CNPJ ou senha inválidos.')

  const { error: sessionError } = await supabasePortal.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  })
  if (sessionError) throw new Error('CNPJ ou senha inválidos.')
}
```

Confirme o nome real do client isolado do Portal (procure `supabasePortal` em
`src/services/`); reutilize-o — não crie outro client.

Em `PortalLogin.tsx`:
- campo único "CNPJ" com máscara de digitação (aceita colar com ou sem máscara);
- remover qualquer menção a email/CPF no label, placeholder e texto de ajuda;
- erro sempre com a mensagem genérica retornada.

- [x] **Step 6: Rodar suíte, lint e build**

Run: `npm test && npm run lint && npm run build`
Expected: PASS. Testes existentes de `PortalLogin`/`usePortalAuth` que fixavam
login por email/CPF devem ser atualizados: o comportamento mudou por decisão
do issue #370 (login visível somente CNPJ + senha).

- [x] **Step 7: Commit**

```bash
git add src/pages/PortalLogin.tsx src/hooks/usePortalAuth.tsx src/lib/cnpj.ts src/lib/__tests__/cnpj.test.ts
git commit -m "feat(portal): login exclusivo por CNPJ via edge function"
```

---

### Task 4: Proteção do CNPJ após convite/conta

**Files:**
- Create: `supabase/migrations/18x_portal_cnpj_protection.sql` (numere na sequência real do momento da execução)

- [x] **Step 1: Escrever a migration**

Decisão do mapa (Modelo de identidade): antes de existir convite ou conta, a
correção cadastral de CNPJ segue o fluxo normal; DEPOIS, o CNPJ fica protegido
contra edição comum e importação, e a alteração exige Administrativo com
justificativa, auditoria e revogação de sessões.

```sql
-- 18x: Proteção do CNPJ de Cliente com convite pendente ou Conta de Portal.
CREATE OR REPLACE FUNCTION public.portal_protect_customer_cnpj()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF NEW.cnpj_cpf IS DISTINCT FROM OLD.cnpj_cpf THEN
    IF EXISTS (
      SELECT 1 FROM public.customer_portal_accounts a
      WHERE a.customer_id = OLD.id
        AND (a.account_situation <> 'sem_conta'
             OR EXISTS (SELECT 1 FROM public.portal_invites i
                        WHERE i.account_id = a.id AND i.status = 'pendente'))
    ) THEN
      RAISE EXCEPTION
        'CNPJ protegido: Cliente possui convite ou Conta de Portal. Use a alteração administrativa auditada.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portal_protect_customer_cnpj ON public.customers;
CREATE TRIGGER trg_portal_protect_customer_cnpj
BEFORE UPDATE OF cnpj_cpf ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.portal_protect_customer_cnpj();

-- Alteração administrativa auditada: somente Administrativo; valida o novo
-- CNPJ (14 dígitos), exige justificativa, revoga o login antigo e registra evento.
CREATE OR REPLACE FUNCTION public.portal_admin_change_cnpj(
  p_customer_id BIGINT, p_new_cnpj TEXT, p_reason TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_normalized TEXT := regexp_replace(p_new_cnpj, '\D', '', 'g');
  v_account public.customer_portal_accounts%ROWTYPE;
BEGIN
  IF v_role <> 'administrativo' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  IF length(v_normalized) <> 14 THEN
    RAISE EXCEPTION 'CNPJ inválido.' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_account FROM public.customer_portal_accounts
  WHERE customer_id = p_customer_id FOR UPDATE;

  -- Desabilita o trigger de proteção dentro desta função controlada.
  SET LOCAL session_replication_role = replica;
  UPDATE public.customers SET cnpj_cpf = v_normalized WHERE id = p_customer_id;
  SET LOCAL session_replication_role = origin;

  -- O CNPJ antigo deixa de autenticar imediatamente.
  UPDATE public.customer_portal_accounts
  SET login_cnpj = v_normalized WHERE id = v_account.id;

  PERFORM public._portal_log_event(
    p_customer_id, v_account.id, NULL,
    v_account.provisioning_decision, v_account.provisioning_decision,
    v_account.account_situation, v_account.account_situation,
    'administrativo', p_reason, NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_admin_change_cnpj(BIGINT, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.portal_admin_change_cnpj(BIGINT, TEXT, TEXT) FROM anon;
```

Nota de execução: a revogação das sessões Auth do usuário (exigida pelo mapa)
não é possível em SQL puro — exponha a ação administrativa na UI através de uma
chamada que, após o RPC, invoque a mesma revogação de sessões usada em
`portal-account-suspend` (plano 5). Se a mudança representar OUTRA empresa,
a orientação operacional (runbook/ficha) é criar novo Cliente/Portal, nunca
reaproveitar a conta — deixe isso no texto de ajuda da UI administrativa.
Verifique também se `session_replication_role` é permitido no Supabase para o
owner da função; alternativa: variável de contexto (`set_config('portal.allow_cnpj_change', ...)`)
checada pelo trigger.

- [ ] **Step 2: Validar no banco local**

1. UPDATE direto de `cnpj_cpf` de cliente com convite pendente → erro "CNPJ protegido".
2. `portal_admin_change_cnpj` como administrativo com justificativa → muda cadastro e `login_cnpj`, grava evento.
3. Como documentacao → `permission denied`.

- [x] **Step 3: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(portal): proteção e alteração auditada de CNPJ"
```

---

### Task 5: Documentação viva

**Files:**
- Modify: `docs/ARCHITECTURE.md` (fluxo de login: Edge Function, não mais RPC anon)
- Modify: `docs/modules/portal-cliente.md` (diagrama de sequência do login)
- Modify: `WORKFLOW.md` (linha 73 menciona `portal_resolve_login` antes de `signInWithPassword` — atualizar)
- Modify: `docs/CHANGELOG.md` (entrada: login por email/CPF removido, supera o comportamento anterior)

- [x] **Step 1: Atualizar os quatro documentos.** O login por email registrado
no CHANGELOG é comportamento superado — registre a superação sem apagar o
histórico (convenção `docs/CONVENCOES.md`).

- [x] **Step 2: Verificar e commitar**

Run: `npm run docs:check`
Expected: PASS

```bash
git add docs/ WORKFLOW.md
git commit -m "docs(portal): login por CNPJ via edge function"
```
