# Documentation Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the repository documentation into an authoritative, current, navigable, and mechanically verified system without rewriting historical records.

**Architecture:** Keep living documentation, architectural decisions, and historical snapshots as separate layers. Add a documentation checker that derives routes from `src/App.tsx`, verifies ADR indexing and relative links, and blocks known stale claims in normative files.

**Tech Stack:** Markdown, Node.js ESM, npm scripts, GitHub Actions, React Router source inspection, Supabase migration history.

---

## File Structure

### Create

- `docs/README.md` — central documentation map and authority contract.
- `docs/adr/README.md` — ADR catalog, status, and supersession index.
- `docs/adr/0013-portal-auth-identificador-resolvido-e-excecao-anon.md` — current Portal authentication decision.
- `scripts/check-docs.mjs` — documentation integrity checker.

### Modify

- `README.md` — concise product entry point and current setup.
- `CONTEXT.md` — domain glossary with unambiguous Portal terminology.
- `WORKFLOW.md` — current developer and operations workflow.
- `docs/ARCHITECTURE.md` — current architecture and complete route map.
- `docs/ROADMAP.md` — verified baseline, active evolution, backlog, and risks.
- `docs/VALIDACAO.md` — current technical and functional validation matrix.
- `docs/RESET_AMBIENTE.md` — suspend the unsafe reset procedure.
- `supabase/scripts/reset_operational_data.sql` — add a prominent suspension warning without changing SQL behavior.
- `docs/adr/0001-portal-login-supabase-auth.md` — add partial-supersession metadata.
- `docs/adr/0011-revogacao-anon-security-definer-default-deny.md` — add partial-supersession metadata.
- `docs/adr/0012-viagens-master-detail-rota-dedicada.md` — mark the implemented decision accepted.
- `AGENTS.md` — project-specific documentation and verification rules.
- `CLAUDE.md` — Claude-specific entry point without duplicating `AGENTS.md`.
- `.claude/skills/import-parser.skill` — current spreadsheet package and upload guard.
- `.claude/skills/react-query-pattern.skill` — actual data-access conventions.
- `.claude/skills/invoice-pdf.skill` — actual browser-print architecture.
- `.claude/skills/supabase-migration.skill` — controlled pre-auth `anon` exception.
- `docs/TECHNICAL-AUDIT-2026-06-09.md` — historical snapshot banner.
- `docs/QA-AUDIT-E2E-2026-06-12.md` — historical snapshot banner.
- `plans/README.md` — completed-plan snapshot banner.
- `package.json` — expose `docs:check`.
- `.github/workflows/ci.yml` — run documentation checks in pull requests.

### Deliberately unchanged

- Existing migrations.
- Generated `src/types/database.ts`.
- Product code under `src/`.
- Historical plan/spec bodies.
- Reset SQL statements below the new warning.

---

### Task 1: Add the Documentation Integrity Gate

**Files:**

- Create: `scripts/check-docs.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the checker before updating documentation**

Create `scripts/check-docs.mjs` with this implementation:

```js
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules'])
const errors = []

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return []
    const absolutePath = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath]
  })
}

function relative(absolutePath) {
  return path.relative(root, absolutePath).replaceAll('\\', '/')
}

function addError(file, message) {
  errors.push(`${file}: ${message}`)
}

const markdownFiles = walk(root).filter((file) => /\.mdx?$/i.test(file))
const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g

for (const file of markdownFiles) {
  const content = fs.readFileSync(file, 'utf8')
  for (const match of content.matchAll(markdownLinkPattern)) {
    let target = match[1].trim()
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
    target = target.replace(/\s+["'][^"']*["']$/, '')
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue

    const pathPart = target.split('#')[0]
    if (!pathPart) continue

    let decoded
    try {
      decoded = decodeURIComponent(pathPart)
    } catch {
      addError(relative(file), `link has invalid URL encoding: ${target}`)
      continue
    }

    if (path.isAbsolute(decoded)) {
      addError(relative(file), `link must be repository-relative: ${target}`)
      continue
    }

    const resolved = path.resolve(path.dirname(file), decoded)
    if (!fs.existsSync(resolved)) {
      addError(relative(file), `broken relative link: ${target}`)
    }
  }
}

const requiredFiles = ['docs/README.md', 'docs/adr/README.md']
for (const requiredFile of requiredFiles) {
  if (!fs.existsSync(path.join(root, requiredFile))) {
    addError(requiredFile, 'required documentation index is missing')
  }
}

const adrDirectory = path.join(root, 'docs', 'adr')
const adrIndexPath = path.join(adrDirectory, 'README.md')
if (fs.existsSync(adrIndexPath)) {
  const adrIndex = fs.readFileSync(adrIndexPath, 'utf8')
  const adrFiles = fs.readdirSync(adrDirectory)
    .filter((name) => /^\d{4}-.+\.md$/i.test(name))
    .sort()

  for (const adrFile of adrFiles) {
    if (!adrIndex.includes(adrFile)) {
      addError('docs/adr/README.md', `ADR is not indexed: ${adrFile}`)
    }
  }
}

const appRoutes = [...read('src/App.tsx').matchAll(/<Route\s+path="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((route) => route !== '*')
const architecture = read('docs/ARCHITECTURE.md')

for (const route of appRoutes) {
  if (!architecture.includes(`\`${route}\``)) {
    addError('docs/ARCHITECTURE.md', `route from src/App.tsx is not documented: ${route}`)
  }
}

const livingFiles = [
  'README.md',
  'CONTEXT.md',
  'WORKFLOW.md',
  'AGENTS.md',
  'CLAUDE.md',
  'docs/README.md',
  'docs/ARCHITECTURE.md',
  'docs/ROADMAP.md',
  'docs/VALIDACAO.md',
  'docs/RESET_AMBIENTE.md',
  '.claude/skills/import-parser.skill',
  '.claude/skills/react-query-pattern.skill',
  '.claude/skills/invoice-pdf.skill',
  '.claude/skills/supabase-migration.skill',
]

const staleClaims = [
  {
    pattern: /001_schema\.sql\s*(?:→|->)\s*053_security_hardening\.sql/i,
    message: 'fixed migration range ending at 053 is obsolete',
  },
  {
    pattern: /\b053 migrations\b/i,
    message: 'fixed migration count 053 is obsolete',
  },
  {
    pattern: /fallback(?: de)? token|token legacy em `sessionStorage`/i,
    message: 'legacy Portal token fallback is obsolete',
  },
  {
    pattern: /\bjspdf\b/i,
    message: 'jsPDF is not used; invoices print through the browser',
  },
]

for (const livingFile of livingFiles) {
  const absolutePath = path.join(root, livingFile)
  if (!fs.existsSync(absolutePath)) continue
  const content = fs.readFileSync(absolutePath, 'utf8')
  for (const claim of staleClaims) {
    if (claim.pattern.test(content)) addError(livingFile, claim.message)
  }
}

if (errors.length > 0) {
  console.error(`Documentation check failed with ${errors.length} issue(s):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log(
    `Documentation checks passed: ${markdownFiles.length} Markdown files, ` +
    `${appRoutes.length} routes, and ADR index coverage verified.`,
  )
}
```

- [ ] **Step 2: Expose the checker through npm**

Add this script to `package.json` immediately before `build`:

```json
"docs:check": "node scripts/check-docs.mjs",
```

- [ ] **Step 3: Run the checker and confirm the intended red state**

Run:

```powershell
npm run docs:check
```

Expected: exit code 1. The output must include missing `docs/README.md`,
missing `docs/adr/README.md`, undocumented routes, and obsolete normative
claims. A syntax error or stack trace is not an acceptable red state.

- [ ] **Step 4: Add the gate to pull-request CI**

In `.github/workflows/ci.yml`, insert this step after dependency installation
and before lint:

```yaml
      - name: Documentation
        run: npm run docs:check
```

- [ ] **Step 5: Verify only the intended gate files changed**

Run:

```powershell
git diff --check
git diff --stat -- scripts/check-docs.mjs package.json .github/workflows/ci.yml
```

Expected: no whitespace errors; exactly the checker, npm script, and CI file
appear in this task.

- [ ] **Step 6: Commit**

```powershell
git add -- scripts/check-docs.mjs package.json .github/workflows/ci.yml
git commit -m "test(docs): add documentation integrity gate"
```

---

### Task 2: Establish Documentation Authority and ADR Governance

**Files:**

- Create: `docs/README.md`
- Create: `docs/adr/README.md`
- Create: `docs/adr/0013-portal-auth-identificador-resolvido-e-excecao-anon.md`
- Modify: `docs/adr/0001-portal-login-supabase-auth.md`
- Modify: `docs/adr/0011-revogacao-anon-security-definer-default-deny.md`
- Modify: `docs/adr/0012-viagens-master-detail-rota-dedicada.md`

- [ ] **Step 1: Create the central documentation map**

Create `docs/README.md` with these sections and facts:

```markdown
# Documentação do Transhipping Desk

Verificado contra o repositório em 2026-06-18.

## Qual documento consultar

| Pergunta | Fonte canônica |
|---|---|
| O que o produto faz e como começar? | [`README.md`](../README.md) |
| O que um termo de negócio significa? | [`CONTEXT.md`](../CONTEXT.md) |
| Como o sistema está estruturado? | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| Como desenvolver, testar e publicar? | [`WORKFLOW.md`](../WORKFLOW.md) |
| O que existe, evolui e está no backlog? | [`ROADMAP.md`](./ROADMAP.md) |
| Como validar um fluxo? | [`VALIDACAO.md`](./VALIDACAO.md) |
| Quais decisões arquiteturais estão vigentes? | [`adr/README.md`](./adr/README.md) |
| O reset de testes pode ser executado? | [`RESET_AMBIENTE.md`](./RESET_AMBIENTE.md) |

## Hierarquia de autoridade

1. Código, migrations e configuração executável descrevem o comportamento atual.
2. Os documentos vivos acima explicam esse comportamento.
3. ADRs explicam decisões e sua evolução.
4. Auditorias, specs e planos datados são snapshots históricos.

Quando houver divergência, confirme o estado executável e corrija o documento
vivo. Não reescreva silenciosamente um snapshot histórico.

## Registros históricos

- `TECHNICAL-AUDIT-*.md` e `QA-AUDIT-*.md`: achados na data indicada.
- `design-audit/`: auditoria visual e evidências.
- `superpowers/specs/` e `superpowers/plans/`: desenhos e planos de mudanças.
- `plans/` e `docs/plans/`: planos de implementação e acompanhamento.

## Manutenção

Mudanças em rotas, contratos de autenticação, migrations, comandos, deploy,
procedimentos operacionais ou decisões arquiteturais devem atualizar a fonte
viva correspondente. Execute `npm run docs:check` antes de abrir um PR.
```

- [ ] **Step 2: Create the ADR index**

Create `docs/adr/README.md` with one row for every ADR 0001–0013. Use status
`aceito` for 0001–0013, with these relationship notes:

- 0001: “supersedida parcialmente pela 0013 quanto ao identificador de login”;
- 0011: “supersedida parcialmente pela 0013 quanto à allowlist `anon`”;
- 0012: “implementada em 2026-06-16”;
- 0013: “decisão vigente para autenticação do Portal”.

Every title must be a relative link containing the exact ADR filename so the
checker can prove complete index coverage.

- [ ] **Step 3: Record the current Portal authentication decision**

Create `docs/adr/0013-portal-auth-identificador-resolvido-e-excecao-anon.md`
with:

```markdown
# 0013 — Portal via Supabase Auth com identificador resolvido antes do login

Status: aceito — 2026-06-18

Supersede parcialmente:

- ADR 0001: o Portal não é mais exclusivamente email + senha na interface;
- ADR 0011: a allowlist `anon` não é mais vazia.

## Contexto

O Portal usa Supabase Auth e uma sessão isolada pelo cliente `supabasePortal`.
Para preservar o acesso por documento, a interface aceita CNPJ, CPF ou email.
Antes de `signInWithPassword`, documentos são resolvidos para o email técnico
da conta por `portal_resolve_login(text)`.

## Decisão

- Supabase Auth continua sendo o único mecanismo de sessão do Portal.
- CNPJ, CPF e email são identificadores de entrada; não são mecanismos de
  autenticação distintos.
- `portal_resolve_login(text)` é a única exceção pré-autenticação documentada
  ao default-deny de `anon`.
- A exceção deve permanecer limitada por hash do identificador, janela de
  tentativas, erro genérico e teste de migration.
- RPCs que retornam dados do cliente continuam exigindo usuário autenticado e
  escopo por `auth.uid()`.
- O fluxo antigo de senha própria em tabela e sessão por token não volta a ser
  aceito.

## Consequências

- A interface mantém conveniência sem reintroduzir uma segunda sessão.
- O email técnico pode ser resolvido internamente antes do login, aumentando a
  necessidade de rate limit e respostas não enumeráveis.
- Qualquer nova função pré-autenticação exige ADR ou atualização desta decisão,
  grant explícito e teste de segurança.
```

- [ ] **Step 4: Add supersession metadata to earlier ADRs**

Immediately after the status line:

- in ADR 0001, add:

```markdown
Supersedida parcialmente pela ADR 0013 quanto ao identificador aceito na tela
de login. Supabase Auth continua sendo o mecanismo de autenticação e sessão.
```

- in ADR 0011, add:

```markdown
Supersedida parcialmente pela ADR 0013: `portal_resolve_login(text)` é a exceção
pré-autenticação explícita e limitada para `anon`.
```

- in ADR 0012, replace `Status: proposto — 2026-06-16` with:

```markdown
Status: aceito e implementado — 2026-06-16
```

- [ ] **Step 5: Verify ADR and link coverage**

Run:

```powershell
npm run docs:check
```

Expected: missing-index and unindexed-ADR errors disappear. Route and stale
normative-claim errors remain until later tasks.

- [ ] **Step 6: Commit**

```powershell
git add -- docs/README.md docs/adr
git commit -m "docs: establish authority and ADR governance"
```

---

### Task 3: Rebuild the Product Entry Point, Glossary, and Architecture

**Files:**

- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Rewrite the root README as a concise entry point**

Keep these sections:

1. product summary and stack from `package.json`;
2. capability groups rather than an incomplete route catalog;
3. local start using `npm ci --legacy-peer-deps`, `.env.example`, and
   `npm run dev`;
4. required environment variables;
5. standard commands including `npm run docs:check`;
6. migration guidance that says to apply every pending migration in controlled
   order and verify with the Supabase migration history;
7. actual CI/deploy sequence;
8. links to `docs/README.md` and the canonical documents.

The migration section must say:

```markdown
Não aplique um intervalo fixo de arquivos manualmente. O diretório contém
migrations históricas sequenciais e migrations por timestamp. Compare o
histórico remoto com `supabase/migrations/` e aplique todas as pendentes por um
fluxo controlado do Supabase. O CI da SPA não aplica migrations.
```

The Portal summary must say that it uses Supabase Auth and accepts CNPJ, CPF, or
email as the login identifier.

The CI section must reflect:

```text
pull_request -> CI (docs, lint, build, tests)
workflow_run successful -> squash merge -> build -> Firebase deploy
push direct to main -> build -> Firebase deploy
```

- [ ] **Step 2: Correct Portal terms in the domain glossary**

Preserve `CONTEXT.md` as definitions only. Replace the Portal definitions with:

- **Conta de Portal**: relation between one customer and one Supabase Auth user;
- **Identificador de Login do Portal**: CNPJ, CPF, or email entered by the user;
- **Email Técnico do Portal**: email stored in the account and used internally
  by Supabase Auth;
- **Sessão do Portal**: Supabase Auth session isolated from the internal app;
- **Login do Portal**: identifier resolution followed by
  `signInWithPassword`, without legacy table-password or token session.

Retain the business definitions for dispute, notification, and dashboard.
Remove implementation field names except where they disambiguate a domain
concept.

- [ ] **Step 3: Rewrite the architecture around verified boundaries**

`docs/ARCHITECTURE.md` must contain:

- verification date 2026-06-18;
- browser SPA, Supabase, Edge Functions, external integrations, and Firebase;
- two isolated Supabase clients;
- operational flow from voyage/import through review, billing, reconciliation,
  and Portal;
- master-detail `/viagens/:voyageId`;
- vessel schedule management `/chegadas-saidas` feeding the Portal widget;
- current Portal dashboard, billing, operation, profile, and password recovery;
- printing through `window.print()`;
- migrations as the database history and RLS/RPC as the security boundary.

Include every literal route from `src/App.tsx`, including redirects:

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

Mark `/vazios`, `/demurrage/invoices`, and `/demurrage/reconciliacao` as
compatibility redirects.

- [ ] **Step 4: Run the gate**

```powershell
npm run docs:check
```

Expected: all route-coverage errors disappear. Remaining failures may only come
from normative files not yet updated.

- [ ] **Step 5: Commit**

```powershell
git add -- README.md CONTEXT.md docs/ARCHITECTURE.md
git commit -m "docs: align product overview and architecture"
```

---

### Task 4: Rewrite the Living Development Workflow

**Files:**

- Modify: `WORKFLOW.md`

- [ ] **Step 1: Replace stale architecture claims**

Rewrite `WORKFLOW.md` with these sections:

1. purpose and document authority;
2. verified stack from `package.json`;
3. runtime architecture and authentication boundaries;
4. directory responsibilities;
5. development setup;
6. migrations;
7. tests and validation;
8. CI and deploy;
9. adding routes, data access, imports, and invoice documents;
10. security and operational guardrails;
11. links to architecture, glossary, ADRs, roadmap, and validation.

Use these exact current conventions:

- spreadsheet code imports `@e965/xlsx`, normally through dynamic import;
- printable invoices are styled React components printed with
  `window.print()`;
- shared invoice blocks live in
  `src/components/shared/InvoiceDocumentKit.tsx`;
- the Supabase clients live in `src/services/supabase.ts`;
- React Query keys should come from `src/services/queryKeys.ts` where a shared
  key exists;
- pages currently use both hooks and direct service calls, so service→hook is a
  preferred pattern for reusable remote state, not an absolute invariant;
- migrations use both historical sequential names and current timestamp names;
- all pending migrations must be applied before dependent frontend code;
- Portal sessions use Supabase Auth only, with CNPJ/CPF/email resolution before
  login;
- the PR workflow runs documentation, lint, build, and tests before merge.

- [ ] **Step 2: Remove volatile or false counts**

Do not claim a fixed number of tables, functions, migrations, pages, or tests.
When useful, provide the command that derives it:

```powershell
(Get-ChildItem supabase/migrations -File -Filter *.sql).Count
```

- [ ] **Step 3: Verify stale claims are gone**

Run:

```powershell
rg -n -i "fallback token|sessionStorage|jspdf|053 migrations|90\\+ migrations" WORKFLOW.md
npm run docs:check
```

Expected: `rg` returns no matches; documentation checker has no
`WORKFLOW.md` errors.

- [ ] **Step 4: Commit**

```powershell
git add -- WORKFLOW.md
git commit -m "docs: rewrite the living development workflow"
```

---

### Task 5: Refresh Roadmap and Validation, Suspend Unsafe Reset

**Files:**

- Modify: `docs/ROADMAP.md`
- Modify: `docs/VALIDACAO.md`
- Modify: `docs/RESET_AMBIENTE.md`
- Modify: `supabase/scripts/reset_operational_data.sql`

- [ ] **Step 1: Refresh the roadmap against the 2026-06-18 baseline**

`docs/ROADMAP.md` must distinguish:

- **Em produção:** current modules, expanded Portal, master-detail voyages,
  CE Mercante visibility gate, automatic invoice attempt after review,
  hardened CI, Sentry initialization, and `@e965/xlsx`;
- **Em evolução:** E2E automation, live Supabase validation, large-page
  decomposition, Portal auth abuse monitoring, and migration drift control;
- **Backlog:** voyage-leg formalization, consolidated voyage report, stronger
  Portal authentication, and a validated reset tool;
- **Active risks:** manual migration application, incomplete automated E2E,
  destructive reset suspended, and current dev-only `undici` advisory through
  jsdom.

Do not repeat the resolved npm `xlsx` vulnerability. Record that
`npm audit --omit=dev` was clean on 2026-06-18 and that the remaining advisory
is in the development test stack.

- [ ] **Step 2: Rewrite the validation matrix around current flows**

Update `docs/VALIDACAO.md` to use:

```powershell
npm ci --legacy-peer-deps
npm run docs:check
npm run lint
npm test
npm run build
```

Add or update validation sections for:

- internal login and roles;
- voyage master-detail and invalid voyage IDs;
- all import families and Baplie reconciliation;
- review and automatic invoice attempt;
- local-charge invoiceability guard;
- billing, ledger, partial/refund/reversal flows;
- Demurrage;
- unified PIX reconciliation;
- Portal login by CNPJ/CPF/email;
- password recovery;
- Portal dashboard, invoices, B/Ls and containers, notifications, disputes,
  profile, CSV/XLSX exports, and CE Mercante gate;
- vessel schedules at `/chegadas-saidas`;
- admin, reports, alerts, and Line Up;
- compatibility redirects;
- evidence fields and cleanup rules.

State that remote Supabase validation is required for Auth, RLS, RPCs,
Edge Functions, and destructive/database workflows.

- [ ] **Step 3: Suspend the reset procedure**

Replace `docs/RESET_AMBIENTE.md` with:

```markdown
# Reset do Ambiente de Testes

**Status: suspenso em 2026-06-18. Não execute o script atual.**

O arquivo `supabase/scripts/reset_operational_data.sql` cobre o modelo antigo,
mas não declara a limpeza e a ordem de dependência de ledger, Demurrage,
Granito, Vazios, notificações/disputas do Portal e outras tabelas recentes.
Executá-lo pode falhar por FKs ou produzir um ambiente parcialmente limpo.

## Alternativa segura

- Use um projeto Supabase descartável ou uma branch de banco.
- Identifique os dados pelo prefixo/viagem de QA.
- Remova-os pelos fluxos do produto ou por SQL revisado para aquela fixture.
- Nunca execute limpeza ampla em produção.

## Consultas de diagnóstico

Inclua consultas `COUNT(*)` somente de leitura para `import_batches`, `bls`,
`bl_containers`, `invoices`, `bl_receivables`, `ledger_settlements`,
`demurrage_invoices`, `granite_bls`, `vazios_bookings`,
`vazios_importacao_containers`, `portal_notifications` e `audit_logs`.

## Reativação

O procedimento só pode voltar a ser “oficial” após:

1. mapear todas as FKs e a ordem de remoção;
2. executar em banco descartável com dados de todos os módulos;
3. provar preservação de cadastros estruturais;
4. documentar rollback ou restauração.
```

Use SQL `SELECT 'table' AS table_name, COUNT(*) ... UNION ALL` for the listed
diagnostic tables. Do not include `TRUNCATE`, `DELETE`, or mutation statements.

- [ ] **Step 4: Add a warning to the SQL script without changing its statements**

At the top of `supabase/scripts/reset_operational_data.sql`, above the current
comments, add:

```sql
-- SUSPENSO EM 2026-06-18: NAO EXECUTAR.
-- Este script nao cobre todas as tabelas e dependencias do schema atual.
-- Consulte docs/RESET_AMBIENTE.md. As instrucoes abaixo sao preservadas apenas
-- como registro historico ate existir uma substituicao validada em banco
-- descartavel.
```

- [ ] **Step 5: Verify the suspension is unambiguous**

Run:

```powershell
rg -n "suspenso|Não execute|NAO EXECUTAR" docs/RESET_AMBIENTE.md supabase/scripts/reset_operational_data.sql
rg -n "TRUNCATE|DELETE" docs/RESET_AMBIENTE.md
```

Expected: both files display suspension warnings; the documentation contains no
destructive SQL.

- [ ] **Step 6: Commit**

```powershell
git add -- docs/ROADMAP.md docs/VALIDACAO.md docs/RESET_AMBIENTE.md supabase/scripts/reset_operational_data.sql
git commit -m "docs: refresh validation and suspend unsafe reset"
```

---

### Task 6: Align Agent Instructions and Project Playbooks

**Files:**

- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `.claude/skills/import-parser.skill`
- Modify: `.claude/skills/react-query-pattern.skill`
- Modify: `.claude/skills/invoice-pdf.skill`
- Modify: `.claude/skills/supabase-migration.skill`

- [ ] **Step 1: Add project-specific rules to AGENTS.md**

Keep the existing four behavioral sections. Add:

```markdown
## 5. Project Sources of Truth

- `CONTEXT.md` defines domain language.
- `docs/ARCHITECTURE.md` defines current architecture and routes.
- `docs/adr/README.md` indexes accepted and superseded decisions.
- `WORKFLOW.md` defines development, migrations, testing, and deploy.
- Dated audits, specs, and plans are historical snapshots, not current truth.

Read the relevant source before changing domain behavior, authentication,
security boundaries, billing, imports, routes, or database schema.

## 6. Documentation Contract

Update living documentation in the same change when modifying routes, commands,
environment variables, migrations, auth contracts, operational procedures, or
architectural decisions. Preserve historical records; use a new ADR or an
editorial note for later decisions.

## 7. Verification

Run the narrowest relevant checks while working. Before completion, run
`npm run docs:check`, `npm run lint`, `npm test`, and `npm run build` when the
change can affect them. Never execute the suspended reset script.
```

- [ ] **Step 2: Make CLAUDE.md a concise Claude-specific entry point**

Replace duplicated behavioral prose with:

```markdown
# CLAUDE.md

Follow [`AGENTS.md`](./AGENTS.md) as the canonical behavioral and project
instruction file.

## Claude Code integration

- Project playbooks live in `.claude/skills/`.
- Hooks in `.claude/hooks/` guard destructive commands, protected files, and
  edited TypeScript linting.
- `src/types/database.ts`, `src/lib/pix.ts`, and existing migration files are
  protected; do not bypass the guard without explicit authorization.
- Read `docs/README.md` before broad documentation or architecture changes.
- Run `npm run docs:check` after changing Markdown, routes, ADRs, or playbooks.

The executable repository is authoritative when a historical document differs
from current behavior. Correct the living document and preserve the historical
record.
```

- [ ] **Step 3: Correct the import parser playbook**

Update `.claude/skills/import-parser.skill` so it:

- imports spreadsheet support with `await import('@e965/xlsx')`;
- calls `assertUploadSize(file)` before `arrayBuffer()` or spreadsheet parsing;
- points to `src/services/supabase.ts`;
- uses timestamp migrations;
- treats a React Query hook as preferred when remote state is reused, while
  allowing a page event handler to call a focused import service directly when
  matching existing code;
- requires parser fixture tests before browser validation.

- [ ] **Step 4: Correct the React Query playbook**

Update `.claude/skills/react-query-pattern.skill` to state:

- services own reusable Supabase/domain operations;
- hooks own reusable query lifecycle and shared mutations;
- pages may call services directly for one-shot imports, exports, commands,
  or legacy flows, so the split is not an invariant;
- never add new raw Supabase access in a page when a service/hook already owns
  that operation;
- use `src/services/supabase.ts` and centralized `queryKeys` where available;
- invalidation must be tested against the exact prefix shape.

Use `listInvoicesForExport()` as an example of an acceptable one-shot service
call and `useBilling()` as an example of reusable server state.

- [ ] **Step 5: Correct the invoice print playbook**

Update `.claude/skills/invoice-pdf.skill` to:

- call the artifact “printable invoice document”;
- identify `InvoiceDocumentLocal.tsx` and
  `demurrage/InvoiceDocument.tsx` as the two implementations;
- require reuse of `InvoiceDocumentKit.tsx` and `invoiceFormat.ts`;
- document `window.print()` and `src/index.css` print rules;
- forbid adding a PDF library without an explicit product requirement;
- require one-item and multi-page print-preview checks;
- require PIX QR rendering when a persisted payload exists;
- avoid claiming automatic page numbering or repeated headers unless the CSS
  and rendered output prove them.

- [ ] **Step 6: Document controlled `anon` exceptions in the migration playbook**

After the default-deny rule in `.claude/skills/supabase-migration.skill`, add:

```markdown
The current documented exception is `portal_resolve_login(text)` (ADR 0013).
Any pre-authentication function granted to `anon` must have an explicit
business reason, generic non-enumerating errors, abuse controls, a focused
migration test, and an ADR or ADR update. Never copy the exception to ordinary
Portal data RPCs.
```

- [ ] **Step 7: Verify playbooks against the repository**

Run:

```powershell
rg -n -i "from '../lib/supabase|from './lib/supabase|import\\('xlsx'\\)|jspdf|fallback token" AGENTS.md CLAUDE.md .claude/skills
npm run docs:check
```

Expected: no stale-path/package/auth matches and no documentation-check errors
from agent instructions or playbooks.

- [ ] **Step 8: Commit**

```powershell
git add -- AGENTS.md CLAUDE.md .claude/skills/import-parser.skill .claude/skills/react-query-pattern.skill .claude/skills/invoice-pdf.skill .claude/skills/supabase-migration.skill
git commit -m "docs: align agent instructions with repository practice"
```

---

### Task 7: Label Historical Snapshots Without Rewriting Them

**Files:**

- Modify: `docs/TECHNICAL-AUDIT-2026-06-09.md`
- Modify: `docs/QA-AUDIT-E2E-2026-06-12.md`
- Modify: `plans/README.md`

- [ ] **Step 1: Add a snapshot banner to the technical audit**

After the title, add:

```markdown
> **Snapshot histórico:** este relatório descreve o repositório e o banco na
> data indicada. Achados podem ter sido corrigidos depois. Para o estado atual,
> consulte [`docs/README.md`](./README.md), o código e as migrations.
```

- [ ] **Step 2: Add a snapshot banner to the QA audit**

After the title, add the same banner, preserving the rest of the execution
record unchanged.

- [ ] **Step 3: Mark the root plan set as completed historical work**

After the title in `plans/README.md`, add:

```markdown
> **Snapshot histórico:** estes cinco planos foram gerados em 2026-06-15 e
> estão concluídos. O status atual do produto vive em
> [`docs/ROADMAP.md`](../docs/ROADMAP.md).
```

- [ ] **Step 4: Verify the historical bodies did not drift**

Run:

```powershell
git diff --word-diff=porcelain -- docs/TECHNICAL-AUDIT-2026-06-09.md docs/QA-AUDIT-E2E-2026-06-12.md plans/README.md
```

Expected: only the three banners are added.

- [ ] **Step 5: Commit**

```powershell
git add -- docs/TECHNICAL-AUDIT-2026-06-09.md docs/QA-AUDIT-E2E-2026-06-12.md plans/README.md
git commit -m "docs: label dated audits and plans as snapshots"
```

---

### Task 8: Close the Documentation Gate and Run Full Verification

**Files:**

- Modify only files required to resolve a verified documentation-check failure.

- [ ] **Step 1: Run the complete documentation checker**

```powershell
npm run docs:check
```

Expected: exit code 0 with Markdown file count, route count, and ADR coverage.
If it fails, fix the documented file or the checker only when the failure is a
false positive demonstrable from repository state.

- [ ] **Step 2: Scan for the known contradictions**

Run:

```powershell
rg -n -i '001_schema\.sql.*053_security_hardening|053 migrations|fallback token|token legacy em `sessionStorage`|\bjspdf\b' README.md CONTEXT.md WORKFLOW.md AGENTS.md CLAUDE.md docs/README.md docs/ARCHITECTURE.md docs/ROADMAP.md docs/VALIDACAO.md docs/RESET_AMBIENTE.md .claude/skills
```

Expected: no matches.

- [ ] **Step 3: Reconcile routes, migrations, scripts, and workflows**

Run:

```powershell
rg -n 'path="/' src/App.tsx
rg -n '^\\| `/|`/[^`]+`' docs/ARCHITECTURE.md
(Get-ChildItem supabase/migrations -File -Filter *.sql).Count
Get-Content -Raw package.json
Get-Content -Raw .github/workflows/ci.yml
Get-Content -Raw .github/workflows/auto-merge-prs.yml
Get-Content -Raw .github/workflows/firebase-deploy.yml
```

Expected: architecture contains every route; living docs do not claim a fixed
migration endpoint; npm and CI descriptions match executable files.

- [ ] **Step 4: Run repository gates**

Run each command separately:

```powershell
npm run lint
npm test
npm run build
```

Expected: all commands exit 0. Record actual test counts from the fresh output;
do not copy historical counts into living documentation.

- [ ] **Step 5: Check patch hygiene**

```powershell
git diff --check
git status --short
git diff --stat 308335d..HEAD
git diff --name-only 308335d..HEAD
```

Expected:

- no whitespace errors;
- no `src/` product files, migrations, or generated database types changed;
- only planned documentation, checker, npm, CI, and reset-warning files changed.

- [ ] **Step 6: Commit any final verification-only corrections**

If Task 8 required corrections:

```powershell
git add -- <only-the-corrected-files>
git commit -m "docs: close documentation verification gaps"
```

If no corrections were needed, do not create an empty commit.

- [ ] **Step 7: Final requirement audit**

Re-read
`docs/superpowers/specs/2026-06-18-documentation-architecture-design.md` and map
each requirement to:

- a changed file;
- a passing checker rule;
- or a fresh verification command.

Completion requires evidence for authority mapping, living-doc accuracy, ADR
supersession, historical labeling, playbook alignment, reset suspension, route
coverage, link integrity, CI integration, lint, tests, and build.

---

## Plan Self-Review

### Specification coverage

- Authority and navigation: Tasks 2–4.
- Living documentation accuracy: Tasks 3–5.
- ADR history and supersession: Task 2.
- Historical snapshot preservation: Task 7.
- Agent and playbook alignment: Task 6.
- Automated documentation verification: Tasks 1 and 8.
- Reset safety: Task 5.
- Full repository verification: Task 8.

### Scope control

The plan changes no product behavior, existing migration, generated type, or
remote database state. The only non-document executable changes are the
read-only documentation checker, its npm entry, and its CI invocation.

### Naming consistency

- npm command: `docs:check`;
- checker path: `scripts/check-docs.mjs`;
- Portal ADR: `0013-portal-auth-identificador-resolvido-e-excecao-anon.md`;
- authority index: `docs/README.md`;
- ADR index: `docs/adr/README.md`.
