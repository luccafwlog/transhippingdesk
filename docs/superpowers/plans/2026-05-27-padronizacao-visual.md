# Padronizacao Visual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved "Sistema Operacional Refinado" direction so the app has consistent buttons, tabs, inputs, tables, modals, contrast, and no global horizontal overflow.

**Architecture:** Fix shared visual primitives first in `src/index.css` and `src/components/ui`, then migrate the pages that still bypass those primitives with hardcoded dark-theme Tailwind classes. Keep business logic untouched; page edits are class/structure changes only.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS v4, existing `app-*` CSS primitives, lucide-react icons.

---

## Files And Responsibilities

- `src/index.css`: shared visual system tokens and class behavior for nav, buttons, tabs, inputs, tables, cards, metric panels, modal layout, and responsive overflow.
- `src/components/ui/Modal.tsx`: optional modal footer/body structure only if CSS alone cannot keep actions reachable.
- `src/pages/Alertas.tsx`: replace local filter buttons and table action styling with shared tabs/actions.
- `src/pages/AdminUsuarios.tsx`: replace dark hardcoded panels/tabs/forms/table styling with shared app classes.
- `src/pages/Relatorios.tsx`: replace local report tabs and dark hardcoded styling with shared app classes.
- `src/pages/TaxasLocais.tsx`: replace light-theme-breaking `text-white`/dark panel classes and tighten form/table layout.
- `src/components/billing/ValidacaoTab.tsx`: replace dark hardcoded operational blocks with shared panels and readable text colors.
- `src/pages/Viagens.tsx`: validate and, if needed, adjust long modal content/action layout using shared modal action classes.
- `src/components/shared/FileImportModal.tsx`, `src/components/shared/CeMercanteImportModal.tsx`, `src/components/shared/ContainerDatesImportModal.tsx`, `src/components/shared/VoyageImportActions.tsx`: align import modal helper panels/actions if they still use hardcoded dark panels.

---

### Task 1: Shared Visual Foundation

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Add shared layout and component guardrails**

Add CSS rules near the existing primitives in `src/index.css`. Keep existing visual tokens and avoid a new palette.

```css
html,
body,
#root {
  max-width: 100%;
  overflow-x: clip;
}

.app-shell {
  max-width: 100%;
  overflow-x: clip;
}

.app-nav-bar {
  overflow-x: clip;
}

.app-nav-scroll {
  max-width: 100%;
  overflow-x: auto;
  overflow-y: visible;
  scrollbar-width: none;
}

.app-nav-link,
.app-nav-dropdown {
  flex: 0 0 auto;
}

.app-btn,
.app-tab,
.app-table__action {
  min-width: 0;
  max-width: 100%;
}

.app-btn {
  text-align: center;
}

.app-input,
.app-select,
.app-textarea {
  min-width: 0;
}

.app-table-scroll {
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
}

.app-table th,
.app-table td {
  min-width: 0;
}

.app-panel {
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius);
  background: var(--app-surface-muted);
  color: var(--app-text);
}

.app-panel--padded {
  padding: 16px;
}

.app-panel__title {
  color: var(--app-text-strong);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.35;
}

.app-panel__meta {
  color: var(--app-muted);
  font-size: 12px;
  line-height: 1.45;
}

.app-metric-tile {
  display: grid;
  gap: 6px;
  min-width: 0;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius);
  background: var(--app-surface);
  padding: 14px;
}

.app-metric-tile__label {
  color: var(--app-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.app-metric-tile__value {
  min-width: 0;
  color: var(--app-text-strong);
  font-size: 20px;
  font-weight: 800;
  line-height: 1.1;
  overflow-wrap: anywhere;
}

.app-action-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.app-modal__actions {
  position: sticky;
  bottom: 0;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  margin: 20px -24px -24px;
  border-top: 1px solid var(--app-border);
  background: linear-gradient(180deg, color-mix(in srgb, var(--app-surface) 78%, transparent), var(--app-surface));
  padding: 16px 24px;
}
```

- [ ] **Step 2: Preserve mobile menu behavior**

Inside the existing `@media (max-width: 768px)` block, keep the mobile menu vertical and prevent horizontal scroll in the open menu.

```css
@media (max-width: 768px) {
  .app-nav-scroll {
    overflow-x: visible;
  }

  .app-modal__actions {
    margin-right: -18px;
    margin-bottom: -18px;
    margin-left: -18px;
    padding: 14px 18px;
  }
}
```

- [ ] **Step 3: Run build smoke check**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build complete successfully.

---

### Task 2: Alertas Filter Tabs And Table Actions

**Files:**
- Modify: `src/pages/Alertas.tsx`

- [ ] **Step 1: Replace local filter button classes with shared tabs**

Change the filter wrapper and button class logic to:

```tsx
<div className="mb-4 flex flex-wrap gap-2">
  {FILTER_TABS.map((tab) => (
    <button
      key={tab.value}
      type="button"
      onClick={() => setStatusFilter(tab.value)}
      className={`app-tab ${statusFilter === tab.value ? 'app-tab--active' : ''}`}
    >
      {tab.label}
    </button>
  ))}
</div>
```

- [ ] **Step 2: Replace ad hoc invoice action link with shared table action**

Change the `Ver Fatura` link class to:

```tsx
className="app-table__action"
```

- [ ] **Step 3: Replace dark table head/body helpers with app table defaults**

Change:

```tsx
<thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
```

to:

```tsx
<thead>
```

and change:

```tsx
<tbody className="divide-y divide-[#30363d]">
```

to:

```tsx
<tbody>
```

- [ ] **Step 4: Verify Alertas visually**

Open `/alertas` in the browser. Expected: active tab has blue-soft readable state, inactive tabs are readable, and no page-level horizontal scroll appears.

---

### Task 3: Admin Usuarios Page Migration

**Files:**
- Modify: `src/pages/AdminUsuarios.tsx`

- [ ] **Step 1: Replace system info panel with shared app panel**

Change the system info wrapper from dark hardcoded classes to:

```tsx
<div className="mb-6 app-panel app-panel--padded">
  <div className="app-metric-tile__label">Informações do sistema</div>
  <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
```

Change each inner info box class to:

```tsx
className="app-metric-tile grid-cols-[auto_1fr]"
```

Use readable value classes:

```tsx
<span className="text-[var(--app-muted)]">Versão</span>
<span className="text-right font-semibold text-[var(--app-text-strong)]">{`${VERSION} (${COMMIT_SHA})`}</span>
```

- [ ] **Step 2: Replace tab bar with shared tabs**

Replace the tab button class expression with:

```tsx
className={`app-tab ${tab === t ? 'app-tab--active' : ''}`}
```

Keep the existing `capitalize` behavior by rendering the existing label text unchanged.

- [ ] **Step 3: Replace admin table dark wrappers**

Change table wrapper classes from hardcoded dark borders to:

```tsx
<Card className="overflow-hidden p-0">
  <div className="app-table-scroll">
    <table className="app-table app-table--compact min-w-[760px] text-left text-sm">
```

Use plain `<thead>` and `<tbody>` so `src/index.css` owns colors.

- [ ] **Step 4: Replace role select and action button classes**

Use shared form/action classes:

```tsx
className="app-input app-select w-44"
```

and:

```tsx
className="app-table__action"
```

for the deactivate/reactivate button.

- [ ] **Step 5: Verify Admin visually**

Open `/admin/usuarios`. Expected: the user row remains readable, role select fits, tabs have the same visual treatment as other pages, and the admin table scrolls internally if needed.

---

### Task 4: Relatorios Page Tabs And Report Surfaces

**Files:**
- Modify: `src/pages/Relatorios.tsx`

- [ ] **Step 1: Replace report mode tabs**

Find the report-mode buttons using hardcoded `rounded-md px-3 py-1.5`. Replace their class expression with:

```tsx
className={`app-tab ${activeTab === tab.value ? 'app-tab--active' : ''}`}
```

If the state variable has a different name, use the existing active comparison and only replace classes.

- [ ] **Step 2: Replace dark report headings and panels**

For report cards or headings using `text-white`, change heading classes to:

```tsx
className="app-panel__title"
```

For secondary text using `text-slate-400` or `text-slate-500`, use:

```tsx
className="app-panel__meta"
```

For hardcoded dark panel wrappers, use:

```tsx
className="app-panel app-panel--padded"
```

- [ ] **Step 3: Ensure long report tables are internally scrollable**

Every report table should be wrapped as:

```tsx
<Card className="overflow-hidden p-0">
  <div className="app-table-scroll">
    <table className="app-table app-table--compact min-w-[900px] text-left text-sm">
```

Use the existing min-width if it is larger than `900px`.

- [ ] **Step 4: Verify Relatorios visually**

Open `/relatorios`. Expected: report tabs are readable, long content does not create global horizontal overflow, and exported report button remains visually primary.

---

### Task 5: Taxas Locais And Finance Dense Forms

**Files:**
- Modify: `src/pages/TaxasLocais.tsx`

- [ ] **Step 1: Replace light-breaking `text-white` headings**

Replace local headings such as:

```tsx
className="text-base font-semibold text-white"
```

with:

```tsx
className="app-panel__title"
```

Replace numeric KPI values such as:

```tsx
className="mt-2 text-3xl font-bold text-white"
```

with:

```tsx
className="app-metric-tile__value"
```

- [ ] **Step 2: Replace dark panel wrappers around form sections**

For wrappers using `rounded-xl border border-[#30363d] bg-[#0d1117] p-4`, use:

```tsx
className="app-panel app-panel--padded"
```

- [ ] **Step 3: Ensure dense grids can shrink**

For form grids with two or more columns, prefer:

```tsx
className="grid gap-4 md:grid-cols-2"
```

or:

```tsx
className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
```

Do not add new breakpoints unless an existing grid demonstrably overflows.

- [ ] **Step 4: Keep table actions on shared icon buttons**

Do not replace `app-table__icon-button`; verify it remains readable after Task 1. If local danger buttons exist, keep:

```tsx
className="app-table__icon-button app-table__icon-button--danger"
```

- [ ] **Step 5: Verify Taxas Locais visually**

Open `/taxas-locais`. Expected: section titles are dark/readable on light cards, tabs are consistent, forms do not clip select values, and the page width remains stable.

---

### Task 6: Billing Validation Dense Blocks

**Files:**
- Modify: `src/components/billing/ValidacaoTab.tsx`

- [ ] **Step 1: Replace dark filter headings**

Replace:

```tsx
<div className="text-base font-semibold text-white">
```

with:

```tsx
<div className="app-panel__title">
```

Replace descriptive dark-muted text with:

```tsx
className="app-panel__meta"
```

- [ ] **Step 2: Replace selected counter card**

Change the selected counter block from:

```tsx
<div className="grid gap-1 rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
```

to:

```tsx
<div className="app-metric-tile">
```

Use:

```tsx
<div className="app-metric-tile__label">Selecionados</div>
<div className="app-metric-tile__value">{selectedOpsRows.length}</div>
<div className="app-panel__meta">Acoes em lote por selecao manual</div>
```

- [ ] **Step 3: Keep expanded row contrast readable**

For expanded detail rows that intentionally sit inside a table, replace `bg-[#0d1117]` with:

```tsx
className="bg-[var(--app-surface-muted)]"
```

and replace `text-white` detail values with:

```tsx
className="text-[var(--app-text-strong)]"
```

- [ ] **Step 4: Verify Faturamento validation visually**

Open `/faturamento`, switch to the validation tab if needed, and inspect the operational filter and expanded row. Expected: headings and counters are readable in the light theme and table rows remain dense.

---

### Task 7: Modal Action Standardization

**Files:**
- Modify: `src/pages/Viagens.tsx`
- Modify: `src/components/shared/FileImportModal.tsx`
- Modify: `src/components/shared/CeMercanteImportModal.tsx`
- Modify: `src/components/shared/ContainerDatesImportModal.tsx`
- Modify: `src/components/shared/VoyageImportActions.tsx`
- Modify only if encountered during verification: `src/pages/CargaSolta.tsx`, `src/pages/Granite.tsx`, `src/pages/Veiculos.tsx`

- [ ] **Step 1: Replace modal footer action rows**

Inside modal bodies, replace footer wrappers such as:

```tsx
<div className="flex justify-end gap-2">
```

or:

```tsx
<div className="mt-4 flex justify-end gap-2 border-t border-[#30363d] pt-4">
```

with:

```tsx
<div className="app-modal__actions">
```

Only apply this to modal action rows at the bottom of modal content, not ordinary inline button groups.

- [ ] **Step 2: Replace dark informational panels inside import modals**

Change helper panels like:

```tsx
<div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm text-slate-300">
```

to:

```tsx
<div className="app-panel app-panel--padded text-sm">
```

Use `text-[var(--app-text-strong)]` for emphasized values.

- [ ] **Step 3: Verify long modals**

Open `/viagens`, click `Nova Viagem`. Expected: modal content scrolls internally and `Cancelar` / `Cadastrar viagem` remain easy to reach.

Open `/manifestos`, click `Importar Manifesto CNTR`. Expected: file input and action buttons are readable, with actions visually separated.

---

### Task 8: Global Route Verification

**Files:**
- No product files unless a verification failure identifies a scoped fix.

- [ ] **Step 1: Run build**

Run:

```bash
npm run build
```

Expected: build passes.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: lint passes. If lint reports preexisting issues outside edited files, record the exact output in the final response and do not refactor unrelated code.

- [ ] **Step 3: Browser overflow audit**

In the in-app browser, visit:

```text
/painel
/viagens
/manifestos
/taxas-locais
/faturamento
/demurrage
/relatorios
/alertas
/admin/usuarios
```

For each route, evaluate:

```js
document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2
```

Expected: `true` for each route. Tables may have internal scroll via `.app-table-scroll`.

- [ ] **Step 4: Narrow viewport check**

Set a temporary viewport near tablet/mobile width and re-check `/painel`, `/alertas`, `/admin/usuarios`, and `/taxas-locais`.

Expected: no incoherent overlap; top nav is internally scrollable or mobile menu appears; buttons remain readable.

- [ ] **Step 5: Final visual spot check**

Capture screenshots for:

```text
/alertas
/admin/usuarios
/taxas-locais
Nova Viagem modal
Importar Manifesto CNTR modal
```

Expected: active/inactive controls are visually distinct, text is readable, and long modal actions are reachable.

