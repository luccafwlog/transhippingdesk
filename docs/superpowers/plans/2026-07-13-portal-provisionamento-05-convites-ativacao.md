# Plano 5 — Convites, ativação, recuperação e ciclo da conta

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o ciclo completo: enviar/reenviar/cancelar convite, tela de ativação que consome o token atomicamente e cria a Conta de Portal, recuperação de senha por token de 1 hora, suspensão/reativação — aposentando o fluxo legado em que o operador conhecia a senha.

**Architecture:** Edge Functions com `service_role`: `portal-invite-send` (aprovar+enviar na mesma operação), `portal-invite-activate` (validar sem consumir na abertura; consumir atomicamente no envio da senha), `portal-password-recovery` + `portal-password-reset`, `portal-account-suspend`. Cancelamento é RPC (não envia email). Tokens: 32 bytes aleatórios, só o hash SHA-256 persiste (tabela `portal_invites` do plano 1). Identidade técnica: email aleatório opaco criado na ativação. Emails via módulo do plano 4.

**Tech Stack:** Deno/Edge Functions, supabase-js v2 (Auth Admin API), React.

**Leitura obrigatória:** issue #370 seções "Convite e ciclo da conta", "Convites e recuperação — decisão desta frente", "Recuperação de senha"; `CONTEXT.md` ("Convite do Portal", "Token de Convite do Portal", "Email de Recuperação de Senha do Portal"); planos 1, 3 e 4 (tabelas, `maskCnpj`, `sendPortalEmail`).

**Regras que este plano implementa (não desviar):**
- Abrir o link NÃO consome o token (scanners não inutilizam o convite); o consumo é atômico no envio de senha válida (mínimo 8 caracteres) com ativação concluída.
- Reenvio invalida o token anterior ANTES de criar o novo; validade reinicia em 48h; exige nova confirmação do email e do alerta de autorização.
- Conta só fica `ativo` depois que o cliente define a senha; sem login automático após ativação.
- Nenhum operador define, vê ou transmite a senha final.
- Link inválido/expirado/consumido não revela dados; orienta pedir novo convite.
- Recuperação: link de uso único, 1 hora; nova senha revoga todas as sessões.
- Cancelamento: invalida token, tentativa `cancelado`, situação → `sem_conta`, decisão → `aguardando_analise`.
- Suspensão revoga sessões e bloqueia login preservando dados; reativação = revisão do email + novo convite + nova senha.

---

### Task 1: Utilitário de token (gerar/hashear) compartilhado

**Files:**
- Create: `supabase/functions/_shared/portalToken.ts`

- [x] **Step 1: Implementar**

```typescript
// Token de Convite do Portal: aleatório, opaco, de uso único.
// O valor bruto existe apenas no link enviado; o banco guarda só o hash.

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64url(bytes)
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/portalToken.ts
git commit -m "feat(portal): geração e hash de token de convite"
```

---

### Task 2: Edge Function `portal-invite-send` (aprovar + enviar na mesma operação)

**Files:**
- Create: `supabase/functions/portal-invite-send/index.ts`

- [x] **Step 1: Implementar**

Contrato: `POST { customer_id, recovery_email, recovery_email_source, reason? }`,
Authorization = JWT do usuário interno.

Fluxo obrigatório (cada item vira código; a ordem importa):

```typescript
// 1. Autorização: extrair auth.uid() do JWT e validar papel via RPC
//    _portal_actor_role() (plano 1); somente documentacao/administrativo.
// 2. Validar recovery_email (formato) e verificar supressão em
//    portal_suppressed_emails → se suprimido, recusar com erro claro
//    (exige outro endereço).
// 3. Carregar customer + registro de portal (FOR UPDATE via RPC ou
//    transação): situação deve permitir convite:
//    - envio: sem_conta / convite_expirado / falha_no_envio
//    - reenvio: convite_pendente / convite_expirado / falha_no_envio
//    - conta 'ativo' NUNCA recebe convite (usar recuperação de senha).
// 4. Invalidar convites pendentes anteriores:
//    UPDATE portal_invites SET status='invalidado_por_reenvio'
//    WHERE account_id=? AND status='pendente'.
// 5. Gravar recovery_email + recovery_email_source no registro.
// 6. Gerar token (generateToken), persistir SÓ o hash com expires_at=now()+48h,
//    purpose='convite', created_by=uid.
// 7. Montar activationUrl = `${PORTAL_URL}/portal/ativar?token=${token}` —
//    o token bruto não é logado nem devolvido na resposta.
// 8. Enviar via sendPortalEmail (kind 'convite' ou 'reenvio' conforme o caso,
//    template do plano 4, idempotencyKey `convite:${inviteId}`).
// 9. Transições + evento (_portal_log_event):
//    - decisão → 'aprovado_para_provisionar' (o clique auditado É a aprovação)
//    - envio aceito → situação 'convite_pendente'
//    - envio falhou → situação 'falha_no_envio' + alerta 'portal_falha_envio'
//      (decisão permanece aprovada — decisão do mapa).
// 10. Resposta: { situation, invite_id } — sem token, sem email técnico.
```

Escreva a função completa seguindo o estilo de `portal-login` (plano 3):
mesma validação de CORS, mesmos helpers `json()`. Para obter o papel do
chamador: crie o client com o JWT recebido
(`createClient(url, anonKey, { global: { headers: { Authorization } } })`)
e chame `.rpc('_portal_actor_role')`... **atenção**: helpers `_portal_*` tiveram
EXECUTE revogado de `authenticated` no plano 1 — crie na execução uma migration
`18x` expondo um RPC público mínimo `portal_current_role()` (SECURITY DEFINER,
GRANT a `authenticated`) que devolve o papel efetivo, e use-o aqui e nas demais
functions deste plano.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/portal-invite-send/ supabase/migrations/
git commit -m "feat(portal): envio e reenvio de convite com aprovação auditada"
```

---

### Task 3: Edge Function `portal-invite-activate` (validar sem consumir; consumir atômico)

**Files:**
- Create: `supabase/functions/portal-invite-activate/index.ts`

- [x] **Step 1: Implementar as duas operações**

```typescript
// Edge Function: portal-invite-activate
// POST { action: 'inspect', token }  → valida SEM consumir (abertura da tela).
//   Retorna { company_name, cnpj_masked } se válido; erro genérico caso contrário.
// POST { action: 'activate', token, password } → consumo atômico + ativação.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PORTAL_TECH_EMAIL_DOMAIN

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { hashToken } from '../_shared/portalToken.ts'

const GENERIC_INVALID = 'Link inválido ou expirado. Solicite um novo convite à empresa.'
const PASSWORD_MIN = 8

Deno.serve(async (req) => {
  // ... CORS/method boilerplate igual a portal-login ...
  const { action, token, password } = await req.json().catch(() => ({}))
  if (typeof token !== 'string' || !token) return jsonError(400, GENERIC_INVALID)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const tokenHash = await hashToken(token)

  // Busca convite válido: hash + finalidade + vencimento + não consumido.
  const { data: invite } = await admin
    .from('portal_invites')
    .select('id, account_id, status, expires_at, sent_to_email')
    .eq('token_hash', tokenHash)
    .eq('purpose', 'convite')
    .maybeSingle()

  const valid = invite && invite.status === 'pendente'
    && new Date(invite.expires_at).getTime() > Date.now()

  if (action === 'inspect') {
    if (!valid) return jsonError(410, GENERIC_INVALID)
    const { data: acc } = await admin
      .from('customer_portal_accounts')
      .select('login_cnpj, customers(name)')
      .eq('id', invite.account_id)
      .single()
    return jsonOk({ company_name: acc.customers.name, cnpj_masked: maskCnpj(acc.login_cnpj) })
  }

  if (action !== 'activate') return jsonError(400, GENERIC_INVALID)
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
    return jsonError(422, `A senha deve ter pelo menos ${PASSWORD_MIN} caracteres.`)
  }
  if (!valid) return jsonError(410, GENERIC_INVALID)

  // CONSUMO ATÔMICO: só uma requisição vence a corrida.
  const { data: consumed } = await admin
    .from('portal_invites')
    .update({ status: 'consumido', consumed_at: new Date().toISOString() })
    .eq('id', invite.id)
    .eq('status', 'pendente')          // guarda contra replay/corrida
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle()
  if (!consumed) return jsonError(410, GENERIC_INVALID)

  // Identidade técnica: aleatória, opaca, invisível ao cliente.
  const technicalEmail = `p-${crypto.randomUUID()}@${Deno.env.get('PORTAL_TECH_EMAIL_DOMAIN') ?? 'portal-interno.transhipping.invalid'}`
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: technicalEmail,
    password,
    email_confirm: true,
  })
  if (createError || !created.user) {
    // Falha após consumo: reverter o consumo para permitir nova tentativa.
    await admin.from('portal_invites')
      .update({ status: 'pendente', consumed_at: null })
      .eq('id', invite.id)
    return jsonError(500, 'Não foi possível ativar. Tente novamente.')
  }

  const { data: account } = await admin
    .from('customer_portal_accounts')
    .update({ auth_user_id: created.user.id, active: true, account_situation: 'ativo' })
    .eq('id', invite.account_id)
    .select('customer_id, provisioning_decision, account_situation')
    .single()

  // Evento (ator: cliente) + encerramento da pendência geral de prontidão.
  await admin.rpc('_portal_log_event', { /* customer_id, account_id, invite_id,
    decisão inalterada, situação convite_pendente → ativo, actor 'cliente',
    reason 'Ativação concluída pelo cliente' */ })
  await admin.from('alerts')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .in('type', ['portal_pendencia_geral', 'portal_convite_expirado'])
    .eq('entity_type', 'customer')
    .eq('entity_id', String(account.customer_id))
    .neq('status', 'closed')

  // Sem login automático: o cliente autentica com CNPJ + a senha criada.
  return jsonOk({ activated: true })
})
```

Complete os helpers `jsonOk`/`jsonError`/CORS e a chamada real de
`_portal_log_event` (via service_role o REVOKE não se aplica) na execução.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/portal-invite-activate/
git commit -m "feat(portal): ativação com consumo atômico de token"
```

---

### Task 4: Cancelamento (RPC) e suspensão (Edge Function)

**Files:**
- Create: `supabase/migrations/184_portal_invite_cancel_suspend.sql`
- Create: `supabase/functions/portal-account-suspend/index.ts`

- [x] **Step 1: RPC de cancelamento**

```sql
-- 184: Cancelamento de convite pendente (com justificativa) e suporte à suspensão.
CREATE OR REPLACE FUNCTION public.portal_cancel_invite(
  p_customer_id BIGINT, p_reason TEXT, p_request_id TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_account public.customer_portal_accounts%ROWTYPE;
  v_invite_id BIGINT;
BEGIN
  IF v_role NOT IN ('administrativo', 'documentacao') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_account FROM public.customer_portal_accounts
  WHERE customer_id = p_customer_id FOR UPDATE;

  UPDATE public.portal_invites
  SET status = 'cancelado', cancelled_reason = p_reason
  WHERE account_id = v_account.id AND status = 'pendente'
  RETURNING id INTO v_invite_id;
  IF v_invite_id IS NULL THEN
    RAISE EXCEPTION 'Não há convite pendente para cancelar.' USING ERRCODE = 'P0002';
  END IF;

  -- Decisão do mapa: situação volta a Sem conta e decisão a Aguardando análise.
  UPDATE public.customer_portal_accounts
  SET account_situation = 'sem_conta', provisioning_decision = 'aguardando_analise'
  WHERE id = v_account.id;

  PERFORM public._portal_log_event(
    p_customer_id, v_account.id, v_invite_id,
    v_account.provisioning_decision, 'aguardando_analise',
    v_account.account_situation, 'sem_conta',
    v_role, p_reason, p_request_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_cancel_invite(BIGINT, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.portal_cancel_invite(BIGINT, TEXT, TEXT) FROM anon;
```

- [x] **Step 2: Edge Function de suspensão/reativação**

`portal-account-suspend`: `POST { customer_id, action: 'suspend'|'reactivate', reason }`.
- Autorização como na Task 2 (`portal_current_role()`).
- `suspend`: situação → `suspenso`; revogar sessões do usuário Auth
  (`admin.auth.admin.signOut(...)` — confirme na execução a API vigente do
  supabase-js para invalidar as sessões de um usuário pelo id; o requisito é:
  nenhum refresh token do usuário continua válido); evento com justificativa.
  Login já fica bloqueado porque `portal-login` exige `account_situation='ativo'`.
- `reactivate`: NÃO reativa direto — situação → `sem_conta` e decisão →
  `aguardando_analise` (decisão do mapa: reativação exige revisão do email,
  novo convite e nova senha); evento com justificativa.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/184_portal_invite_cancel_suspend.sql supabase/functions/portal-account-suspend/
git commit -m "feat(portal): cancelamento de convite e suspensão de conta"
```

---

### Task 5: Recuperação de senha (token de 1 hora)

**Files:**
- Create: `supabase/functions/portal-password-recovery/index.ts`
- Create: `supabase/functions/portal-password-reset/index.ts`
- Modify: `src/pages/PortalForgotPassword.tsx`
- Modify: `src/pages/PortalResetPassword.tsx`

- [x] **Step 1: `portal-password-recovery`** — `POST { cnpj }`, SEM autenticação:

```typescript
// Sempre responde 200 com a MESMA mensagem, exista ou não a conta
// (anti-enumeração). Se a conta existir, estiver 'ativo' e tiver
// recovery_email não suprimido:
//   - invalida tokens 'recuperacao' pendentes do account
//   - cria portal_invites purpose='recuperacao', expires_at = now()+1h
//   - envia recoveryTemplate via sendPortalEmail (kind 'recuperacao',
//     idempotencyKey `recuperacao:${inviteId}`)
// Aplica o mesmo rate limit por CNPJ do portal-login.
```

- [x] **Step 2: `portal-password-reset`** — `POST { token, password }`:

Mesma mecânica de consumo atômico da Task 3 (purpose `'recuperacao'`,
validade 1h). Após consumir: `admin.auth.admin.updateUserById(auth_user_id,
{ password })`, revogar TODAS as sessões anteriores (mesma API da Task 4),
evento (ator `cliente`). Não retorna sessão; o cliente faz login de novo.

- [x] **Step 3: Frontend** — `PortalForgotPassword.tsx` passa a pedir SOMENTE
CNPJ e chamar `portal-password-recovery` (remove o uso de
`portal_resolve_login` e `resetPasswordForEmail`). `PortalResetPassword.tsx`
lê `?token=` e chama `portal-password-reset`. Mensagens não enumeráveis.

- [x] **Step 4: Rodar suíte e commit**

Run: `npm test && npm run lint`
Expected: PASS (atualize testes que fixavam o fluxo antigo)

```bash
git add supabase/functions/portal-password-recovery/ supabase/functions/portal-password-reset/ src/pages/PortalForgotPassword.tsx src/pages/PortalResetPassword.tsx
git commit -m "feat(portal): recuperação de senha por token de uso único de 1 hora"
```

---

### Task 6: Tela de ativação

**Files:**
- Create: `src/pages/PortalAtivacao.tsx`
- Modify: `src/App.tsx` (rota `/portal/ativar`)
- Test: `src/pages/__tests__/PortalAtivacao.test.tsx`

- [ ] **Step 1: Teste de comportamento**

```typescript
// Casos (mock da Edge Function via msw ou mock do client, seguindo o padrão
// dos testes de Portal existentes):
// 1. token válido → mostra nome da empresa + CNPJ mascarado 12.***.***/0001-90
//    e formulário de senha (2 campos: senha + confirmação, mínimo 8).
// 2. token inválido/expirado → mensagem genérica com orientação de pedir
//    novo convite; nenhum dado da empresa exibido.
// 3. ativação com sucesso → tela de confirmação + botão/redirect para /portal/login;
//    NENHUM login automático.
// 4. senha < 8 → erro de validação local, sem chamada de rede.
```

- [x] **Step 2: Implementar a página**

Fluxo: no mount chama `action:'inspect'`; render conforme resposta; submit
chama `action:'activate'`; sucesso → confirmação + redirecionamento ao login.
Estilo: siga os componentes das páginas Portal existentes (`PortalLogin.tsx`).

- [ ] **Step 3: Rodar, lint, commit**

Run: `npm test -- PortalAtivacao && npm run lint`
Expected: PASS

```bash
git add src/pages/PortalAtivacao.tsx src/App.tsx src/pages/__tests__/PortalAtivacao.test.tsx
git commit -m "feat(portal): tela de ativação de convite"
```

---

### Task 7: Aposentar o fluxo legado de provisionamento

**Files:**
- Delete: `supabase/functions/provision-portal-user/` (após confirmar que nenhuma tela ativa o chama)
- Modify: telas que chamavam o fluxo legado (grep `provision-portal-user` e `upsert_customer_portal_account` em `src/`)

- [x] **Step 1: Mapear chamadores**

Run: `grep -rn "provision-portal-user\|upsert_customer_portal_account\|set_customer_portal_account_active" src/`

- [x] **Step 2: Remover a UI legada** de "criar senha do portal" (o novo fluxo
é o convite do plano 7/Console + ficha). Onde a ficha oferecia provisionamento
com senha, substituir pelo link/painel de convite. Remover a function do
diretório e registrar no runbook que ela deve ser removida do projeto Supabase
no deploy.

- [ ] **Step 3: Rodar suíte inteira e commit**

Run: `npm test && npm run lint && npm run build`
Expected: PASS

```bash
git add -A
git commit -m "feat(portal): remove fluxo legado de senha conhecida pelo operador"
```

---

### Task 8: Troca do Email de Recuperação (fluxo do cliente e assistido)

**Files:**
- Create: `supabase/functions/portal-recovery-email-change/index.ts`
- Create: `supabase/migrations/18x_portal_recovery_email_assisted.sql`
- Modify: `src/pages/PortalProfile.tsx` (fluxo do cliente autenticado)

Este fluxo é gate do piloto ("Teste de recuperação assistida e troca de email").
Regras do mapa: senha atual + confirmação do novo endereço; o endereço antigo
permanece vigente até a confirmação; aviso ao email anterior; troca assistida
por Documentação/Administrativo exige validação manual, justificativa e
auditoria; falhas deixam o cadastro inalterado; chamadas não autorizadas negadas.

- [x] **Step 1: Edge Function `portal-recovery-email-change`** (fluxo do cliente)

Contrato e fluxo (implemente com o mesmo estilo das functions anteriores):

```typescript
// POST { action: 'request', current_password, new_email }
//   Autenticado (JWT do Portal). Fluxo:
//   1. Resolver a conta pelo auth.uid() (customer_portal_accounts.auth_user_id).
//   2. Verificar current_password reautenticando via signInWithPassword no
//      email técnico (falha → erro genérico; NADA muda no cadastro).
//   3. Verificar supressão do new_email.
//   4. Criar token purpose='recuperacao'... NÃO: use purpose dedicado.
//      Adicione 'confirmacao_email' ao CHECK de portal_invites.purpose via
//      migration desta task; token de uso único, validade 48h, hash apenas.
//   5. Guardar new_email PENDENTE (coluna nova pending_recovery_email na
//      migration desta task) — recovery_email atual permanece vigente.
//   6. Enviar confirmação ao NOVO endereço (template com link de confirmação)
//      e AVISO ao endereço antigo (kind 'alteracao_email').
//
// POST { action: 'confirm', token }
//   Sem autenticação (link do email). Consumo atômico como na Task 3:
//   promove pending_recovery_email → recovery_email, limpa o pendente,
//   grava evento (ator 'cliente'), envia confirmação final.
```

- [x] **Step 2: Migration da troca assistida + colunas de apoio**

```sql
-- 18x: Troca de Email de Recuperação — apoio e fluxo assistido.
ALTER TABLE public.customer_portal_accounts
  ADD COLUMN IF NOT EXISTS pending_recovery_email TEXT;

ALTER TABLE public.portal_invites DROP CONSTRAINT IF EXISTS portal_invites_purpose_check;
ALTER TABLE public.portal_invites ADD CONSTRAINT portal_invites_purpose_check
  CHECK (purpose IN ('convite', 'recuperacao', 'confirmacao_email'));

-- Troca assistida: Documentação/Administrativo, após validação manual da
-- identidade, com justificativa obrigatória e auditoria. Não conhece senha.
CREATE OR REPLACE FUNCTION public.portal_assisted_email_change(
  p_customer_id BIGINT, p_new_email TEXT, p_reason TEXT, p_request_id TEXT DEFAULT NULL
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
  IF p_new_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Email inválido.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.portal_suppressed_emails s
             WHERE s.email = lower(p_new_email)) THEN
    RAISE EXCEPTION 'Endereço suprimido por bounce/complaint. Informe outro.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_account FROM public.customer_portal_accounts
  WHERE customer_id = p_customer_id FOR UPDATE;

  UPDATE public.customer_portal_accounts
  SET recovery_email = lower(p_new_email),
      recovery_email_source = 'informado_manualmente',
      pending_recovery_email = NULL
  WHERE id = v_account.id;

  PERFORM public._portal_log_event(
    p_customer_id, v_account.id, NULL,
    v_account.provisioning_decision, v_account.provisioning_decision,
    v_account.account_situation, v_account.account_situation,
    v_role, p_reason, p_request_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_assisted_email_change(BIGINT, TEXT, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.portal_assisted_email_change(BIGINT, TEXT, TEXT, TEXT) FROM anon;
```

Após a troca assistida, a UI (Console/ficha) envia aviso ao endereço antigo via
`sendPortalEmail` (kind `'alteracao_email'`, template do plano 4 — crie
`emailChangeNoticeTemplate` lá se ainda não existir, mesmo padrão dos demais).

- [x] **Step 3: UI** — `PortalProfile.tsx`: formulário "Alterar email de
recuperação" (senha atual + novo email + confirmação do campo); estados de
pendência ("aguardando confirmação do novo endereço"). No Console/ficha
(plano 7), ação "Trocar email assistido" com justificativa, visível para
`can('portal_provisioning')`.

- [ ] **Step 4: Rodar suíte e commit**

Run: `npm test && npm run lint`
Expected: PASS

```bash
git add supabase/functions/portal-recovery-email-change/ supabase/migrations/ src/pages/PortalProfile.tsx
git commit -m "feat(portal): troca de email de recuperação com confirmação e fluxo assistido"
```

---

### Task 9: Documentação viva

- Modify: `docs/ARCHITECTURE.md`, `docs/modules/portal-cliente.md`,
  `docs/RASTREABILIDADE.md`, `CONTEXT.md` (se algum termo ganhar nuance nova),
  `WORKFLOW.md` (env vars novas).

- [ ] **Step 1: Atualizar** fluxos de convite/ativação/recuperação/suspensão
com diagramas de sequência no módulo portal-cliente.

- [ ] **Step 2: Verificar e commitar**

Run: `npm run docs:check`
Expected: PASS

```bash
git add docs/ WORKFLOW.md CONTEXT.md
git commit -m "docs(portal): ciclo de convite e ativação"
```
