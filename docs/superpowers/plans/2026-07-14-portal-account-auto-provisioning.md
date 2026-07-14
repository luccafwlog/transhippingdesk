# Portal Account Auto-Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every new `public.customers` row immediately has an internal Portal queue record in `aguardando_analise`/`sem_conta`, regardless of how the customer was inserted.

**Architecture:** Add one `AFTER INSERT` trigger on `public.customers` so the database, rather than individual UI/import paths, owns the invariant. The `SECURITY DEFINER` trigger inserts the queue record and append-only system audit event idempotently; the migration also repairs existing customers that are still missing a Portal record. It never creates Supabase Auth identities, passwords, invitations, recovery emails, or outbound email.

**Tech Stack:** PostgreSQL/Supabase migrations, PL/pgSQL, Vitest, Markdown living documentation, Supabase CLI.

## Global Constraints

- Keep the existing `customer_portal_accounts.customer_id` unique invariant and use `ON CONFLICT (customer_id) DO NOTHING`.
- Initial values are `active=false`, `provisioning_decision='aguardando_analise'`, `account_situation='sem_conta'`, normalized `login_cnpj`, and no identity or email fields.
- The trigger must be `SECURITY DEFINER` with `SET search_path TO 'public', 'pg_temp'` and must not depend on `auth.uid()`.
- Audit events use `actor_type='sistema'` and a null `actor_id`; `portal_provisioning_events` remains append-only.
- The database trigger must cover manual creation, imports, RPCs, scripts, and future insertion paths without duplicating application logic.
- Follow the repository gates: `npm run docs:check`, `npm run lint`, `npm test`, `npm run build`, and `git diff --check`.

---

### Task 1: Add the migration contract test first

**Files:**
- Create: `src/services/__tests__/portalCustomerAutoProvisionMigration.test.ts`
- Test target: `supabase/migrations/193_portal_account_on_customer_insert.sql`

**Interfaces:**
- Consumes: the SQL migration file created in Task 2.
- Produces: a Vitest contract that requires the trigger, secure execution context, initial queue state, audit event, idempotent repair, and normalized CNPJ behavior.

- [ ] **Step 1: Write the failing test**

Create `src/services/__tests__/portalCustomerAutoProvisionMigration.test.ts` with:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/193_portal_account_on_customer_insert.sql', 'utf8')

describe('Portal customer auto-provisioning migration (193)', () => {
  it('creates the queue record securely after every customer insert', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_create_account_on_customer_insert\(\)/i)
    expect(sql).toMatch(/SECURITY DEFINER/i)
    expect(sql).toMatch(/SET search_path TO 'public', 'pg_temp'/i)
    expect(sql).toMatch(/AFTER INSERT ON public\.customers/i)
    expect(sql).toMatch(/CREATE TRIGGER trg_portal_create_account_on_customer_insert/i)
    expect(sql).toMatch(/active\s*,\s*provisioning_decision\s*,\s*account_situation\s*,\s*login_cnpj/i)
    expect(sql).toContain("false, 'aguardando_analise', 'sem_conta'")
    expect(sql).toMatch(/regexp_replace\(NEW\.cnpj_cpf, '\\D', '', 'g'\)/i)
    expect(sql).toMatch(/ON CONFLICT \(customer_id\) DO NOTHING/i)
  })

  it('records a system audit event without creating Auth or email data', () => {
    expect(sql).toMatch(/INSERT INTO public\.portal_provisioning_events/i)
    expect(sql).toMatch(/'sistema', NULL/i)
    expect(sql).toContain('Conta de Portal criada automaticamente no cadastro do Cliente.')
    expect(sql).not.toMatch(/INSERT INTO\s+auth\./i)
    expect(sql).not.toMatch(/portal_invites/i)
    expect(sql).not.toMatch(/RESEND_API_KEY/i)
  })

  it('repairs existing customers without duplicating their queue records', () => {
    expect(sql).toMatch(/FROM public\.customers c/i)
    expect(sql).toMatch(/FROM public\.customer_portal_accounts a/i)
    expect(sql).toMatch(/WHERE NOT EXISTS\s*\([\s\S]*a\.customer_id = c\.id/i)
    expect(sql).toContain('Reparo automático da conta de Portal para Cliente existente.')
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails because the migration is absent**

Run: `npx vitest run src/services/__tests__/portalCustomerAutoProvisionMigration.test.ts`

Expected: FAIL with a file-not-found error for `supabase/migrations/193_portal_account_on_customer_insert.sql`.

- [ ] **Step 3: Commit the red test**

```powershell
git add src/services/__tests__/portalCustomerAutoProvisionMigration.test.ts
git commit -m "test: specify automatic portal account creation"
```

### Task 2: Create the database invariant and repair existing data

**Files:**
- Create: `supabase/migrations/193_portal_account_on_customer_insert.sql`

**Interfaces:**
- Consumes: `public.customers`, `public.customer_portal_accounts`, and `public.portal_provisioning_events`.
- Produces: `public.portal_create_account_on_customer_insert()` and trigger `trg_portal_create_account_on_customer_insert`.

- [ ] **Step 1: Add the minimal secure trigger and idempotent repair SQL**

Create `supabase/migrations/193_portal_account_on_customer_insert.sql` with:

```sql
-- 193: Create the Portal queue row whenever a Customer is created.
-- No Auth identity, password, invite, recovery email, or outbound email is created here.

CREATE OR REPLACE FUNCTION public.portal_create_account_on_customer_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_account_id BIGINT;
BEGIN
  INSERT INTO public.customer_portal_accounts (
    customer_id, active, provisioning_decision, account_situation, login_cnpj
  )
  VALUES (
    NEW.id, false, 'aguardando_analise', 'sem_conta',
    regexp_replace(NEW.cnpj_cpf, '\D', '', 'g')
  )
  ON CONFLICT (customer_id) DO NOTHING
  RETURNING id INTO v_account_id;

  IF v_account_id IS NOT NULL THEN
    INSERT INTO public.portal_provisioning_events (
      customer_id, account_id, previous_decision, new_decision,
      previous_situation, new_situation, actor_type, actor_id,
      reason, request_id
    )
    VALUES (
      NEW.id, v_account_id, NULL, 'aguardando_analise',
      NULL, 'sem_conta', 'sistema', NULL,
      'Conta de Portal criada automaticamente no cadastro do Cliente.', NULL
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_create_account_on_customer_insert()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_portal_create_account_on_customer_insert
ON public.customers;
CREATE TRIGGER trg_portal_create_account_on_customer_insert
AFTER INSERT ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.portal_create_account_on_customer_insert();

WITH inserted AS (
  INSERT INTO public.customer_portal_accounts (
    customer_id, active, provisioning_decision, account_situation, login_cnpj
  )
  SELECT
    c.id, false, 'aguardando_analise', 'sem_conta',
    regexp_replace(c.cnpj_cpf, '\D', '', 'g')
  FROM public.customers AS c
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.customer_portal_accounts AS a
    WHERE a.customer_id = c.id
  )
  ON CONFLICT (customer_id) DO NOTHING
  RETURNING id, customer_id
)
INSERT INTO public.portal_provisioning_events (
  customer_id, account_id, previous_decision, new_decision,
  previous_situation, new_situation, actor_type, actor_id,
  reason, request_id
)
SELECT
  customer_id, id, NULL, 'aguardando_analise',
  NULL, 'sem_conta', 'sistema', NULL,
  'Reparo automático da conta de Portal para Cliente existente.', NULL
FROM inserted;
```

- [ ] **Step 2: Run the focused test and verify it passes**

Run: `npx vitest run src/services/__tests__/portalCustomerAutoProvisionMigration.test.ts`

Expected: PASS with all three migration contract tests passing.

- [ ] **Step 3: Commit the migration and its test**

```powershell
git add supabase/migrations/193_portal_account_on_customer_insert.sql
git commit -m "feat: auto-create portal queue records for customers"
```

### Task 3: Update the living module documentation

**Files:**
- Modify: `docs/modules/portal-cliente.md` in `## Provisionamento operacional` and the production status paragraph.
- Modify: `docs/modules/clientes.md` in the `/clientes — criar cliente` catalog row.

**Interfaces:**
- Consumes: migration `193` and the existing Portal state-machine terminology.
- Produces: documentation that states the queue invariant and separates analysis from Auth/invitation.

- [ ] **Step 1: Document the automatic queue invariant in `portal-cliente.md`**

Immediately after the paragraph ending in “quando o job periódico está atrasado.”, add:

```markdown
Ao inserir qualquer Cliente em `public.customers`, a migration `193` cria
automaticamente seu registro em `customer_portal_accounts` com
`active=false`, `provisioning_decision='aguardando_analise'`,
`account_situation='sem_conta'` e `login_cnpj` normalizado. A operação é
idempotente, registra evento de sistema e também repara Clientes existentes que
estavam sem registro. Isso coloca o Cliente na fila administrativa imediatamente;
não cria usuário Auth, senha, convite, email de recuperação ou email transacional.
Processo/B/L pode alterar prioridade e pendências operacionais, mas não é
pré-requisito para a existência da linha na fila.
```

In the production status paragraph, append after the existing audit sentence:

```markdown
A migration `193` mantém essa fila sincronizada para novos Clientes e reparou
eventuais registros ausentes.
```

- [ ] **Step 2: Update the customer creation catalog row**

In the `/clientes — criar cliente` row of `docs/modules/clientes.md`, change the persistence cell to:

```markdown
Cliente e contatos são inseridos na mesma transação; o trigger da migration `193` cria a linha inicial da Conta de Portal e seu evento de auditoria, sem convite ou email.
```

Add `supabase/migrations/193_portal_account_on_customer_insert.sql` to that row’s evidence after `supabase/migrations/143_create_customer_with_contacts_atomic.sql`.

- [ ] **Step 3: Run the documentation check**

Run: `npm run docs:check`

Expected: PASS with no documentation contract errors.

- [ ] **Step 4: Commit the documentation**

```powershell
git add docs/modules/portal-cliente.md docs/modules/clientes.md
git commit -m "docs: document automatic portal queue entry"
```

### Task 4: Verify, apply to Supabase, and publish

**Files:**
- Verify: all files from Tasks 1–3.
- No additional source files are expected.

**Interfaces:**
- Consumes: migration `193` and the repository verification commands.
- Produces: a tested, remotely published `main` and a production schema with zero customers missing a Portal queue record.

- [ ] **Step 1: Run the full local verification gates**

Run each command separately from `C:\Users\Lucca\Downloads\transhipping-desk2`:

```powershell
npm run docs:check
npm run lint
npm test
npm run build
git diff --check
```

Expected: every command exits with code 0; `git diff --check` prints no whitespace errors.

- [ ] **Step 2: Confirm the linked Supabase migration plan**

Run: `supabase db push --linked --dry-run`

Expected: the only pending migration is `193_portal_account_on_customer_insert.sql`.

- [ ] **Step 3: Publish the implementation on `main`**

```powershell
git status --short --branch
git push origin main
```

Expected: `main` is up to date on `origin/main` and the implementation commit is visible remotely.

- [ ] **Step 4: Apply migration 193 to the linked production project**

Run: `supabase db push --linked --yes`

Expected: migration `193_portal_account_on_customer_insert.sql` applies successfully.

- [ ] **Step 5: Verify the production invariant**

Run:

```powershell
supabase db query --linked "SELECT (SELECT count(*) FROM public.customers) AS total_customers, (SELECT count(*) FROM public.customer_portal_accounts) AS portal_accounts, (SELECT count(*) FROM public.customers AS c WHERE NOT EXISTS (SELECT 1 FROM public.customer_portal_accounts AS a WHERE a.customer_id = c.id)) AS customers_missing_record;"
```

Expected: `customers_missing_record` is `0`, and `portal_accounts` equals `total_customers`.

- [ ] **Step 6: Confirm final repository and remote state**

Run:

```powershell
git status --short --branch
git log -5 --oneline
git diff origin/main...HEAD --stat
```

Expected: the worktree is clean, `main` matches `origin/main`, and the log includes the migration, test, documentation, and plan commits.

## Self-review checklist

- Spec coverage: trigger covers every insert path; initial state and normalized CNPJ match the approved design; repair is idempotent; system audit is recorded; Auth/email/invite side effects are excluded; docs and verification are included.
- Placeholder scan: no `TODO`, `TBD`, `TBA`, or unspecified implementation step appears in this plan.
- Type consistency: `customer_portal_accounts.id`, `customer_portal_accounts.customer_id`, and `portal_provisioning_events.account_id` are `BIGINT`; `actor_id` is nullable `UUID`; the trigger returns `NEW` as required by PostgreSQL.
