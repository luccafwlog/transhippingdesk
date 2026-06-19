# Traceability, Runtime Validation, and Final Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate all domain cartography into a route/action traceability index, validate critical flows in a safe runtime environment, record evidence, and close repository gates.

**Architecture:** Build `docs/RASTREABILIDADE.md` from the completed module catalogs, then execute risk-weighted browser/database scenarios. Runtime results are appended to the owning module and validation guide with explicit status; unavailable environments produce an honest `não executado` record, never inferred success.

**Tech Stack:** Markdown, Mermaid, React/Vite, in-app browser, Supabase, Vitest, npm gates, Git.

---

## Files

### Modify

- `docs/RASTREABILIDADE.md`
- `docs/README.md`
- `docs/ARCHITECTURE.md`
- `docs/operations/validacao.md`
- `docs/modules/*.md` only to add final `Runtime` evidence or correct a verified consolidation inconsistency

### Read

- All files under `docs/modules/`
- `src/App.tsx`
- `src/services/queryKeys.ts`
- `docs/superpowers/specs/2026-06-19-cartografia-tecnica-completa-design.md`
- `docs/archive/qa-audit-e2e-2026-06-12.md`

Do not modify product code, migrations, Edge Functions, environment files, or data outside a proven controlled environment.

### Task 1: Verify Domain Plan Completion

**Files:**

- Read: `docs/modules/*.md`

- [ ] **Step 1: Confirm all module contracts**

Run:

```powershell
$required = @(
  '## Propósito e escopo',
  '## Anatomia das telas',
  '## Catálogo de ações',
  '## Estado e dados',
  '## Fluxos e invariantes',
  '## Testes e validação',
  '## Notas e divergências'
)

Get-ChildItem docs/modules/*.md | ForEach-Object {
  $content = Get-Content -Raw $_.FullName
  foreach ($heading in $required) {
    if (-not $content.Contains($heading)) {
      Write-Error "$($_.Name): missing $heading"
    }
  }
}
```

Expected: exit `0` with no missing-heading errors.

- [ ] **Step 2: Confirm action table presence**

Run:

```powershell
Get-ChildItem docs/modules/*.md |
  Where-Object {
    -not (Select-String -Path $_.FullName -SimpleMatch '| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Falhas | Evidência |' -Quiet)
  } |
  Select-Object -ExpandProperty Name
```

Expected: no file paths printed.

- [ ] **Step 3: Stop on incomplete inputs**

If either check fails, do not compensate in the traceability index. Return to the owning domain plan and complete that module first.

### Task 2: Complete the Cross-Cutting Traceability Index

**Files:**

- Modify: `docs/RASTREABILIDADE.md`
- Read: `src/App.tsx`
- Read: `docs/modules/*.md`

- [ ] **Step 1: Preserve the contract inventory and verify the evidence legend**

Plan 07 creates the document header, evidence legend, and Supabase contract
inventory. Confirm it contains:

```markdown
# Rastreabilidade Técnica

Verificado contra o repositório em 2026-06-19.

Este índice liga cada rota e ação relevante ao caminho executável e ao documento
de módulo que contém a explicação completa. Ele é um mapa de navegação; regras de
negócio continuam pertencendo aos módulos e ADRs.

## Evidência

- **Código:** caminho confirmado por leitura do código executável.
- **Teste:** comportamento sustentado por uma asserção automatizada identificada.
- **Runtime:** comportamento observado em navegador/API/banco controlado.
- **Suspeita:** divergência plausível que ainda exige confirmação adicional.

Testes que apenas inspecionam o texto de migrations aparecem como “Teste de
contrato SQL”, não como prova funcional do banco.
```

Do not delete or duplicate the `Contratos Supabase` section.

- [ ] **Step 2: Add the canonical index table**

Use this exact schema:

```markdown
| Rota / superfície | Ação | Origem | Hook / serviço | RPC / tabela / integração | Efeito e cache | Evidência | Módulo |
|---|---|---|---|---|---|---|---|
```

Create at least one row for every literal route in `src/App.tsx`, including:

```text
/login
/portal/login
/portal/esqueci-senha
/portal/recuperar-senha
/portal
/portal/billing
/portal/operacao
/portal/perfil
/line-up-tv/display
/painel
/viagens
/viagens/:voyageId
/manifestos
/containers
/carga-solta
/veiculos
/manifestos/:blId
/revisao
/clientes
/clientes/:cnpj
/taxas-locais
/faturamento
/alertas
/relatorios
/line-up-tv
/demurrage
/demurrage/invoices
/demurrage/reconciliacao
/reconciliacao
/granito
/granito/taxas
/demurrage/taxas
/embarquevazios
/vazios
/vazios-importacao
/baplie
/chegadas-saidas
/admin/usuarios
```

For feature-rich routes, add multiple rows so each remote mutation family is discoverable. Redirect routes must name `Navigate` and their destination.

- [ ] **Step 3: Link every row to its module section**

The `Módulo` cell must use a relative link such as:

```markdown
[Faturamento](modules/faturamento.md#catálogo-de-ações)
```

Do not duplicate long explanations from module documents.

- [ ] **Step 4: Mechanically compare route coverage**

Run:

```powershell
npm run docs:check
```

Expected: no missing route, missing evidence-label, missing module-heading, ADR, or broken-link failures.

### Task 3: Update Documentation Navigation

**Files:**

- Modify: `docs/README.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Add traceability to “Por onde começar”**

Add:

```markdown
| Rastrear uma tela, botão, hook, serviço ou RPC | [RASTREABILIDADE.md](RASTREABILIDADE.md) |
```

- [ ] **Step 2: Update module-document convention**

Replace the old six-part module skeleton description with the seven approved headings and the evidence labels.

- [ ] **Step 3: Add an architecture pointer**

In `docs/ARCHITECTURE.md`, add a short section after the frontend-layer responsibilities:

```markdown
### Como rastrear uma interação

Use [`docs/RASTREABILIDADE.md`](./RASTREABILIDADE.md) para partir de uma rota ou
ação e localizar o componente, hook/serviço, contrato Supabase, efeitos de cache,
testes e evidência de runtime. A explicação completa permanece no documento vivo
do módulo proprietário.
```

- [ ] **Step 4: Verify links**

```powershell
npm run docs:check
```

Expected: exit `0`.

### Task 4: Determine Runtime Environment Safety

**Files:**

- Modify later: `docs/operations/validacao.md`

- [ ] **Step 1: Inspect local configuration without printing secrets**

Run:

```powershell
if (Test-Path .env) { 'Local .env exists' } else { 'Local .env missing' }
Get-ChildItem Env:VITE_SUPABASE_URL,Env:VITE_SUPABASE_ANON_KEY,Env:SUPABASE_RUN_INTEGRATION -ErrorAction SilentlyContinue |
  Select-Object Name,@{n='Configured';e={-not [string]::IsNullOrWhiteSpace($_.Value)}}
```

Expected: only presence booleans, never values.

- [ ] **Step 2: Classify the environment**

Use exactly one status:

```text
controlled — explicitly confirmed disposable/test project or branch
read-only — environment available but writes are not authorized
unavailable — no usable credentials/session
unknown — environment exists but cannot be proven safe
```

If status is `unknown`, STOP before any write and request user confirmation. Do not infer that a historical project ID is still a test environment.

- [ ] **Step 3: Start the application**

Run the Vite server in the background with a hidden process window:

```powershell
Start-Process -FilePath "npm.cmd" -ArgumentList @("run","dev","--","--host","127.0.0.1") -WorkingDirectory (Get-Location) -WindowStyle Hidden
```

Expected: local application becomes reachable. Use the in-app Browser for all browser automation.

### Task 5: Execute Authentication and Navigation Runtime Scenarios

**Files:**

- Modify: `docs/operations/validacao.md`
- Modify when evidence changes: `docs/modules/operacao-suporte.md`
- Modify when evidence changes: `docs/modules/portal-cliente.md`

- [ ] **Step 1: Always execute unauthenticated/public checks**

Verify:

```text
/login renders
/portal/login renders
/portal/esqueci-senha renders
/portal/recuperar-senha handles missing recovery tokens safely
unknown route redirects according to current auth state
```

Capture route, visible result, and console errors.

- [ ] **Step 2: Execute internal auth checks when session/credentials are authorized**

Verify:

```text
active internal login → /painel
non-admin → /admin/usuarios denied/redirected
logout → /login
```

- [ ] **Step 3: Execute Portal auth checks when authorized**

Verify:

```text
email login
CNPJ/CPF resolver login
invalid identifier/password generic error
Portal logout
internal and Portal sessions coexist in one browser
password recovery request without account enumeration
```

Do not trigger resolver rate-limit exhaustion outside a disposable environment.

### Task 6: Execute Critical Operational Runtime Scenarios

**Files:**

- Modify: `docs/operations/validacao.md`
- Modify as evidence requires: `docs/modules/viagens.md`
- Modify as evidence requires: `docs/modules/manifesto-edi.md`
- Modify as evidence requires: `docs/modules/operacao-suporte.md`

- [ ] **Step 1: Gate writes by environment status**

If status is not `controlled`, record all write scenarios below as:

```text
Não executado — requer ambiente Supabase controlado e fixtures descartáveis.
```

Continue with read-only navigation and state inspection.

- [ ] **Step 2: In a controlled environment, execute the integrated fixture flow**

Use only fixtures documented in `test-fixtures/README.md`:

```text
create/select QA voyage
import Baplie fixture
import manifest fixture
resolve one Baplie × manifest divergence
import vehicle fixture
inspect containers and B/L detail
exercise review gate until pending list clears
calculate charges and issue a QA invoice
```

Record every created ID/number immediately for cleanup.

- [ ] **Step 3: Exercise non-destructive support surfaces**

Verify:

```text
dashboard and line-up load
alerts filter
reports queries and export generation
Line-Up display refresh
review drawer opens and shows current pending reasons
```

Do not change real user roles or close real alerts.

### Task 7: Execute Critical Financial Runtime Scenarios

**Files:**

- Modify: `docs/operations/validacao.md`
- Modify as evidence requires: `docs/modules/taxas-locais.md`
- Modify as evidence requires: `docs/modules/faturamento.md`
- Modify as evidence requires: `docs/modules/reconciliacao-pix.md`
- Modify as evidence requires: `docs/modules/demurrage.md`
- Modify as evidence requires: `docs/modules/granito.md`

- [ ] **Step 1: Use only QA entities from Task 6**

Do not test financial mutations on pre-existing non-QA invoices, B/Ls, customers, or containers.

- [ ] **Step 2: Validate local charges and billing**

Verify:

```text
recalculation refreshes lines/subtotal
ready-for-billing guard blocks zero/non-eligible totals
individual invoice issue
print preview renders required fields and QR when payload exists
consolidatable receivables load when fixture data permits
```

- [ ] **Step 3: Validate PIX**

Use a generated QA workbook with:

```text
exact TXID/value
value mismatch
duplicate TXID
unmatched TXID
```

Verify ambiguous rows are not submitted and successful matches propagate to invoice/receivable/B/L.

- [ ] **Step 4: Validate demurrage when fixture data permits**

Verify:

```text
within-free-time calculation
overdue/returned calculation
invalid return-before-discharge rejection
invoice issue/print
```

- [ ] **Step 5: Validate Granite when a compatible fixture exists**

If no Granite fixture exists, record `não executado` rather than fabricating a workbook. If one exists, verify preview/import/customer pending state/charge calculation/invoice eligibility.

### Task 8: Execute Portal Data Runtime Scenarios

**Files:**

- Modify: `docs/operations/validacao.md`
- Modify as evidence requires: `docs/modules/clientes.md`
- Modify as evidence requires: `docs/modules/portal-cliente.md`

- [ ] **Step 1: Use a QA Portal account only**

If no QA account is available and environment is not controlled, mark Portal-authenticated scenarios `não executado`.

- [ ] **Step 2: Verify customer scoping and CE gate**

Verify:

```text
dashboard totals belong to QA customer
billing list/detail belongs to QA customer
operation list belongs to QA customer
B/L without CE Mercante is absent
```

- [ ] **Step 3: Verify self-service actions when safe**

Verify:

```text
create/obsolete consolidation only on QA receivables
open demurrage dispute only on QA invoice
mark notification read
update allowed profile fields and restore original QA values
```

### Task 9: Record Runtime Evidence

**Files:**

- Modify: `docs/operations/validacao.md`
- Modify: relevant `docs/modules/*.md`

- [ ] **Step 1: Add a dated execution section**

Append:

```markdown
## Evidência da cartografia — 2026-06-19

| Fluxo | Ambiente | Status | Resultado | Evidência / limitação |
|---|---|---|---|---|
```

Use only:

```text
executado
parcial
não executado
bloqueado
```

- [ ] **Step 2: Add `Runtime` labels to module claims**

Only add `Runtime` where the observed scenario directly proves the claim. Preserve `Código` and `Teste` labels when those evidence sources already support the same claim.

- [ ] **Step 3: Record cleanup**

List QA IDs created and the exact product/SQL cleanup performed. If cleanup remains, do not call the runtime task complete.

Never use the suspended reset script.

### Task 10: Final Static and Repository Verification

**Files:**

- Modify only files needed to correct a verified documentation inconsistency.

- [ ] **Step 1: Run traceability checks**

```powershell
npm run docs:check
```

Expected: exit `0`.

- [ ] **Step 2: Run focused integration only when configured**

If and only if `SUPABASE_RUN_INTEGRATION=1` and a controlled environment is confirmed:

```powershell
npm run test:integration
```

Expected: exit `0`.

Otherwise record:

```text
Integração Supabase não executada: ambiente controlado não configurado.
```

- [ ] **Step 3: Run all required gates**

Run separately:

```powershell
npm run lint
npm test
npm run build
git diff --check
```

Expected: every command exits `0`.

- [ ] **Step 4: Audit scope**

```powershell
git diff 35495d1..HEAD --name-only
```

Expected: no product source file, migration, Edge Function, or generated database type changed.

- [ ] **Step 5: Commit consolidation**

```powershell
git add -- docs/RASTREABILIDADE.md docs/README.md docs/ARCHITECTURE.md docs/operations/validacao.md docs/modules
git commit -m "docs: complete technical cartography"
```

## Final Done Criteria

- `docs/RASTREABILIDADE.md` contains every route from `src/App.tsx`.
- All module docs satisfy the seven-heading contract.
- Runtime status is explicit for every critical flow family.
- Findings are calibrated as `Código`, `Teste`, `Runtime`, or `Suspeita`.
- `npm run docs:check`, lint, tests, build, and whitespace checks pass.
- No product or database behavior changed.
