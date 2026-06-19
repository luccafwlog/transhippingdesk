# Supabase Contracts and Security Boundaries Cartography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exhaustively map the Supabase tables, RPCs, triggers, RLS policies, grants, migrations, and Edge Functions that form the executable backend contract.

**Architecture:** Build the initial `docs/RASTREABILIDADE.md` as a contract inventory, distinguishing current definitions from superseded migration history. Later, Plan 08 adds the route/action index and runtime evidence without replacing this backend map.

**Tech Stack:** PostgreSQL migrations, Supabase Auth/RLS/RPC/Edge Functions, TypeScript callers, Markdown, Mermaid, Vitest contract tests.

---

## Files

### Create

- `docs/RASTREABILIDADE.md`

### Read Exhaustively

- `supabase/migrations/*.sql`
- `supabase/functions/notify-invoice-issued/index.ts`
- `supabase/functions/provision-portal-user/index.ts`
- `src/services/*.ts`
- `src/services/charges/*.ts`
- `src/services/demurrage/*.ts`
- `src/hooks/*.ts`
- `src/hooks/*.tsx`
- `src/pages/*.tsx`
- `src/components/**/*.tsx`
- `src/services/__tests__/*Migration.test.ts`
- `src/integration/supabase.integration.test.ts`
- `docs/adr/0004-supabase-rls-rpc-fronteira-seguranca.md`
- `docs/adr/0011-revogacao-anon-security-definer-default-deny.md`
- `docs/adr/0013-portal-auth-identificador-resolvido-e-excecao-anon.md`

Do not edit migrations, Edge Functions, product code, or generated types.

### Task 1: Create the Contract Inventory Document

**Files:**

- Create: `docs/RASTREABILIDADE.md`

- [ ] **Step 1: Add the canonical header and evidence legend**

Create:

```markdown
# Rastreabilidade Técnica

Verificado contra o repositório em 2026-06-19.

Este índice liga interfaces do frontend aos contratos executáveis do Supabase e,
após a consolidação final, também liga cada rota e ação ao módulo proprietário.

## Evidência

- **Código:** caminho confirmado por leitura do código executável.
- **Teste:** comportamento sustentado por uma asserção automatizada identificada.
- **Runtime:** comportamento observado em navegador/API/banco controlado.
- **Suspeita:** divergência plausível que ainda exige confirmação adicional.

Testes que apenas inspecionam o texto de migrations aparecem como “Teste de
contrato SQL”, não como prova funcional do banco.

## Contratos Supabase
```

- [ ] **Step 2: Add contract-table schemas**

Use these exact tables:

```markdown
### RPCs e funções chamadas pelo cliente

| Contrato | Chamadores TypeScript | Definição vigente | Autorização | Escritas / efeitos | Módulo | Evidência |
|---|---|---|---|---|---|---|

### Tabelas acessadas diretamente pelo cliente

| Tabela | Operações do cliente | Chamadores | RLS / policy vigente | Efeitos relacionados | Módulo | Evidência |
|---|---|---|---|---|---|---|

### Triggers e jobs com efeitos indiretos

| Trigger / job | Evento | Função | Efeito indireto | Definição vigente | Módulo | Evidência |
|---|---|---|---|---|---|---|

### Edge Functions

| Função | Chamador | Autenticação própria | Recursos privilegiados | Efeitos externos | Evidência |
|---|---|---|---|---|---|

### Histórico supersedido relevante

| Contrato | Definição antiga | Definição vigente | Mudança de segurança/comportamento |
|---|---|---|---|
```

### Task 2: Inventory Every Client RPC and Direct Table Access

**Files:**

- Modify: `docs/RASTREABILIDADE.md`
- Read: all TypeScript sources listed above

- [ ] **Step 1: Extract RPC call candidates**

Run:

```powershell
rg -n "\.rpc\(" src/services src/hooks src/pages src/components -g "*.ts" -g "*.tsx"
```

Expected: a complete candidate list with file and line evidence.

- [ ] **Step 2: Extract direct table and Edge Function candidates**

Run:

```powershell
rg -n "\.from\(|functions\.invoke" src/services src/hooks src/pages src/components -g "*.ts" -g "*.tsx"
```

Expected: all direct table operations and Edge Function invokes.

- [ ] **Step 3: Normalize candidates into contracts**

For every distinct RPC and table:

1. list all TypeScript callers;
2. identify read/write operation;
3. assign one owning module;
4. identify cache invalidations or indirect effects when visible;
5. add a row to the correct table.

Do not omit contracts because they are used only by admin, Portal, imports, or a legacy fallback.

### Task 3: Resolve the Vigent Migration Definition

**Files:**

- Modify: `docs/RASTREABILIDADE.md`
- Read: `supabase/migrations/*.sql`

- [ ] **Step 1: Extract schema candidates**

Run:

```powershell
rg -n "CREATE (OR REPLACE )?FUNCTION|CREATE TABLE|ALTER TABLE .*ENABLE ROW LEVEL SECURITY|CREATE POLICY|GRANT EXECUTE|REVOKE .*FUNCTION|CREATE TRIGGER|cron\.schedule" supabase/migrations -g "*.sql"
```

Expected: ordered migration evidence for functions, tables, RLS, grants, triggers, and jobs.

- [ ] **Step 2: Resolve superseded functions by signature**

For each client-called function:

- search every definition;
- order by migration filename;
- use the final applicable definition/signature as `Definição vigente`;
- record security-relevant earlier definitions only in `Histórico supersedido relevante`;
- do not treat an early `GRANT ... TO anon` as current if a later migration revokes it.

- [ ] **Step 3: Verify security-definer controls**

For every current `SECURITY DEFINER` client-callable function, record:

- `search_path` behavior;
- explicit internal role/identity check;
- current grants/revokes;
- whether `anon` is allowed;
- ADR-backed reason for any `anon` exception.

If the migration history cannot prove the current remote grant state, label it `Suspeita` and require runtime schema inspection.

- [ ] **Step 4: Map direct table RLS**

For every table directly accessed by the client, record:

- RLS enabled/disabled evidence;
- SELECT/INSERT/UPDATE/DELETE policies relevant to the caller;
- helper functions such as `is_active_user()` or `is_admin()`;
- whether the frontend action relies on a policy or an RPC.

### Task 4: Map Triggers, Jobs, and Edge Functions

**Files:**

- Modify: `docs/RASTREABILIDADE.md`
- Read: `supabase/functions/notify-invoice-issued/index.ts`
- Read: `supabase/functions/provision-portal-user/index.ts`
- Read: relevant migration trigger/job definitions

- [ ] **Step 1: Inventory indirect effects**

Include at minimum:

- invoice numbering;
- overdue marking / `pg_cron`;
- PIX payload population;
- invoice/receivable lifecycle synchronization;
- Portal notification triggers;
- demurrage `updated_at` and discharge-date behavior;
- voyage schedule snapshots/audit;
- review and billing-gate triggers;
- active-invoice duplicate guards.

- [ ] **Step 2: Inspect Edge Function trust boundaries**

For each Edge Function record:

- caller and request authentication;
- origin/CORS checks;
- service-role use;
- rate limits;
- database writes;
- external service call;
- failure semantics visible to the frontend.

- [ ] **Step 3: Add a backend flow diagram**

Create one Mermaid diagram:

```text
Internal Auth client ─┐
Portal Auth client ───┼→ PostgREST/RPC → RLS/functions → tables/triggers/jobs
Edge Functions ───────┘                         └→ Resend / Auth Admin
```

Label security boundaries, not every table.

### Task 5: Classify Automated Database Evidence

**Files:**

- Modify: `docs/RASTREABILIDADE.md`
- Test: `src/services/__tests__/*Migration.test.ts`
- Test: `src/integration/supabase.integration.test.ts`

- [ ] **Step 1: Run all migration contract tests**

Run:

```powershell
$migrationTests = Get-ChildItem src/services/__tests__/*Migration.test.ts |
  Select-Object -ExpandProperty FullName
npx vitest run $migrationTests
```

Expected: exit `0`.

- [ ] **Step 2: Label their proof correctly**

For each referenced test:

- label `Teste de contrato SQL` if it reads migration text/regex;
- label `Teste` only if it executes TypeScript behavior;
- label `Integração` only if it requires and calls a real Supabase environment.

- [ ] **Step 3: Inspect the integration suite**

Read `src/integration/supabase.integration.test.ts` and list exactly which contracts it exercises. Do not run it unless a controlled environment is confirmed in Plan 08.

### Task 6: Verify Exhaustiveness and Commit

**Files:**

- Modify: `docs/RASTREABILIDADE.md`

- [ ] **Step 1: Compare client RPC names against the document**

Run a PowerShell extraction of single-quoted string-literal RPC names:

```powershell
$rpcNames = Get-ChildItem src/services,src/hooks,src/pages,src/components -Recurse -File -Include *.ts,*.tsx |
  Select-String -Pattern "\.rpc\('([^']+)'" -AllMatches |
  ForEach-Object { $_.Matches | ForEach-Object { $_.Groups[1].Value } } |
  Sort-Object -Unique

$trace = Get-Content -Raw docs/RASTREABILIDADE.md
$rpcNames | Where-Object { -not $trace.Contains("`$_`") }
```

Expected: no RPC names printed.

- [ ] **Step 2: Compare Edge Functions**

```powershell
$functions = Get-ChildItem supabase/functions -Directory | Select-Object -ExpandProperty Name
$trace = Get-Content -Raw docs/RASTREABILIDADE.md
$functions | Where-Object { -not $trace.Contains("`$_`") }
```

Expected: no function names printed.

- [ ] **Step 3: Run docs check**

```powershell
npm run docs:check
```

Expected: route-coverage failures may remain because Plan 08 has not added the route/action table. There must be no missing-file or evidence-label failure for `docs/RASTREABILIDADE.md`.

- [ ] **Step 4: Check whitespace and commit**

```powershell
git diff --check
git add -- docs/RASTREABILIDADE.md
git commit -m "docs: map supabase contracts and security boundaries"
```

## Done Criteria

- Every string-literal client RPC appears in the contract inventory.
- Every direct client table has an RLS/policy summary or an explicit unresolved marker.
- Current definitions are distinguished from superseded migration history.
- Triggers, jobs, and both Edge Functions are mapped.
- Automated evidence is calibrated by test type.
- No product or database file changed.
