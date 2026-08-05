# Criação e gestão de usuários internos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a `/admin/usuarios` um fluxo de criação de usuários internos e de manutenção de credenciais, eliminando a dependência do dashboard do Supabase, e acrescentar à tela e-mail, último acesso, busca, confirmação de troca de setor e auditoria.

**Architecture:** A escrita privilegiada mora numa Edge Function (`admin-users`) que valida o chamador com `is_admin()` e reserva o `service_role` apenas para as operações de autenticação (`createUser`, `updateUserById`, `signOut`); toda escrita em tabela usa o cliente com o JWT do chamador, para que RLS continue sendo a autoridade e `auth.uid()` preserve o autor na auditoria. A leitura da lista passa por uma RPC `SECURITY DEFINER` (`admin_list_users`) que junta `user_profiles` a `auth.users` sem expor a tabela de autenticação. O frontend mantém a query key `['admin-users']` e o React Query já existentes.

**Tech Stack:** React 19 + TypeScript + Vite, TanStack React Query, Supabase (PostgREST, RLS, Edge Functions em Deno), Vitest + Testing Library, Tailwind com design system próprio (`app-*`).

**Spec de origem:** [`docs/spec/2026-08-05-admin-usuarios-design.md`](../spec/2026-08-05-admin-usuarios-design.md)

---

## Contexto obrigatório antes de começar

Leia, nesta ordem:

1. `docs/spec/2026-08-05-admin-usuarios-design.md` — as decisões e o que ficou fora de escopo.
2. `src/pages/AdminUsuarios.tsx` — a tela inteira (346 linhas, três abas).
3. `src/services/adminUsers.ts` — 31 linhas; é todo o serviço de hoje.
4. `supabase/functions/portal-invite-send/index.ts` — o formato de Edge Function do projeto.

**Duas travas de ferramenta.** O hook `.claude/hooks/protect-files.sh` bloqueia edições em `supabase/migrations/*` e `src/types/database.ts`. As tarefas 2 e 4 precisam de `CLAUDE_ALLOW_PROTECTED=1` **autorizado explicitamente pelo usuário** — não contorne por conta própria; pare e peça.

**Vocabulário.** Na interface o papel se chama **setor**; no banco a coluna continua `role`. Não renomeie coluna nenhuma. Os setores válidos para cadastro são os de `MANAGED_PROFILES` (`administrativo`, `financeiro`, `operacoes`, `documentacao`, `equipamentos`); `admin` e `operator` são legados e só existem em registros antigos.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `src/lib/passwordPolicy.ts` | Regra de senha pura, sem dependências | Criar |
| `src/lib/__tests__/passwordPolicy.test.ts` | Teste da regra | Criar |
| `supabase/migrations/258_admin_usuarios_gestao.sql` | RPC de listagem e trigger de auditoria | Criar (protegido) |
| `src/integration/adminUsuarios.local-pg.test.ts` | Contratos que só o banco prova | Criar |
| `supabase/functions/admin-users/index.ts` | Criação, credenciais e desativação | Criar |
| `src/services/adminUsers.ts` | Fronteira de dados da tela | Modificar |
| `src/components/admin/NovoUsuarioModal.tsx` | Formulário de criação | Criar |
| `src/components/admin/EditarAcessoModal.tsx` | Formulário de e-mail/senha | Criar |
| `src/components/admin/AlterarMinhaSenhaModal.tsx` | Troca da própria senha | Criar |
| `src/pages/AdminUsuarios.tsx` | Composição da aba Usuários | Modificar |
| `src/components/layout/AppLayout.tsx` | Ponto de entrada da troca da própria senha | Modificar |
| `src/pages/__tests__/AdminUsuarios.behavior.test.tsx` | Comportamento da tela | Modificar |

Os três modais vão para `src/components/admin/` em vez de inflar `AdminUsuarios.tsx`, que já tem 346 linhas e três abas. Cada modal é um formulário fechado, com estado próprio e um callback de conclusão.

---

### Task 1: Regra de senha compartilhada

Hoje a regra existe como texto solto dentro de `src/pages/PortalResetPassword.tsx:26` e o servidor do Portal só confere comprimento (`supabase/functions/portal-invite-activate/index.ts:24`). Extrair para um módulo puro dá um lugar único para testar e para o novo fluxo reutilizar.

**Files:**
- Create: `src/lib/passwordPolicy.ts`
- Test: `src/lib/__tests__/passwordPolicy.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest'
import { PASSWORD_RULE_MESSAGE, isValidPassword } from '../passwordPolicy'

describe('passwordPolicy', () => {
  it('aceita senha com 8+ caracteres, maiuscula, minuscula e numero', () => {
    expect(isValidPassword('Senha123')).toBe(true)
    expect(isValidPassword('umaSenhaLonga9')).toBe(true)
  })

  it('recusa senha curta demais', () => {
    expect(isValidPassword('Abc1234')).toBe(false)
  })

  it('recusa senha sem maiuscula, sem minuscula ou sem numero', () => {
    expect(isValidPassword('senha123')).toBe(false)
    expect(isValidPassword('SENHA123')).toBe(false)
    expect(isValidPassword('SenhaSemNumero')).toBe(false)
  })

  it('recusa entrada vazia', () => {
    expect(isValidPassword('')).toBe(false)
  })

  it('expoe a mensagem que a interface mostra', () => {
    expect(PASSWORD_RULE_MESSAGE).toContain('8')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/passwordPolicy.test.ts`
Expected: FAIL — `Failed to resolve import "../passwordPolicy"`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// Regra única de senha do sistema interno e do Portal.
// A Edge Function repete esta regra em Deno, que não importa o bundle do Vite —
// mesma convenção do maskEmail em supabase/functions/_shared/portalEmail.ts.
export const PASSWORD_MIN_LENGTH = 8

export const PASSWORD_RULE_MESSAGE =
  'A senha deve ter no mínimo 8 caracteres, com letra maiúscula, minúscula e número.'

export function isValidPassword(password: string): boolean {
  if (password.length < PASSWORD_MIN_LENGTH) return false
  return /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/passwordPolicy.test.ts`
Expected: PASS — 5 testes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/passwordPolicy.ts src/lib/__tests__/passwordPolicy.test.ts
git commit -m "feat: extrair regra de senha para modulo compartilhado"
```

---

### Task 2: Migration — RPC de listagem e trigger de auditoria

**Requer autorização:** `supabase/migrations/*` é protegido pelo hook. Peça ao usuário e só então rode com `CLAUDE_ALLOW_PROTECTED=1`.

**Files:**
- Create: `supabase/migrations/258_admin_usuarios_gestao.sql`
- Test: `src/integration/adminUsuarios.local-pg.test.ts`

- [ ] **Step 1: Escrever a migration**

```sql
-- Migration: administração de usuários internos (listagem e auditoria)
--
-- Intent: permitir que a tela /admin/usuarios exiba e-mail e último acesso sem
--   expor auth.users ao papel authenticated, e registrar em audit_logs toda
--   mudança de setor (role) e de status (active).
-- Affected: nova RPC public.admin_list_users; novo trigger em public.user_profiles.
-- Breaking?: não. Nenhuma tabela é alterada.
--
-- Por que o trigger, e não o frontend: mudanças de role/active saem direto por
-- PostgREST a partir da tela, então o único ponto que cobre todos os chamadores
-- (presentes e futuros) é o banco.

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  role TEXT,
  active BOOLEAN,
  created_at TIMESTAMPTZ,
  email TEXT,
  last_sign_in_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem listar usuários.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT
      p.id,
      p.full_name,
      p.role,
      p.active,
      p.created_at,
      u.email::TEXT,
      u.last_sign_in_at
    FROM public.user_profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    ORDER BY p.full_name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_user_profile_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
    VALUES ('user_profile', NEW.id::TEXT, 'role', OLD.role, NEW.role, auth.uid());
  END IF;

  IF NEW.active IS DISTINCT FROM OLD.active THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
    VALUES ('user_profile', NEW.id::TEXT, 'active', OLD.active::TEXT, NEW.active::TEXT, auth.uid());
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_user_profile_changes() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_audit_user_profile_changes ON public.user_profiles;
CREATE TRIGGER trg_audit_user_profile_changes
  AFTER UPDATE OF role, active ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_user_profile_changes();

-- Rollback:
--   drop trigger if exists trg_audit_user_profile_changes on public.user_profiles;
--   drop function if exists public.audit_user_profile_changes();
--   drop function if exists public.admin_list_users();
```

- [ ] **Step 2: Escrever o teste de integração**

```typescript
import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test'

const adminId = '40000000-0000-0000-0000-000000000001'
const memberId = '50000000-0000-0000-0000-000000000002'

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function callAs(userId: string, sql: string) {
  return spawnSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl,
    '-c', `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${userId}', true); ${sql} COMMIT;`,
  ], { encoding: 'utf8' })
}

describeLocal('migration 258 — administração de usuários internos', () => {
  beforeAll(() => {
    psql(`
      INSERT INTO auth.users (id, email) VALUES
        ('${adminId}', 'admin-258@example.test'),
        ('${memberId}', 'member-258@example.test')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${adminId}', 'Admin 258', 'administrativo', true),
        ('${memberId}', 'Membro 258', 'documentacao', true)
      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = EXCLUDED.active;
      DELETE FROM public.audit_logs WHERE entity_type = 'user_profile' AND entity_id = '${memberId}';
    `)
  })

  afterAll(() => {
    psql(`
      DELETE FROM public.audit_logs WHERE entity_type = 'user_profile' AND entity_id IN ('${adminId}', '${memberId}');
      DELETE FROM public.user_profiles WHERE id IN ('${adminId}', '${memberId}');
      DELETE FROM auth.users WHERE id IN ('${adminId}', '${memberId}');
    `)
  })

  it('admin_list_users devolve e-mail do auth.users para o admin', () => {
    const result = callAs(adminId, `SELECT email FROM public.admin_list_users() WHERE id = '${memberId}';`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('member-258@example.test')
  })

  it('admin_list_users recusa quem nao e administrador', () => {
    const result = callAs(memberId, 'SELECT count(*) FROM public.admin_list_users();')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Apenas administradores')
  })

  it('trigger registra a troca de setor com o autor da mudanca', () => {
    callAs(adminId, `UPDATE public.user_profiles SET role = 'financeiro' WHERE id = '${memberId}';`)
    const row = psql(`
      SELECT field_name || '|' || old_value || '|' || new_value || '|' || changed_by
      FROM public.audit_logs
      WHERE entity_type = 'user_profile' AND entity_id = '${memberId}' AND field_name = 'role'
      ORDER BY changed_at DESC LIMIT 1;
    `)
    expect(row).toBe(`role|documentacao|financeiro|${adminId}`)
  })

  it('trigger registra a desativacao', () => {
    callAs(adminId, `UPDATE public.user_profiles SET active = false WHERE id = '${memberId}';`)
    const row = psql(`
      SELECT old_value || '|' || new_value
      FROM public.audit_logs
      WHERE entity_type = 'user_profile' AND entity_id = '${memberId}' AND field_name = 'active'
      ORDER BY changed_at DESC LIMIT 1;
    `)
    expect(row).toBe('true|false')
  })
})
```

- [ ] **Step 3: Rodar a suíte sem o banco local, confirmando que ela é pulada e não quebra o CI**

Run: `npx vitest run src/integration/adminUsuarios.local-pg.test.ts`
Expected: PASS com os testes marcados como *skipped* (`LOCAL_PG_INTEGRATION` não definido). É o mesmo comportamento de `src/integration/agencyReportCloserName.local-pg.test.ts`.

- [ ] **Step 4: Aplicar a migration no banco local e rodar de verdade**

Run:
```bash
psql -X -v ON_ERROR_STOP=1 -d "$LOCAL_DATABASE_URL" -f supabase/migrations/258_admin_usuarios_gestao.sql
LOCAL_PG_INTEGRATION=1 npx vitest run src/integration/adminUsuarios.local-pg.test.ts
```
Expected: 4 testes PASS. Se o ambiente local de Postgres não estiver disponível, pare e registre isso no relato final — não marque o passo como feito.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/258_admin_usuarios_gestao.sql src/integration/adminUsuarios.local-pg.test.ts
git commit -m "feat(db): listagem administrativa de usuarios e auditoria de perfil"
```

---

### Task 3: Edge Function `admin-users`

**Files:**
- Create: `supabase/functions/admin-users/index.ts`

- [ ] **Step 1: Escrever a função**

Repare no ponto central: `service_role` só toca autenticação. Toda escrita em tabela usa `caller`, para que a policy de admin continue valendo e `auth.uid()` preserve o autor no trigger da Task 2.

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// Espelha src/lib/passwordPolicy.ts; Deno não importa o bundle Vite.
const PASSWORD_RULE_MESSAGE = 'A senha deve ter no mínimo 8 caracteres, com letra maiúscula, minúscula e número.'
const isValidPassword = (value: string) =>
  value.length >= 8 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value)

const MANAGED_PROFILES = ['administrativo', 'financeiro', 'operacoes', 'documentacao', 'equipamentos']
const isValidEmail = (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)

const json = (status: number, body: unknown, origin: string | null) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })

type Payload = {
  action?: 'create' | 'update_credentials' | 'deactivate'
  user_id?: string
  full_name?: string
  email?: string
  password?: string
  role?: string
}

if (typeof Deno !== 'undefined') Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return json(204, null, origin)
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, origin)

  const body = await req.json().catch(() => ({})) as Payload
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const jwt = req.headers.get('Authorization') ?? ''

  const caller = createClient(url, anon, { global: { headers: { Authorization: jwt } } })
  const { data: isAdmin } = await caller.rpc('is_admin')
  if (isAdmin !== true) return json(403, { error: 'permission denied' }, origin)

  const { data: callerUser } = await caller.auth.getUser()
  const actorId = callerUser.user?.id ?? null
  if (!actorId) return json(403, { error: 'permission denied' }, origin)

  // service_role restrito ao que exige privilégio de autenticação.
  const admin = createClient(url, service)

  const audit = (entityId: string, field: string, oldValue: string | null, newValue: string | null) =>
    caller.from('audit_logs').insert({
      entity_type: 'user_profile',
      entity_id: entityId,
      field_name: field,
      old_value: oldValue,
      new_value: newValue,
      changed_by: actorId,
    })

  if (body.action === 'create') {
    const fullName = (body.full_name ?? '').trim()
    const email = (body.email ?? '').trim().toLowerCase()
    const password = body.password ?? ''
    const role = body.role ?? ''

    if (fullName.length < 3) return json(422, { error: 'Informe o nome completo do usuário.' }, origin)
    if (!isValidEmail(email)) return json(422, { error: 'E-mail inválido.' }, origin)
    if (!isValidPassword(password)) return json(422, { error: PASSWORD_RULE_MESSAGE }, origin)
    if (!MANAGED_PROFILES.includes(role)) return json(422, { error: 'Selecione um setor válido.' }, origin)

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createError || !created.user) {
      const duplicate = String(createError?.message ?? '').toLowerCase().includes('already')
      return json(duplicate ? 409 : 500, {
        error: duplicate ? 'Já existe um usuário com este e-mail.' : 'Não foi possível criar o usuário.',
      }, origin)
    }

    const { error: profileError } = await caller.from('user_profiles').insert({
      id: created.user.id,
      full_name: fullName,
      role,
      active: true,
    })
    if (profileError) {
      // Sem a compensação sobra o órfão que o ProtectedRoute descreve:
      // autenticação existente sem perfil, e o e-mail fica inutilizável.
      await admin.auth.admin.deleteUser(created.user.id)
      return json(500, { error: 'Não foi possível criar o perfil do usuário.' }, origin)
    }

    await audit(created.user.id, 'created', null, `${fullName} (${role})`)
    return json(201, { id: created.user.id }, origin)
  }

  if (body.action === 'update_credentials') {
    const userId = body.user_id ?? ''
    if (!userId) return json(422, { error: 'Usuário não informado.' }, origin)

    const email = body.email?.trim().toLowerCase()
    const password = body.password
    if (!email && !password) return json(422, { error: 'Informe um novo e-mail ou uma nova senha.' }, origin)
    if (email && !isValidEmail(email)) return json(422, { error: 'E-mail inválido.' }, origin)
    if (password && !isValidPassword(password)) return json(422, { error: PASSWORD_RULE_MESSAGE }, origin)

    const { data: current } = await admin.auth.admin.getUserById(userId)
    const previousEmail = current.user?.email ?? null

    const updates: { email?: string; password?: string; email_confirm?: boolean } = {}
    if (email) { updates.email = email; updates.email_confirm = true }
    if (password) updates.password = password

    const { error: updateError } = await admin.auth.admin.updateUserById(userId, updates)
    if (updateError) {
      const duplicate = String(updateError.message ?? '').toLowerCase().includes('already')
      return json(duplicate ? 409 : 500, {
        error: duplicate ? 'Já existe um usuário com este e-mail.' : 'Não foi possível atualizar o acesso.',
      }, origin)
    }

    if (email && email !== previousEmail) await audit(userId, 'email', previousEmail, email)
    // A senha nunca é registrada, só o fato de ter sido trocada.
    if (password) await audit(userId, 'password', null, 'redefinida pelo administrador')
    return json(200, { ok: true }, origin)
  }

  if (body.action === 'deactivate') {
    const userId = body.user_id ?? ''
    if (!userId) return json(422, { error: 'Usuário não informado.' }, origin)
    if (userId === actorId) return json(422, { error: 'Você não pode desativar o próprio acesso.' }, origin)

    // Escrita pelo cliente do chamador: a policy de admin continua valendo e o
    // trigger de auditoria enxerga auth.uid(). Sob service_role o autor sairia nulo.
    const { error: profileError } = await caller
      .from('user_profiles')
      .update({ active: false })
      .eq('id', userId)
    if (profileError) return json(500, { error: 'Não foi possível desativar o usuário.' }, origin)

    // O flag sozinho não derruba a sessão: o token segue válido até expirar.
    const { error: signOutError } = await admin.auth.admin.signOut(userId)
    if (signOutError) console.error('admin-users: falha ao encerrar sessões', signOutError)

    return json(200, { ok: true, sessions_revoked: !signOutError }, origin)
  }

  return json(400, { error: 'Ação desconhecida.' }, origin)
})
```

- [ ] **Step 2: Conferir que o arquivo compila no Deno**

Run: `npx --yes deno@1.45 check supabase/functions/admin-users/index.ts`
Expected: sem erros. Se o Deno não estiver disponível no ambiente, pule este passo e registre isso no relato — o projeto não roda Deno no CI.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/admin-users/index.ts
git commit -m "feat(edge): criar e manter credenciais de usuarios internos"
```

---

### Task 4: Regenerar os tipos do banco

**Requer autorização:** `src/types/database.ts` é protegido pelo hook. A RPC `admin_list_users` precisa aparecer em `Database['public']['Functions']` para o `supabase.rpc('admin_list_users')` da Task 5 tipar.

- [ ] **Step 1: Pedir autorização e regenerar**

Run (com `CLAUDE_ALLOW_PROTECTED=1` autorizado):
```bash
npx supabase gen types typescript --project-id "$SUPABASE_PROJECT_ID" --schema public > src/types/database.ts
```

- [ ] **Step 2: Conferir que a RPC entrou e que nada mais mudou**

Run: `git diff --stat src/types/database.ts && grep -n "admin_list_users" src/types/database.ts`
Expected: o diff toca apenas o bloco de `Functions`; o grep encontra `admin_list_users`.

Se o diff vier com mudanças alheias (drift acumulado do banco), **pare e mostre ao usuário** antes de commitar — pode indicar migration aplicada em produção fora do repositório.

**Fallback documentado** — se a autorização não vier ou o projeto não estiver acessível, a Task 5 usa:

```typescript
// ponytail: tipos gerados não conhecem admin_list_users porque src/types/database.ts
// é protegido pelo hook e não foi regenerado. Teto: a resposta da RPC não é
// verificada pelo compilador. Upgrade: regenerar os tipos e remover o cast.
const { data, error } = await (supabase.rpc as unknown as
  (fn: string) => Promise<{ data: AdminUserRow[] | null; error: Error | null }>)('admin_list_users')
```

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "chore: regenerar tipos com admin_list_users"
```

---

### Task 5: Serviço de administração de usuários

**Files:**
- Modify: `src/services/adminUsers.ts`

- [ ] **Step 1: Reescrever o serviço**

```typescript
import { supabase } from './supabase'
import type { UserProfile, UserProfileRole } from '../types/database'

export type AdminUserRow = UserProfile & {
  email: string | null
  last_sign_in_at: string | null
}

export async function listAllUserProfiles(): Promise<AdminUserRow[]> {
  const { data, error } = await supabase.rpc('admin_list_users')
  if (error) throw error
  return (data ?? []) as AdminUserRow[]
}

export async function updateUserProfile(
  id: string,
  updates: { role?: UserProfileRole; active?: boolean },
): Promise<void> {
  const { error } = await supabase.from('user_profiles').update(updates).eq('id', id)
  if (error) throw error
}

async function invokeAdminUsers(body: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.functions.invoke('admin-users', { body })
  if (!error) return
  // Em resposta não-2xx o supabase-js devolve `data` nulo e guarda o corpo em
  // error.context (um Response). Ler dali é o que faz "Já existe um usuário com
  // este e-mail" chegar à tela em vez da mensagem genérica.
  const context = (error as { context?: Response }).context
  const parsed = context ? await context.json().catch(() => null) as { error?: string } | null : null
  throw new Error(parsed?.error ?? 'Não foi possível concluir a operação.')
}

export async function createUser(input: {
  full_name: string
  email: string
  password: string
  role: UserProfileRole
}): Promise<void> {
  await invokeAdminUsers({ action: 'create', ...input })
}

export async function updateUserCredentials(input: {
  user_id: string
  email?: string
  password?: string
}): Promise<void> {
  await invokeAdminUsers({ action: 'update_credentials', ...input })
}

// Desativar passa pela Edge Function porque encerrar a sessão exige service_role;
// reativar é só o flag e continua em updateUserProfile.
export async function deactivateUser(userId: string): Promise<void> {
  await invokeAdminUsers({ action: 'deactivate', user_id: userId })
}

export const PROFILE_LABELS: Record<UserProfileRole, string> = {
  admin: 'Admin (legado)',
  operator: 'Operador (legado)',
  administrativo: 'Administrativo',
  financeiro: 'Financeiro',
  operacoes: 'Operações',
  documentacao: 'Documentação',
  equipamentos: 'Equipamentos',
}

export const MANAGED_PROFILES: UserProfileRole[] = ['administrativo', 'financeiro', 'operacoes', 'documentacao', 'equipamentos']

export const PROFILE_SCOPES: Record<string, string> = {
  administrativo: 'Acesso global a todos os módulos e configurações.',
  financeiro: 'Visualização completa + edição em Taxas Locais (Tabelas/Overrides), Demurrage, Faturamento e Conciliação.',
  operacoes: 'Cadastro de Viagens, upload de manifestos e planilha IMO.',
  documentacao: 'Acesso amplo ao sistema, exceto tela Admin e configurações administrativas.',
  equipamentos: 'Leitura geral + edição restrita a Vazios (EXP) e Veículos, incluindo o sign-off das suas seções no ADR.',
}
```

`PROFILE_SCOPES` centraliza os textos que hoje estão duplicados no JSX de `AdminUsuarios.tsx:201-205`; a legenda e o diálogo de confirmação da Task 8 passam a ler da mesma fonte.

- [ ] **Step 2: Verificar tipos**

Run: `npm run typecheck`
Expected: sem erros. Se `supabase.rpc('admin_list_users')` acusar tipo desconhecido, a Task 4 não foi concluída — aplique o fallback documentado nela.

- [ ] **Step 3: Rodar a suíte da tela para ver o que quebrou**

Run: `npx vitest run src/pages/__tests__/AdminUsuarios.behavior.test.tsx`
Expected: PASS. Os testes existentes mockam `listAllUserProfiles`, então a troca de PostgREST por RPC não os afeta.

- [ ] **Step 4: Commit**

```bash
git add src/services/adminUsers.ts
git commit -m "feat: expor criacao e credenciais no servico de usuarios"
```

---

### Task 6: Modal de criação de usuário

**Files:**
- Create: `src/components/admin/NovoUsuarioModal.tsx`
- Test: `src/pages/__tests__/AdminUsuarios.behavior.test.tsx` (Task 7)

- [ ] **Step 1: Escrever o componente**

O `<select>` começa em `''` com a opção placeholder — é o que torna o setor obrigatório por construção, em vez de depender de um valor pré-selecionado que ninguém revisa.

```tsx
import { useState, type FormEvent } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Field, Input, Select } from '../ui/Input'
import { MANAGED_PROFILES, PROFILE_LABELS, PROFILE_SCOPES } from '../../services/adminUsers'
import { PASSWORD_RULE_MESSAGE, isValidPassword } from '../../lib/passwordPolicy'
import type { UserProfileRole } from '../../types/database'

export function NovoUsuarioModal({
  open,
  onClose,
  onSubmit,
  submitting,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (input: { full_name: string; email: string; password: string; role: UserProfileRole }) => void
  submitting: boolean
}) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (fullName.trim().length < 3) return setError('Informe o nome completo do usuário.')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError('E-mail inválido.')
    if (!role) return setError('Selecione o setor do usuário.')
    if (!isValidPassword(password)) return setError(PASSWORD_RULE_MESSAGE)
    if (password !== confirmation) return setError('As senhas não conferem.')
    setError('')
    onSubmit({ full_name: fullName.trim(), email: email.trim().toLowerCase(), password, role: role as UserProfileRole })
  }

  return (
    <Modal open={open} title="Novo usuário" onClose={onClose}>
      <form onSubmit={handleSubmit} className="grid gap-3">
        <Field label="Nome completo" required>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
        </Field>
        <Field label="E-mail de login" required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Setor" required>
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Selecione o setor</option>
            {MANAGED_PROFILES.map((profile) => (
              <option key={profile} value={profile}>{PROFILE_LABELS[profile]}</option>
            ))}
          </Select>
        </Field>
        {role ? <p className="text-xs text-[var(--app-muted)]">{PROFILE_SCOPES[role]}</p> : null}
        <Field label="Senha" required>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirmar senha" required>
          <Input type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        </Field>
        <p className="text-xs text-[var(--app-muted)]">{PASSWORD_RULE_MESSAGE}</p>
        {error ? <p className="app-field__error" role="alert">{error}</p> : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={submitting}>Criar usuário</Button>
        </div>
      </form>
    </Modal>
  )
}
```

- [ ] **Step 2: Escrever o modal de edição de acesso**

Mesmo arquivo-irmão, responsabilidade distinta: aqui os dois campos são opcionais, porque o administrador pode querer trocar só o e-mail ou só a senha.

Create: `src/components/admin/EditarAcessoModal.tsx`

```tsx
import { useState, type FormEvent } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { PASSWORD_RULE_MESSAGE, isValidPassword } from '../../lib/passwordPolicy'

export function EditarAcessoModal({
  open,
  userName,
  currentEmail,
  onClose,
  onSubmit,
  submitting,
}: {
  open: boolean
  userName: string
  currentEmail: string | null
  onClose: () => void
  onSubmit: (input: { email?: string; password?: string }) => void
  submitting: boolean
}) {
  const [email, setEmail] = useState(currentEmail ?? '')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = email.trim().toLowerCase()
    const emailChanged = trimmed !== (currentEmail ?? '').toLowerCase()
    if (emailChanged && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) return setError('E-mail inválido.')
    if (password && !isValidPassword(password)) return setError(PASSWORD_RULE_MESSAGE)
    if (password && password !== confirmation) return setError('As senhas não conferem.')
    if (!emailChanged && !password) return setError('Informe um novo e-mail ou uma nova senha.')
    setError('')
    onSubmit({ email: emailChanged ? trimmed : undefined, password: password || undefined })
  }

  return (
    <Modal open={open} title={`Editar acesso — ${userName}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="grid gap-3">
        <Field label="E-mail de login">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Nova senha">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Deixe em branco para manter" />
        </Field>
        <Field label="Confirmar nova senha">
          <Input type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        </Field>
        <p className="text-xs text-[var(--app-muted)]">
          Ninguém consegue consultar a senha atual: ela é guardada cifrada. Para socorrer quem esqueceu, defina uma nova aqui.
        </p>
        {error ? <p className="app-field__error" role="alert">{error}</p> : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={submitting}>Salvar</Button>
        </div>
      </form>
    </Modal>
  )
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/NovoUsuarioModal.tsx src/components/admin/EditarAcessoModal.tsx
git commit -m "feat: modais de criacao de usuario e edicao de acesso"
```

---

### Task 7: Ligar os modais à tela, com busca, e-mail e último acesso

**Files:**
- Modify: `src/pages/AdminUsuarios.tsx`
- Test: `src/pages/__tests__/AdminUsuarios.behavior.test.tsx`

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao final de `src/pages/__tests__/AdminUsuarios.behavior.test.tsx`. Antes, estenda os mocks do topo do arquivo: adicione `createUser: vi.fn()`, `updateUserCredentials: vi.fn()` e `deactivateUser: vi.fn()` ao objeto `vi.hoisted`, repasse os três no `vi.mock('../../services/adminUsers', ...)`, e acrescente `email` e `last_sign_in_at` às duas linhas de `users`:

```typescript
const users = [
  { id: 'u-1', full_name: 'Alice Operadora', role: 'operacoes', active: true, created_at: '2026-01-02T00:00:00Z', email: 'alice@fwlog.com.br', last_sign_in_at: '2026-08-01T12:00:00Z' },
  { id: 'u-2', full_name: 'Bruno Inativo', role: 'financeiro', active: false, created_at: '2026-01-03T00:00:00Z', email: 'bruno@fwlog.com.br', last_sign_in_at: null },
]
```

Os testes novos:

```typescript
it('mostra o e-mail de login de cada usuario', () => {
  render(<AdminUsuarios />)
  expect(screen.getByText('alice@fwlog.com.br')).toBeTruthy()
})

it('destaca quem nunca acessou o sistema', () => {
  render(<AdminUsuarios />)
  expect(screen.getByText('Nunca acessou')).toBeTruthy()
})

it('filtra a lista por e-mail', () => {
  render(<AdminUsuarios />)
  fireEvent.change(screen.getByPlaceholderText('Buscar por nome ou e-mail'), { target: { value: 'bruno@' } })
  expect(screen.queryByText('Alice Operadora')).toBeNull()
  expect(screen.getByText('Bruno Inativo')).toBeTruthy()
})

it('exige o setor para criar um usuario', () => {
  render(<AdminUsuarios />)
  fireEvent.click(screen.getByRole('button', { name: 'Novo usuário' }))
  fireEvent.change(screen.getByLabelText(/Nome completo/), { target: { value: 'Carla Nova' } })
  fireEvent.change(screen.getByLabelText(/E-mail de login/), { target: { value: 'carla@fwlog.com.br' } })
  fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: 'Senha123' } })
  fireEvent.change(screen.getByLabelText(/Confirmar senha/), { target: { value: 'Senha123' } })
  fireEvent.click(screen.getByRole('button', { name: 'Criar usuário' }))
  expect(screen.getByText('Selecione o setor do usuário.')).toBeTruthy()
  expect(mocks.createUser).not.toHaveBeenCalled()
})

it('recusa criacao quando a confirmacao de senha nao confere', () => {
  render(<AdminUsuarios />)
  fireEvent.click(screen.getByRole('button', { name: 'Novo usuário' }))
  fireEvent.change(screen.getByLabelText(/Nome completo/), { target: { value: 'Carla Nova' } })
  fireEvent.change(screen.getByLabelText(/E-mail de login/), { target: { value: 'carla@fwlog.com.br' } })
  fireEvent.change(screen.getByLabelText(/Setor/), { target: { value: 'documentacao' } })
  fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: 'Senha123' } })
  fireEvent.change(screen.getByLabelText(/Confirmar senha/), { target: { value: 'Senha124' } })
  fireEvent.click(screen.getByRole('button', { name: 'Criar usuário' }))
  expect(screen.getByText('As senhas não conferem.')).toBeTruthy()
  expect(mocks.createUser).not.toHaveBeenCalled()
})

it('cria o usuario com os dados preenchidos', async () => {
  mocks.createUser.mockResolvedValue(undefined)
  render(<AdminUsuarios />)
  fireEvent.click(screen.getByRole('button', { name: 'Novo usuário' }))
  fireEvent.change(screen.getByLabelText(/Nome completo/), { target: { value: 'Carla Nova' } })
  fireEvent.change(screen.getByLabelText(/E-mail de login/), { target: { value: 'Carla@FWLog.com.br' } })
  fireEvent.change(screen.getByLabelText(/Setor/), { target: { value: 'documentacao' } })
  fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: 'Senha123' } })
  fireEvent.change(screen.getByLabelText(/Confirmar senha/), { target: { value: 'Senha123' } })
  fireEvent.click(screen.getByRole('button', { name: 'Criar usuário' }))
  await waitFor(() => expect(mocks.createUser).toHaveBeenCalledWith({
    full_name: 'Carla Nova',
    email: 'carla@fwlog.com.br',
    password: 'Senha123',
    role: 'documentacao',
  }))
})

it('desativa pela Edge Function, que tambem encerra a sessao', async () => {
  mocks.deactivateUser.mockResolvedValue(undefined)
  render(<AdminUsuarios />)
  fireEvent.click(screen.getAllByRole('button', { name: 'Desativar' })[0])
  await waitFor(() => expect(mocks.deactivateUser).toHaveBeenCalledWith('u-1'))
})
```

- [ ] **Step 2: Rodar para confirmar que falham**

Run: `npx vitest run src/pages/__tests__/AdminUsuarios.behavior.test.tsx`
Expected: FAIL — `Unable to find an element with the text: alice@fwlog.com.br` e `Unable to find role="button" and name "Novo usuário"`.

- [ ] **Step 3: Implementar na tela**

Em `src/pages/AdminUsuarios.tsx`, dentro do bloco `tab === 'usuários'`:

```tsx
const [search, setSearch] = useState('')
const [novoAberto, setNovoAberto] = useState(false)
const [editando, setEditando] = useState<AdminUserRow | null>(null)

const createMutation = useMutation({
  mutationFn: createUser,
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    showToast('Usuário criado.', 'success')
    setNovoAberto(false)
  },
  onError: (err: Error) => showToast(err.message, 'error'),
})

const credentialsMutation = useMutation({
  mutationFn: ({ userId, updates }: { userId: string; updates: { email?: string; password?: string } }) =>
    updateUserCredentials({ user_id: userId, ...updates }),
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    showToast('Acesso atualizado.', 'success')
    setEditando(null)
  },
  onError: (err: Error) => showToast(err.message, 'error'),
})

const term = search.trim().toLowerCase()
const visibleUsers = term
  ? users.filter((u) =>
      u.full_name.toLowerCase().includes(term) || (u.email ?? '').toLowerCase().includes(term))
  : users
```

A barra acima da tabela:

```tsx
<div className="mb-3 flex flex-wrap items-center gap-2">
  <input
    className="app-input w-72"
    placeholder="Buscar por nome ou e-mail"
    value={search}
    onChange={(e) => setSearch(e.target.value)}
  />
  <Button className="ml-auto" onClick={() => setNovoAberto(true)}>Novo usuário</Button>
</div>
```

O cabeçalho da tabela ganha duas colunas (`Último acesso` antes de `Criado em`), e cada linha passa a renderizar:

```tsx
<td className="px-4 py-3">
  <div className="font-medium text-[var(--app-text-strong)]">{u.full_name}</div>
  <div className="text-xs text-[var(--app-muted)]">{u.email ?? '—'}</div>
</td>
```

```tsx
<td className="px-4 py-3 tabular-nums text-[var(--app-muted)]">
  {u.last_sign_in_at
    ? formatDateTime(u.last_sign_in_at)
    : <Badge tone="amber">Nunca acessou</Badge>}
</td>
```

E a célula de ações passa a ter os dois botões:

```tsx
<td className="px-4 py-3 text-right">
  <div className="flex items-center justify-end gap-2">
    <button
      type="button"
      disabled={isBusy}
      onClick={() => setEditando(u)}
      className="app-table__action text-xs disabled:opacity-40"
    >
      Editar acesso
    </button>
    <button
      type="button"
      disabled={isBusy}
      onClick={() => void handleToggleActive(u.id, u.active)}
      className="app-table__action text-xs disabled:opacity-40"
    >
      {u.active ? 'Desativar' : 'Ativar'}
    </button>
  </div>
</td>
```

Troque o corpo de `handleToggleActive` para desativar pela Edge Function e reativar pelo caminho antigo:

```tsx
async function handleToggleActive(id: string, current: boolean) {
  const confirmed = await confirm({
    title: current ? 'Desativar usuário' : 'Ativar usuário',
    message: current
      ? 'Desativar este usuário revoga o acesso e encerra a sessão dele imediatamente. Confirmar?'
      : 'Reativar este usuário restaura o acesso dele ao sistema. Confirmar?',
    confirmLabel: current ? 'Desativar' : 'Ativar',
    tone: current ? 'danger' : 'primary',
  })
  if (!confirmed) return
  setPendingId(id)
  if (current) {
    deactivateMutation.mutate(id)
    return
  }
  mutation.mutate({ id, updates: { active: true } })
}
```

com a mutação correspondente:

```tsx
const deactivateMutation = useMutation({
  mutationFn: deactivateUser,
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    showToast('Usuário desativado e sessão encerrada.', 'success')
    setPendingId(null)
  },
  onError: (err: Error) => { showToast(err.message, 'error'); setPendingId(null) },
})
```

E, ao final do bloco da aba, os modais:

```tsx
{/* Montagem condicional, não `open={novoAberto}`: o modal guarda o estado dos
    campos internamente, e mantê-lo montado faria a segunda abertura reaparecer
    com os dados do usuário anterior. */}
{novoAberto ? (
  <NovoUsuarioModal
    open
    onClose={() => setNovoAberto(false)}
    onSubmit={(input) => createMutation.mutate(input)}
    submitting={createMutation.isPending}
  />
) : null}
{editando ? (
  <EditarAcessoModal
    open
    userName={editando.full_name}
    currentEmail={editando.email}
    onClose={() => setEditando(null)}
    onSubmit={(updates) => credentialsMutation.mutate({ userId: editando.id, updates })}
    submitting={credentialsMutation.isPending}
  />
) : null}
```

Ajuste os imports do topo do arquivo: `Button` de `../components/ui/Button`, os dois modais de `../components/admin/...`, e `createUser`, `updateUserCredentials`, `deactivateUser`, `type AdminUserRow` de `../services/adminUsers`.

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run src/pages/__tests__/AdminUsuarios.behavior.test.tsx`
Expected: PASS, incluindo os testes antigos (`US-146` e seguintes).

- [ ] **Step 5: Commit**

```bash
git add src/pages/AdminUsuarios.tsx src/pages/__tests__/AdminUsuarios.behavior.test.tsx
git commit -m "feat: criacao, edicao de acesso, busca e ultimo acesso em /admin/usuarios"
```

---

### Task 8: Confirmação ao trocar o setor

Hoje o `onChange` do `<select>` aplica a mudança direto (`AdminUsuarios.tsx:161`), sem confirmação e sem mostrar o que o setor de destino concede.

**Files:**
- Modify: `src/pages/AdminUsuarios.tsx`
- Test: `src/pages/__tests__/AdminUsuarios.behavior.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

```typescript
it('pede confirmacao antes de trocar o setor, mostrando o escopo do destino', async () => {
  render(<AdminUsuarios />)
  fireEvent.change(screen.getAllByTitle('Setor de acesso')[0], { target: { value: 'financeiro' } })
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  const args = mocks.confirm.mock.calls[0][0] as { message: string }
  expect(args.message).toContain('Faturamento')
  expect(mocks.updateUserProfile).toHaveBeenCalledWith('u-1', { role: 'financeiro' })
})

it('nao troca o setor quando a confirmacao e recusada', async () => {
  mocks.confirm.mockResolvedValue(false)
  render(<AdminUsuarios />)
  fireEvent.change(screen.getAllByTitle('Setor de acesso')[0], { target: { value: 'financeiro' } })
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  expect(mocks.updateUserProfile).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Rodar para confirmar que falham**

Run: `npx vitest run src/pages/__tests__/AdminUsuarios.behavior.test.tsx -t 'setor'`
Expected: FAIL — `Unable to find an element by: [title="Setor de acesso"]`.

- [ ] **Step 3: Implementar**

Troque `handleSetProfile` por uma versão que confirma antes:

```tsx
async function handleSetProfile(user: AdminUserRow, role: UserProfileRole) {
  const confirmed = await confirm({
    title: 'Alterar setor',
    message: `${user.full_name} passa a ter o acesso de ${PROFILE_LABELS[role]}: ${PROFILE_SCOPES[role]}`,
    confirmLabel: 'Alterar setor',
    tone: 'primary',
  })
  if (!confirmed) return
  setPendingId(user.id)
  mutation.mutate({ id: user.id, updates: { role } })
}
```

E no `<select>` da linha, acrescente o `title` fixo (o `title` de perfil legado vira um `aria-description` na mesma célula, para não disputar o seletor do teste):

```tsx
<select
  disabled={isBusy}
  value={normalizedRole}
  title="Setor de acesso"
  aria-description={legacyRoleTitle}
  onChange={(e) => void handleSetProfile(u, e.target.value as UserProfileRole)}
  className="app-input app-select w-44 text-xs disabled:opacity-40"
>
```

Troque também a legenda do rodapé para ler de `PROFILE_SCOPES`, eliminando a duplicação com o diálogo:

```tsx
<div className="grid gap-2 text-[var(--app-muted)]">
  {MANAGED_PROFILES.map((profile) => (
    <div key={profile}>
      <span className="font-semibold text-[var(--app-text-strong)]">{PROFILE_LABELS[profile]}:</span>{' '}
      {PROFILE_SCOPES[profile]}
    </div>
  ))}
</div>
```

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run src/pages/__tests__/AdminUsuarios.behavior.test.tsx`
Expected: PASS. Atenção: o teste antigo que muda o setor sem confirmar precisa passar a aguardar o `confirm` — ajuste-o em vez de removê-lo.

- [ ] **Step 5: Commit**

```bash
git add src/pages/AdminUsuarios.tsx src/pages/__tests__/AdminUsuarios.behavior.test.tsx
git commit -m "feat: confirmar troca de setor exibindo o escopo do destino"
```

---

### Task 9: Mover "Informações do sistema" para a aba Métricas

**Files:**
- Modify: `src/pages/AdminUsuarios.tsx:91-107`

- [ ] **Step 1: Escrever o teste que falha**

```typescript
it('mostra as informacoes do sistema na aba Metricas, nao no topo da tela', () => {
  render(<AdminUsuarios />)
  expect(screen.queryByText('Informações do sistema')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Métricas' }))
  expect(screen.getByText('Informações do sistema')).toBeTruthy()
})
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `npx vitest run src/pages/__tests__/AdminUsuarios.behavior.test.tsx -t 'informacoes do sistema'`
Expected: FAIL — o texto é encontrado antes de clicar na aba.

- [ ] **Step 3: Implementar**

Recorte o bloco `<div className="mb-6 app-panel app-panel--padded">` de `AdminUsuarios.tsx:91-107` inteiro e cole dentro do bloco `tab === 'métricas'`, **acima** do grid de `MetricCard`. A ordem do topo passa a ser: `PageHeader` → abas → conteúdo.

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run src/pages/__tests__/AdminUsuarios.behavior.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/AdminUsuarios.tsx src/pages/__tests__/AdminUsuarios.behavior.test.tsx
git commit -m "refactor: informacoes do sistema saem do topo para a aba Metricas"
```

---

### Task 10: Troca da própria senha

**Files:**
- Create: `src/components/admin/AlterarMinhaSenhaModal.tsx`
- Create: `src/components/admin/__tests__/AlterarMinhaSenhaModal.test.tsx`
- Modify: `src/components/layout/AppLayout.tsx:118-135`

- [ ] **Step 1: Escrever o teste que falha**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('../../../services/supabase', () => ({
  supabase: { auth: { signInWithPassword: mocks.signInWithPassword, updateUser: mocks.updateUser } },
}))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))

import { AlterarMinhaSenhaModal } from '../AlterarMinhaSenhaModal'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.signInWithPassword.mockResolvedValue({ error: null })
  mocks.updateUser.mockResolvedValue({ error: null })
})
afterEach(cleanup)

function preencher(atual: string, nova: string, confirmacao: string) {
  fireEvent.change(screen.getByLabelText(/Senha atual/), { target: { value: atual } })
  fireEvent.change(screen.getByLabelText(/Nova senha/), { target: { value: nova } })
  fireEvent.change(screen.getByLabelText(/Confirmar nova senha/), { target: { value: confirmacao } })
  fireEvent.click(screen.getByRole('button', { name: 'Alterar senha' }))
}

it('revalida a senha atual antes de trocar', async () => {
  render(<AlterarMinhaSenhaModal open email="ana@fwlog.com.br" onClose={vi.fn()} />)
  preencher('Antiga123', 'Nova12345', 'Nova12345')
  await waitFor(() => expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: 'ana@fwlog.com.br', password: 'Antiga123' }))
  expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'Nova12345' })
})

it('nao troca a senha quando a senha atual esta errada', async () => {
  mocks.signInWithPassword.mockResolvedValue({ error: new Error('invalid') })
  render(<AlterarMinhaSenhaModal open email="ana@fwlog.com.br" onClose={vi.fn()} />)
  preencher('Errada123', 'Nova12345', 'Nova12345')
  await waitFor(() => expect(screen.getByText('Senha atual incorreta.')).toBeTruthy())
  expect(mocks.updateUser).not.toHaveBeenCalled()
})

it('recusa nova senha fora da regra', async () => {
  render(<AlterarMinhaSenhaModal open email="ana@fwlog.com.br" onClose={vi.fn()} />)
  preencher('Antiga123', 'fraca', 'fraca')
  await waitFor(() => expect(screen.getByText(/no mínimo 8 caracteres/)).toBeTruthy())
  expect(mocks.updateUser).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `npx vitest run src/components/admin/__tests__/AlterarMinhaSenhaModal.test.tsx`
Expected: FAIL — `Failed to resolve import "../AlterarMinhaSenhaModal"`.

- [ ] **Step 3: Implementar o modal**

```tsx
import { useState, type FormEvent } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { useToast } from '../ui/Toast'
import { supabase } from '../../services/supabase'
import { PASSWORD_RULE_MESSAGE, isValidPassword } from '../../lib/passwordPolicy'

export function AlterarMinhaSenhaModal({
  open,
  email,
  onClose,
}: {
  open: boolean
  email: string
  onClose: () => void
}) {
  const { showToast } = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!isValidPassword(next)) return setError(PASSWORD_RULE_MESSAGE)
    if (next !== confirmation) return setError('As senhas não conferem.')
    setError('')
    setSubmitting(true)
    try {
      // Revalidar a senha atual impede que uma estação destravada troque a senha.
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: current })
      if (signInError) { setError('Senha atual incorreta.'); return }
      const { error: updateError } = await supabase.auth.updateUser({ password: next })
      if (updateError) { setError('Não foi possível alterar a senha.'); return }
      showToast('Senha alterada.', 'success')
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} title="Alterar minha senha" onClose={onClose}>
      <form onSubmit={handleSubmit} className="grid gap-3">
        <Field label="Senha atual" required>
          <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </Field>
        <Field label="Nova senha" required>
          <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Confirmar nova senha" required>
          <Input type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        </Field>
        <p className="text-xs text-[var(--app-muted)]">{PASSWORD_RULE_MESSAGE}</p>
        {error ? <p className="app-field__error" role="alert">{error}</p> : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={submitting}>Alterar senha</Button>
        </div>
      </form>
    </Modal>
  )
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run src/components/admin/__tests__/AlterarMinhaSenhaModal.test.tsx`
Expected: PASS — 3 testes.

- [ ] **Step 5: Ligar ao cabeçalho**

Em `src/components/layout/AppLayout.tsx`, importe `KeyRound` de `lucide-react`, `useState` e o modal; pegue o e-mail da sessão (`const { profile, session, signOut, isAdmin } = useAuth()`), e insira o botão entre o `app-user-pill` e o botão "Sair":

```tsx
<Button variant="ghost" onClick={() => setSenhaAberta(true)}>
  <KeyRound size={16} />
  Minha senha
</Button>
```

e, antes do fechamento do `<header>`:

```tsx
{senhaAberta && session?.user.email ? (
  <AlterarMinhaSenhaModal open email={session.user.email} onClose={() => setSenhaAberta(false)} />
) : null}
```

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS. Testes que renderizam o `AppLayout` podem precisar do `session` no mock de `useAuth` — se algum quebrar por isso, acrescente `session: null` ao mock, que é o caminho em que o botão simplesmente não renderiza o modal.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/AlterarMinhaSenhaModal.tsx src/components/admin/__tests__/AlterarMinhaSenhaModal.test.tsx src/components/layout/AppLayout.tsx
git commit -m "feat: usuario altera a propria senha pelo cabecalho"
```

---

### Task 11: Documentação viva

**Files:**
- Modify: `docs/ARCHITECTURE.md:406`
- Modify: `docs/RASTREABILIDADE.md:87,203,234`
- Create: `docs/adr/0037-usuario-interno-criado-pelo-admin-com-senha-definida.md`
- Modify: `docs/adr/README.md`
- Modify: `docs/plans/README.md`

- [ ] **Step 1: Atualizar `docs/ARCHITECTURE.md`**

A linha da rota hoje é `| `/admin/usuarios` | Administração de usuários |`. Troque a descrição por: `Administração de usuários: criação com senha definida pelo admin, edição de e-mail/senha, setor, ativação e auditoria`.

- [ ] **Step 2: Atualizar `docs/RASTREABILIDADE.md`**

Três linhas:
- Linha da rota `/admin/usuarios` (87): acrescente às ações "criar usuário, editar credenciais e desativar encerrando sessão"; nos serviços, `adminUsers.ts` + Edge Function `admin-users` + RPC `admin_list_users`.
- Linha de `user_profiles` (234): as operações passam de `SELECT`, `UPDATE` para `SELECT`, `INSERT`, `UPDATE`; acrescente a RPC `admin_list_users` e o trigger `trg_audit_user_profile_changes` da migration `258`.
- Linha de `audit_logs` (203): acrescente `supabase/functions/admin-users/index.ts` à lista de escritores.

- [ ] **Step 3: Escrever a ADR 0037**

```markdown
# 0037 — Usuário interno é criado pelo administrador com senha definida, sem convite

- Status: aceito
- Data: 2026-08-05

## Contexto

`user_profiles.id` é chave estrangeira de `auth.users(id)`, e a tela
`/admin/usuarios` só fazia `SELECT` e `UPDATE`. Criar um usuário interno exigia
o dashboard do Supabase, e o produto já convivia com o estado intermediário:
o `ProtectedRoute` tem uma tela para "perfil não provisionado". O login interno
também não oferecia recuperação de senha.

O Portal do Cliente resolve o mesmo problema por convite com token e e-mail
(ADR 0018, `portal-invite-send`), com supressão de bounce, expiração e
reenvio.

## Decisão

Para o **sistema interno**, o administrador cria o usuário informando nome,
e-mail, setor e senha, e pode alterar e-mail ou senha a qualquer momento. Não há
convite, token nem envio de e-mail. O usuário entra imediatamente
(`email_confirm: true`) e pode trocar a própria senha, mediante revalidação da
senha atual.

O setor é obrigatório no cadastro e continua sendo a coluna `role`: os papéis já
funcionam como departamento no sign-off do ADR
(`223_agency_report_department_signoff.sql`).

A escrita privilegiada mora na Edge Function `admin-users`, que reserva o
`service_role` para as operações de autenticação e usa o cliente do chamador
para escrever em tabela, preservando RLS e o autor na auditoria.

## Consequências

- O administrador conhece a senha inicial de cada pessoa. Aceitável para um time
  interno pequeno, onde a entrega é presencial; é o custo de não depender de
  e-mail.
- Não existe autoatendimento de "esqueci minha senha" no login interno: quem
  esquece pede ao administrador uma senha nova.
- O Portal do Cliente **não** muda: o fluxo de convite da ADR 0018 continua
  valendo para o cliente externo, e a divergência entre os dois é deliberada.
- Toda criação, troca de setor, ativação/desativação e redefinição de senha
  passa a aparecer no Log de Ações.
```

- [ ] **Step 4: Indexar a ADR e registrar o plano**

Em `docs/adr/README.md`, acrescente a linha da 0037 à tabela, com a coluna de relação preenchida: `Não supersede a 0018 (convite do Portal do Cliente), que continua valendo para o cliente externo; a divergência entre os dois fluxos é deliberada`.

Em `docs/plans/README.md`, substitua "Nenhum plano ativo no momento." pela tabela com este plano e o de veículos/desova, ambos com status `TODO`.

- [ ] **Step 5: Rodar a verificação de documentação**

Run: `npm run docs:check`
Expected: `Documentation checks passed`. O script valida links, rotas e cobertura do índice de ADRs — uma ADR fora do índice reprova.

- [ ] **Step 6: Commit**

```bash
git add docs/
git commit -m "docs: registrar criacao de usuarios internos na documentacao viva"
```

---

### Task 12: Verificação final

- [ ] **Step 1: Rodar a bateria completa**

Run:
```bash
npm run lint && npm test && npm run build && npm run docs:check
```
Expected: os quatro passam. `npm run build` roda `tsc -b` antes do Vite, então erro de tipo aparece aqui.

- [ ] **Step 2: Registrar a validação em ambiente real**

A Edge Function não tem suíte automatizada neste projeto. Antes de considerar a entrega concluída, valide em ambiente real e registre conforme `docs/operations/validacao.md`: criar um usuário, entrar com ele, trocar a senha dele pelo admin, entrar de novo, trocar a própria senha, e desativá-lo com uma sessão aberta conferindo que ela cai.

- [ ] **Step 3: Deploy na ordem correta**

O deploy do Firebase não publica Edge Functions nem aplica migrations (`WORKFLOW.md`). A ordem é:

```bash
# 1. migration
npx supabase db push
# 2. edge function
npx supabase functions deploy admin-users
# 3. frontend (pipeline normal)
```

Invertida, a tela sobe chamando uma função que ainda não existe.

- [ ] **Step 4: Arquivar o plano**

Ao concluir, no mesmo change:

```bash
git mv docs/plans/2026-08-05-admin-usuarios-criacao.md docs/archive/plans/
git mv docs/spec/2026-08-05-admin-usuarios-design.md docs/archive/specs/
```

E remova as linhas correspondentes de `docs/plans/README.md` e `docs/spec/README.md`, registre a entrega em `docs/CHANGELOG.md` e rode `npm run docs:check`.
