# Technical Cartography Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a clean documentation-check baseline and add mechanical enforcement for the cartography contract.

**Architecture:** Repair the ten pre-existing Markdown-link failures introduced by the repository skill collection, then extend `scripts/check-docs.mjs` to require the traceability index and standard module headings. The checker should intentionally remain red until the domain and consolidation plans finish.

**Tech Stack:** Node.js ESM, Markdown, npm scripts, PowerShell.

---

## File Structure

### Create

- `skills/grill-me-with-docs/CONTEXT-FORMAT.md` — minimal glossary-only context template referenced by the skill.
- `skills/grill-me-with-docs/ADR-FORMAT.md` — minimal ADR template referenced by the skill.

### Modify

- `skills/writing-skills/anthropic-best-practices.md` — convert eight root-relative Anthropic documentation links to absolute HTTPS links.
- `scripts/check-docs.mjs` — enforce the cartography file and module section contract.

### Do Not Modify

- Any file under `src/`.
- Any file under `supabase/`.
- `docs/modules/*.md` in this plan.

### Task 1: Repair the Existing Documentation Baseline

**Files:**

- Create: `skills/grill-me-with-docs/CONTEXT-FORMAT.md`
- Create: `skills/grill-me-with-docs/ADR-FORMAT.md`
- Modify: `skills/writing-skills/anthropic-best-practices.md`

- [ ] **Step 1: Capture the current red state**

Run:

```powershell
npm run docs:check
```

Expected: exit `1` with exactly ten issues: two missing relative files under `skills/grill-me-with-docs/` and eight `/en/docs/` root-relative links under `skills/writing-skills/anthropic-best-practices.md`.

- [ ] **Step 2: Create the context template**

Create `skills/grill-me-with-docs/CONTEXT-FORMAT.md` with:

````markdown
# CONTEXT.md Format

`CONTEXT.md` is a domain glossary, not an implementation guide.

Use one section per canonical term:

```markdown
## Term

Plain-language definition in the project domain.

**Not:** nearby concepts that must not be conflated with this term.
```

Do not include file paths, database columns, API names, implementation plans, or
temporary decisions.
````

- [ ] **Step 3: Create the ADR template**

Create `skills/grill-me-with-docs/ADR-FORMAT.md` with:

````markdown
# ADR Format

```markdown
# NNNN — Decision title

**Status:** proposed | accepted | superseded
**Date:** YYYY-MM-DD

## Context

What durable problem or trade-off required a decision.

## Decision

The chosen approach and its boundaries.

## Consequences

Benefits, costs, risks, and follow-up constraints.

## Alternatives considered

The credible alternatives and why they were rejected.
```

Create an ADR only for decisions that are costly to reverse, surprising without
context, and based on a real trade-off.
````

- [ ] **Step 4: Convert root-relative Anthropic links**

In `skills/writing-skills/anthropic-best-practices.md`, replace every target starting with:

```text
/en/docs/
```

with:

```text
https://docs.anthropic.com/en/docs/
```

Run:

```powershell
rg -n "\]\(/en/docs/" skills/writing-skills/anthropic-best-practices.md
```

Expected: no matches.

- [ ] **Step 5: Verify the clean pre-cartography baseline**

Run:

```powershell
npm run docs:check
```

Expected: exit `0` and a success line reporting Markdown, route, and ADR coverage.

- [ ] **Step 6: Commit the baseline repair**

```powershell
git add -- skills/grill-me-with-docs/CONTEXT-FORMAT.md skills/grill-me-with-docs/ADR-FORMAT.md skills/writing-skills/anthropic-best-practices.md
git commit -m "docs: repair skill reference links"
```

### Task 2: Add the Cartography Contract to the Documentation Checker

**Files:**

- Modify: `scripts/check-docs.mjs`

- [ ] **Step 1: Add the traceability file to required files**

Replace:

```js
const requiredFiles = ['docs/README.md', 'docs/adr/README.md']
```

with:

```js
const requiredFiles = [
  'docs/README.md',
  'docs/RASTREABILIDADE.md',
  'docs/adr/README.md',
]
```

- [ ] **Step 2: Add module heading checks after the ADR index block**

Insert:

```js
const moduleDocuments = [
  'docs/modules/viagens.md',
  'docs/modules/manifesto-edi.md',
  'docs/modules/granito.md',
  'docs/modules/chegadas-saidas.md',
  'docs/modules/clientes.md',
  'docs/modules/taxas-locais.md',
  'docs/modules/faturamento.md',
  'docs/modules/demurrage.md',
  'docs/modules/reconciliacao-pix.md',
  'docs/modules/portal-cliente.md',
  'docs/modules/operacao-suporte.md',
]

const requiredModuleHeadings = [
  '## Propósito e escopo',
  '## Anatomia das telas',
  '## Catálogo de ações',
  '## Estado e dados',
  '## Fluxos e invariantes',
  '## Testes e validação',
  '## Notas e divergências',
]

for (const moduleDocument of moduleDocuments) {
  const absolutePath = path.join(root, moduleDocument)
  if (!fs.existsSync(absolutePath)) {
    addError(moduleDocument, 'living module document is missing')
    continue
  }

  const content = fs.readFileSync(absolutePath, 'utf8')
  for (const heading of requiredModuleHeadings) {
    if (!content.includes(heading)) {
      addError(moduleDocument, `required cartography heading is missing: ${heading}`)
    }
  }
}
```

- [ ] **Step 3: Add traceability route and evidence checks after `appRoutes` is built**

Insert after the architecture route loop:

```js
const traceabilityPath = path.join(root, 'docs', 'RASTREABILIDADE.md')
if (fs.existsSync(traceabilityPath)) {
  const traceability = fs.readFileSync(traceabilityPath, 'utf8')

  for (const route of appRoutes) {
    if (!traceability.includes(`\`${route}\``)) {
      addError('docs/RASTREABILIDADE.md', `route is not mapped: ${route}`)
    }
  }

  for (const evidenceLabel of ['Código', 'Teste', 'Runtime', 'Suspeita']) {
    if (!traceability.includes(`**${evidenceLabel}**`)) {
      addError('docs/RASTREABILIDADE.md', `evidence label is not defined: ${evidenceLabel}`)
    }
  }
}
```

- [ ] **Step 4: Run the checker and confirm the intended cartography red state**

Run:

```powershell
npm run docs:check
```

Expected: exit `1`. Failures must mention missing `docs/RASTREABILIDADE.md` and missing cartography headings in current module documents. There must be no broken-link failures from Task 1.

- [ ] **Step 5: Check the script**

Run:

```powershell
node --check scripts/check-docs.mjs
git diff --check
```

Expected: both commands exit `0`.

- [ ] **Step 6: Commit the checker contract**

```powershell
git add -- scripts/check-docs.mjs
git commit -m "docs: enforce cartography coverage"
```

## Plan Verification

Run:

```powershell
git status --short
node --check scripts/check-docs.mjs
npm run docs:check
```

Expected:

- clean working tree;
- syntax check passes;
- `docs:check` remains red only because the cartography deliverables have not yet been created.
