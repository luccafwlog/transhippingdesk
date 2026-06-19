# Complete Technical Cartography Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coordinate the complete developer-facing cartography of Transhipping Desk without changing product or database behavior.

**Architecture:** Execute one prerequisite plan, five disjoint domain plans, one exhaustive Supabase-contract plan, and one consolidation/runtime plan. Domain plans edit separate living module documents; the contract plan maps migrations/RLS/RPCs/Edge Functions; the final plan completes the cross-cutting traceability index, records runtime evidence, and closes all repository gates.

**Tech Stack:** Markdown, Mermaid, React/TypeScript source inspection, TanStack Query, Supabase migrations/RPC/RLS, Vitest, Node documentation checker, in-app browser.

---

## Source of Truth

- Approved design: `docs/superpowers/specs/2026-06-19-cartografia-tecnica-completa-design.md`
- Starting revision: `35495d1`
- Living module documents: `docs/modules/*.md`
- Executable routes: `src/App.tsx`
- Domain language: `docs/GLOSSARIO.md`
- Architecture and decisions: `docs/ARCHITECTURE.md`, `docs/adr/README.md`
- Workflow and gates: `WORKFLOW.md`, `AGENTS.md`

## Plan Set and Ownership

| Order | Plan | Exclusive write scope |
|---|---|---|
| 1 | `2026-06-19-cartografia-01-fundacao.md` | `scripts/check-docs.mjs`, broken skill-link files/templates |
| 2A | `2026-06-19-cartografia-02-operacao-suporte.md` | `docs/modules/operacao-suporte.md`, `docs/modules/chegadas-saidas.md` |
| 2B | `2026-06-19-cartografia-03-viagens-importacoes.md` | `docs/modules/viagens.md`, `docs/modules/manifesto-edi.md` |
| 2C | `2026-06-19-cartografia-04-clientes-portal.md` | `docs/modules/clientes.md`, `docs/modules/portal-cliente.md` |
| 2D | `2026-06-19-cartografia-05-financeiro-pix.md` | `docs/modules/taxas-locais.md`, `docs/modules/faturamento.md`, `docs/modules/reconciliacao-pix.md` |
| 2E | `2026-06-19-cartografia-06-demurrage-granito.md` | `docs/modules/demurrage.md`, `docs/modules/granito.md` |
| 2F | `2026-06-19-cartografia-07-contratos-supabase.md` | initial `docs/RASTREABILIDADE.md` contract inventory |
| 3 | `2026-06-19-cartografia-08-consolidacao-runtime.md` | complete `docs/RASTREABILIDADE.md`, `docs/README.md`, `docs/ARCHITECTURE.md`, `docs/operations/validacao.md`, final corrections |

Plans 2A–2F are independent after Plan 1 and may run in parallel. Plan 3 starts only after all six plans are complete.

## Shared Documentation Contract

Every module document must contain these top-level sections exactly:

```markdown
## Propósito e escopo
## Anatomia das telas
## Catálogo de ações
## Estado e dados
## Fluxos e invariantes
## Testes e validação
## Notas e divergências
```

Each catalogued action must expose:

```markdown
| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Falhas | Evidência |
```

Use evidence labels consistently:

- `Código`
- `Teste`
- `Runtime`
- `Suspeita`

Do not label migration-regex tests as functional database proof. Use wording such as `Teste de contrato SQL` or `Teste de drift`.

## Execution Rules

- Do not edit `src/`, existing migrations, Edge Functions, generated types, product CSS, or runtime configuration.
- Do not apply migrations or run `supabase/scripts/reset_operational_data.sql`.
- Historical files under `docs/archive/` are read-only evidence.
- When a current claim conflicts with a historical audit, verify the current source and document the present state.
- Record uncertain behavior as `Suspeita`; do not turn it into a bug claim without evidence.
- Use relative Markdown links.
- Use Mermaid only for flows with at least three meaningful transitions or branches.
- Commit each completed plan separately using the commit message specified in that plan.

## Master Verification

- [ ] **Step 1: Confirm every plan file exists**

Run:

```powershell
Get-ChildItem docs/superpowers/plans/2026-06-19-cartografia-*.md |
  Sort-Object Name |
  Select-Object -ExpandProperty Name
```

Expected: the master plan plus plans `01` through `08`.

- [ ] **Step 2: Confirm domain write scopes do not overlap**

Run:

```powershell
$entries = Get-ChildItem docs/superpowers/plans/2026-06-19-cartografia-0[2-6]-*.md |
  ForEach-Object {
    $planName = $_.Name
    $content = Get-Content -Raw $_.FullName
    [regex]::Matches($content, '`(docs/modules/[^`]+\.md)`') |
      ForEach-Object { $_.Groups[1].Value } |
      Sort-Object -Unique |
      ForEach-Object {
        [pscustomobject]@{ Plan = $planName; Module = $_ }
      }
  }

$entries | Sort-Object Module | Format-Table -AutoSize
$entries | Group-Object Module | Where-Object Count -gt 1
```

Expected: the table contains all 11 module files and the duplicate query prints nothing.

- [ ] **Step 3: Execute plans in dependency order**

Execution order:

```text
01 foundation
  └─ 02 operation/support
  └─ 03 voyages/imports
  └─ 04 customers/portal
  └─ 05 finance/PIX
  └─ 06 demurrage/granite
  └─ 07 Supabase contracts
       └─ 08 consolidation/runtime
```

Expected: Plan 1 completes first; Plans 2–6 complete before Plan 7.

- [ ] **Step 4: Audit the final diff against the design**

Run:

```powershell
git diff 35495d1..HEAD --name-only
```

Expected: only documentation, documentation tooling, and the two missing skill-format templates are changed. No path under `src/`, `supabase/migrations/`, or `supabase/functions/` appears.

- [ ] **Step 5: Run the final gates**

Run separately:

```powershell
npm run docs:check
npm run lint
npm test
npm run build
git diff --check 35495d1..HEAD
```

Expected: every command exits `0`.

## Completion

The master plan is complete only when:

- all 11 living module documents follow the contract;
- all executable routes are represented in `docs/RASTREABILIDADE.md`;
- every critical runtime scenario has `executado`, `não executado`, or `bloqueado` status with a reason;
- all findings have evidence labels and confidence;
- final gates pass;
- product code and database behavior remain unchanged.

## Plan Self-Review

### Specification coverage

- Developer audience and action-first organization: Plans 02–06.
- Standard module contract and evidence labels: Plan 01 checker plus Plans 02–06.
- Route/action reverse index: Plan 07.
- Static trace from UI to database/tests: Plans 02–06.
- Risk-weighted runtime validation: Plan 07.
- Findings calibrated as confirmed or suspected: shared contract plus Plan 07.
- Required repository gates and no product changes: Plan 07 and master verification.

### Dependency check

- Plan 01 must land before the domain plans because it defines the red/green documentation contract.
- Plans 02–06 have disjoint module-document write scopes.
- Plan 07 performs the exhaustive executable database-contract inventory without editing module files.
- Plan 08 depends on every domain catalog and Plan 07, and is the only plan allowed to consolidate runtime evidence across module files.

### Scope check

The plan set changes living documentation, the documentation checker, and two
missing skill-reference templates. It does not authorize product code, database,
deployment, or migration changes.
