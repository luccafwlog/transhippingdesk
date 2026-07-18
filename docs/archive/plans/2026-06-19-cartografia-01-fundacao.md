# Technical Cartography Foundation Implementation Plan

> **✅ Completed (2026-06-24).** Checker contract enforced in `scripts/check-docs.mjs`. Baseline verified against PR `#253`–`#258`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the clean documentation baseline delivered by PR `#253` and add mechanical enforcement for the cartography contract.

**Architecture:** Treat the skill-link repair from PR `#253` as repository
baseline, not cartography work. Verify that baseline first, then extend
`scripts/check-docs.mjs` to require the traceability index and standard module
headings. The checker should intentionally remain red until the domain and
consolidation plans finish.

**Tech Stack:** Node.js ESM, Markdown, npm scripts, PowerShell.

---

## File Structure

### Modify

- `scripts/check-docs.mjs` — enforce the cartography file and module section contract.

### Do Not Modify

- Any file under `src/`.
- Any file under `supabase/`.
- Any file under `skills/`; PR `#253` already owns the baseline repair.
- `docs/modules/*.md` in this plan.

### Task 1: Verify the PR 253 Documentation Baseline

**Files:**

- Read: `skills/grill-me-with-docs/CONTEXT-FORMAT.md`
- Read: `skills/grill-me-with-docs/ADR-FORMAT.md`
- Read: `skills/writing-skills/anthropic-best-practices.md`

- [ ] **Step 1: Verify the two referenced templates exist**

Run:

```powershell
@(
  'skills/grill-me-with-docs/CONTEXT-FORMAT.md',
  'skills/grill-me-with-docs/ADR-FORMAT.md'
) | ForEach-Object {
  if (-not (Test-Path $_)) { throw "PR #253 baseline file missing: $_" }
}
```

Expected: exit `0`.

- [ ] **Step 2: Verify the root-relative links remain repaired**

Run:

```powershell
rg -n "\]\(/en/docs/" skills/writing-skills/anthropic-best-practices.md
```

Expected: no matches.

- [ ] **Step 3: Verify the clean pre-cartography baseline**

Run:

```powershell
npm run docs:check
```

Expected: exit `0` and a success line reporting Markdown, route, and ADR coverage.

If any check fails, STOP: the checkout is not the required PR `#253`–`#258`
baseline or contains an unrelated regression. Do not recreate or rewrite the
skill files in this plan.

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
