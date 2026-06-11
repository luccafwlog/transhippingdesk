# Melhorias UX Clientes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** melhorar a pagina `Clientes`, com foco em tabela, acoes por linha, leitura de contatos, filtros, atalhos financeiros e eficiencia operacional.

**Architecture:** manter o fluxo atual em React, sem redesenho amplo. Criar helpers puros em `src/lib/customerTableViewModel.ts` para regras de exibicao, ordenacao, chips e URLs; manter `Clientes.tsx` responsavel por composicao da UI; usar CSS global apenas para padroes reutilizaveis da tabela.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, React Testing Library, React Router, Lucide React, CSS global em `src/index.css`.

---

## Contexto

A pagina `Clientes` ja possui cards, filtros, tabela, selecao em lote e atalhos para ficha/faturamento. O principal problema visual atual e a coluna `Acoes`: ela tem largura pequena, usa botoes textuais e quebra os controles em pilha, deixando linhas altas e desalinhadas.

Este plano cobre todas as melhorias sugeridas:

- corrigir a disposicao dos botoes por linha;
- transformar acoes em controles compactos e acessiveis;
- tornar a linha e/ou nome do cliente mais acionavel;
- adicionar menu de mais acoes;
- adicionar copiar CNPJ/CPF e copiar e-mail principal;
- melhorar exibicao de contatos;
- simplificar badges de operacao;
- adicionar indicador de proxima acao;
- adicionar chips de filtros ativos;
- adicionar ordenacao de colunas;
- melhorar responsividade da tabela.

---

## Arquivos Planejados

- Modify: `src/pages/Clientes.tsx`
  - Ajustar layout da tabela, coluna de acoes, menu de acoes, contatos, filtros, chips, ordenacao e indicadores.
- Modify: `src/hooks/useCustomers.ts`
  - Adicionar campos de ordenacao e aplicar ordenacao antes da paginacao quando necessario.
- Modify: `src/types/database.ts`
  - Expandir `CustomerListItem.customer_contacts` para incluir `email`, `purpose` e `is_primary`.
- Modify: `src/index.css`
  - Adicionar estilos para acoes compactas, menu, chips, coluna sticky e botoes de ordenacao.
- Create: `src/lib/customerTableViewModel.ts`
  - Helpers puros para URL de faturamento, resumo de contatos, proxima acao, chips e ordenacao.
- Create: `src/lib/__tests__/customerTableViewModel.test.ts`
  - Testes unitarios dos helpers.
- Modify: `src/pages/__tests__/Faturamento.test.ts`
  - Manter cobertura do atalho para faturas filtradas por cliente.

---

## Phase 1: Acoes Por Linha

### Task 1: Centralizar URL de faturas do cliente

**Files:**
- Create: `src/lib/customerTableViewModel.ts`
- Create: `src/lib/__tests__/customerTableViewModel.test.ts`
- Modify: `src/pages/Clientes.tsx`

- [x] **Step 1: Escrever teste vermelho**

Adicionar em `src/lib/__tests__/customerTableViewModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildCustomerBillingUrl } from '../customerTableViewModel'

describe('customerTableViewModel', () => {
  it('monta URL de faturas filtrada pelo cliente', () => {
    expect(buildCustomerBillingUrl({ id: 42, name: 'ACME EXPORTS & LOGISTICS' })).toBe(
      '/faturamento?tab=invoices&customer=42&customerName=ACME%20EXPORTS%20%26%20LOGISTICS',
    )
  })
})
```

- [x] **Step 2: Rodar o teste**

Run:

```bash
npm test -- src/lib/__tests__/customerTableViewModel.test.ts
```

Expected: FAIL porque o helper ainda nao existe.

- [x] **Step 3: Implementar helper**

Criar `src/lib/customerTableViewModel.ts`:

```ts
export function buildCustomerBillingUrl(customer: { id: number; name: string }) {
  return `/faturamento?tab=invoices&customer=${customer.id}&customerName=${encodeURIComponent(customer.name)}`
}
```

- [x] **Step 4: Usar helper em `Clientes.tsx`**

Adicionar import:

```ts
import { buildCustomerBillingUrl } from '../lib/customerTableViewModel'
```

Trocar link inline de faturamento por:

```tsx
<Link className="app-table__action" to={buildCustomerBillingUrl(row)}>
  Ver faturas
</Link>
```

- [x] **Step 5: Verificar**

Run:

```bash
npm test -- src/lib/__tests__/customerTableViewModel.test.ts src/pages/__tests__/Faturamento.test.ts
```

Expected: PASS.

### Task 2: Transformar acoes em grupo compacto

**Files:**
- Modify: `src/pages/Clientes.tsx`
- Modify: `src/index.css`

- [x] **Step 1: Ajustar tabela e coluna**

Trocar a tabela:

```tsx
<table className="app-table app-table--compact min-w-[880px] table-fixed text-left text-sm">
```

por:

```tsx
<table className="app-table app-table--compact app-table--sticky-actions min-w-[1040px] table-fixed text-left text-sm">
```

Trocar o cabecalho:

```tsx
<th scope="col" className="w-[14%] px-4 py-3">Acoes</th>
```

por:

```tsx
<th scope="col" className="w-[172px] px-4 py-3 text-right">Acoes</th>
```

- [x] **Step 2: Importar icones**

Trocar:

```ts
import { Download, Plus, Trash2, Upload } from 'lucide-react'
```

por:

```ts
import { Copy, Download, FileText, MoreHorizontal, Plus, ReceiptText, Trash2, Upload } from 'lucide-react'
```

- [x] **Step 3: Substituir botoes empilhados**

Substituir a celula de acoes por:

```tsx
<td className="px-4 py-3 text-right">
  <div className="app-customer-row-actions">
    <Link className="app-table__action app-table__action--compact" to={`/clientes/${row.cnpj_cpf}`} title="Abrir ficha do cliente">
      <FileText size={15} />
      Ficha
    </Link>
    <Link className="app-table__icon-button" to={buildCustomerBillingUrl(row)} title="Ver faturas do cliente" aria-label={`Ver faturas de ${row.name}`}>
      <ReceiptText size={15} />
    </Link>
    <button type="button" className="app-table__icon-button" title="Mais acoes" aria-label={`Mais acoes para ${row.name}`}>
      <MoreHorizontal size={15} />
    </button>
    {isAdmin ? (
      <button
        type="button"
        onClick={() => runCustomerDelete([row.id])}
        disabled={deleting}
        className="app-table__icon-button app-table__icon-button--danger"
        title="Excluir cliente"
        aria-label={`Excluir cliente ${row.name}`}
      >
        <Trash2 size={15} />
      </button>
    ) : null}
  </div>
</td>
```

- [x] **Step 4: Adicionar CSS**

Adicionar perto de `.app-table__action` em `src/index.css`:

```css
.app-customer-row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}

.app-table__action--compact {
  min-height: 36px;
  padding: 0 12px;
  gap: 6px;
  white-space: nowrap;
}
```

- [x] **Step 5: Verificar**

Run:

```bash
npm run build
```

Expected: build PASS; acoes ficam em uma linha horizontal em desktop.

---

## Phase 2: Menu De Mais Acoes

### Task 3: Adicionar e-mail principal e copia rapida

**Files:**
- Modify: `src/types/database.ts`
- Modify: `src/hooks/useCustomers.ts`
- Modify: `src/pages/Clientes.tsx`
- Modify: `src/lib/customerTableViewModel.ts`
- Modify: `src/lib/__tests__/customerTableViewModel.test.ts`

- [x] **Step 1: Expandir tipo de contato**

Em `src/types/database.ts`, trocar:

```ts
customer_contacts?: Pick<CustomerContact, 'id' | 'email'>[] | null
```

por:

```ts
customer_contacts?: Pick<CustomerContact, 'id' | 'email' | 'purpose' | 'is_primary'>[] | null
```

- [x] **Step 2: Buscar campos extras**

Em `useCustomers.ts` e `Clientes.tsx`, trocar:

```ts
customer_contacts(id, email)
```

por:

```ts
customer_contacts(id, email, purpose, is_primary)
```

- [x] **Step 3: Testar helper de e-mail principal**

Adicionar no teste:

```ts
import { getPrimaryContactEmail } from '../customerTableViewModel'

it('prioriza contato principal com e-mail', () => {
  expect(
    getPrimaryContactEmail([
      { id: 1, email: 'operacao@acme.com', is_primary: false, purpose: 'operacional' },
      { id: 2, email: 'financeiro@acme.com', is_primary: true, purpose: 'financeiro' },
    ]),
  ).toBe('financeiro@acme.com')
})
```

- [x] **Step 4: Implementar helper**

Adicionar:

```ts
export function getPrimaryContactEmail(
  contacts: Array<{ email?: string | null; is_primary?: boolean | null }> | null | undefined,
) {
  const withEmail = (contacts ?? []).filter((contact) => String(contact.email ?? '').trim().length > 0)
  return withEmail.find((contact) => contact.is_primary)?.email ?? withEmail[0]?.email ?? null
}
```

- [x] **Step 5: Adicionar handler de copia**

Dentro de `Clientes`:

```tsx
async function copyText(value: string, label: string) {
  await navigator.clipboard.writeText(value)
  showToast(`${label} copiado.`, 'success')
}
```

- [x] **Step 6: Verificar**

Run:

```bash
npm test -- src/lib/__tests__/customerTableViewModel.test.ts
npm run build
```

Expected: PASS.

### Task 4: Implementar menu de mais acoes

**Files:**
- Modify: `src/pages/Clientes.tsx`
- Modify: `src/index.css`

- [x] **Step 1: Adicionar estado**

Dentro de `Clientes`:

```tsx
const [openActionsFor, setOpenActionsFor] = useState<number | null>(null)
```

- [x] **Step 2: Calcular e-mail na linha**

Antes do `return` de cada linha:

```tsx
const primaryEmail = getPrimaryContactEmail(row.customer_contacts)
```

- [x] **Step 3: Substituir botao de mais acoes por menu**

```tsx
<div className="app-row-actions-menu">
  <button
    type="button"
    className="app-table__icon-button"
    title="Mais acoes"
    aria-label={`Mais acoes para ${row.name}`}
    aria-expanded={openActionsFor === row.id}
    onClick={() => setOpenActionsFor((current) => (current === row.id ? null : row.id))}
  >
    <MoreHorizontal size={15} />
  </button>
  {openActionsFor === row.id ? (
    <div className="app-row-actions-menu__panel">
      <button type="button" onClick={() => void copyText(formatCnpjCpf(row.cnpj_cpf), 'CNPJ/CPF')}>
        <Copy size={14} />
        Copiar CNPJ/CPF
      </button>
      {primaryEmail ? (
        <button type="button" onClick={() => void copyText(primaryEmail, 'E-mail principal')}>
          <Copy size={14} />
          Copiar e-mail
        </button>
      ) : null}
    </div>
  ) : null}
</div>
```

- [x] **Step 4: Adicionar CSS**

```css
.app-row-actions-menu {
  position: relative;
}

.app-row-actions-menu__panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 80;
  display: grid;
  min-width: 184px;
  padding: 6px;
  border: 1px solid var(--app-border);
  border-radius: 8px;
  background: var(--app-surface);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
}

.app-row-actions-menu__panel button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  border: 0;
  border-radius: 6px;
  padding: 0 10px;
  background: transparent;
  color: var(--app-text);
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.app-row-actions-menu__panel button:hover {
  background: rgba(37, 99, 235, 0.08);
}
```

- [x] **Step 5: Verificar**

Run:

```bash
npm run build
```

Expected: build PASS; menu abre sem aumentar altura da linha.

---

## Phase 3: Melhorar Informacoes Da Linha

### Task 5: Melhorar coluna Contatos

**Files:**
- Modify: `src/lib/customerTableViewModel.ts`
- Modify: `src/lib/__tests__/customerTableViewModel.test.ts`
- Modify: `src/pages/Clientes.tsx`

- [x] **Step 1: Testar resumo de contatos**

```ts
import { summarizeContactsForDisplay } from '../customerTableViewModel'

it('resume contatos com email principal e finalidade', () => {
  expect(
    summarizeContactsForDisplay([
      { id: 1, email: 'ops@acme.com', is_primary: false, purpose: 'operacional' },
      { id: 2, email: 'fin@acme.com', is_primary: true, purpose: 'financeiro' },
    ]),
  ).toEqual({
    count: 2,
    primaryEmail: 'fin@acme.com',
    purposeLabel: 'Financeiro',
    empty: false,
  })
})
```

- [x] **Step 2: Implementar helper**

```ts
const contactPurposeLabels: Record<string, string> = {
  geral: 'Geral',
  operacional: 'Operacional',
  faturamento: 'Faturamento',
  financeiro: 'Financeiro',
}

export function summarizeContactsForDisplay(
  contacts: Array<{ email?: string | null; is_primary?: boolean | null; purpose?: string | null }> | null | undefined,
) {
  const count = contacts?.length ?? 0
  const primary = (contacts ?? []).find((contact) => contact.is_primary && String(contact.email ?? '').trim())
    ?? (contacts ?? []).find((contact) => String(contact.email ?? '').trim())

  return {
    count,
    primaryEmail: primary?.email ?? null,
    purposeLabel: primary?.purpose ? contactPurposeLabels[primary.purpose] ?? primary.purpose : null,
    empty: !primary?.email,
  }
}
```

- [x] **Step 3: Atualizar celula de contatos**

Calcular na linha:

```tsx
const contactSummary = summarizeContactsForDisplay(row.customer_contacts)
```

Substituir conteudo atual por:

```tsx
<div className="app-table__cell-value">{contactSummary.count} contato(s)</div>
{contactSummary.primaryEmail ? (
  <span className="app-table__truncate app-table__truncate--md" title={contactSummary.primaryEmail}>
    {contactSummary.primaryEmail}
  </span>
) : (
  <Badge tone="red">Sem e-mail</Badge>
)}
{contactSummary.purposeLabel ? <Badge tone="slate">{contactSummary.purposeLabel}</Badge> : null}
```

- [x] **Step 4: Verificar**

Run:

```bash
npm test -- src/lib/__tests__/customerTableViewModel.test.ts
npm run build
```

Expected: PASS.

### Task 6: Simplificar badges de operacao

**Files:**
- Modify: `src/pages/Clientes.tsx`

- [x] **Step 1: Mostrar somente badges com valor util**

Substituir:

```tsx
<Badge tone="yellow">Pend {summary.pending}</Badge>
<Badge tone="green">Pronto {summary.ready}</Badge>
<Badge tone="slate">Isento {summary.exempt}</Badge>
```

por:

```tsx
{summary.pending > 0 ? <Badge tone="yellow">Pend {summary.pending}</Badge> : null}
{summary.ready > 0 ? <Badge tone="green">Pronto {summary.ready}</Badge> : null}
{summary.exempt > 0 ? <Badge tone="slate">Isento {summary.exempt}</Badge> : null}
{summary.pending === 0 && summary.ready === 0 && summary.exempt === 0 ? <Badge tone="slate">Sem taxas</Badge> : null}
```

- [x] **Step 2: Verificar**

Run:

```bash
npm run build
```

Expected: PASS; menos poluicao visual por linha.

### Task 7: Adicionar indicador de proxima acao

**Files:**
- Modify: `src/lib/customerTableViewModel.ts`
- Modify: `src/lib/__tests__/customerTableViewModel.test.ts`
- Modify: `src/pages/Clientes.tsx`

- [x] **Step 1: Testar regra**

```ts
import { getCustomerNextAction } from '../customerTableViewModel'

it('prioriza ausencia de email como proxima acao', () => {
  expect(getCustomerNextAction({ hasEmail: false, readyCount: 2, pendingCount: 0, pendingBalance: 0 })).toEqual({
    label: 'Cadastrar e-mail',
    tone: 'red',
  })
})

it('indica pronto para faturar quando ha taxas prontas', () => {
  expect(getCustomerNextAction({ hasEmail: true, readyCount: 2, pendingCount: 0, pendingBalance: 0 })).toEqual({
    label: 'Pronto para faturar',
    tone: 'green',
  })
})
```

- [x] **Step 2: Implementar helper**

```ts
export function getCustomerNextAction(input: {
  hasEmail: boolean
  readyCount: number
  pendingCount: number
  pendingBalance: number
}): { label: string; tone: 'green' | 'yellow' | 'red' | 'slate' } {
  if (!input.hasEmail) return { label: 'Cadastrar e-mail', tone: 'red' }
  if (input.readyCount > 0) return { label: 'Pronto para faturar', tone: 'green' }
  if (input.pendingCount > 0) return { label: 'Revisar taxas', tone: 'yellow' }
  if (input.pendingBalance > 0) return { label: 'Saldo em aberto', tone: 'yellow' }
  return { label: 'Em dia', tone: 'slate' }
}
```

- [x] **Step 3: Exibir badge na linha**

Calcular:

```tsx
const nextAction = getCustomerNextAction({
  hasEmail: !contactSummary.empty,
  readyCount: summary.ready,
  pendingCount: summary.pending,
  pendingBalance: Number(row.pending_balance ?? 0),
})
```

Renderizar em `Financeiro`:

```tsx
<Badge tone={nextAction.tone}>{nextAction.label}</Badge>
```

- [x] **Step 4: Verificar**

Run:

```bash
npm test -- src/lib/__tests__/customerTableViewModel.test.ts
npm run build
```

Expected: PASS.

---

## Phase 4: Filtros E Ordenacao

### Task 8: Adicionar chips de filtros ativos

**Files:**
- Modify: `src/lib/customerTableViewModel.ts`
- Modify: `src/lib/__tests__/customerTableViewModel.test.ts`
- Modify: `src/pages/Clientes.tsx`
- Modify: `src/index.css`

- [x] **Step 1: Testar chips**

```ts
import { getCustomerFilterChips } from '../customerTableViewModel'

it('gera chips legiveis para filtros ativos', () => {
  expect(
    getCustomerFilterChips({
      search: 'ACME',
      contactEmail: 'fin@acme.com',
      emailStatus: 'with',
      blStatus: 'without',
      pendingStatus: 'with',
    }),
  ).toEqual([
    { key: 'search', label: 'Cliente: ACME' },
    { key: 'contactEmail', label: 'E-mail: fin@acme.com' },
    { key: 'emailStatus', label: 'Com e-mails' },
    { key: 'blStatus', label: 'Sem B/Ls' },
    { key: 'pendingStatus', label: 'Com saldo pendente' },
  ])
})
```

- [x] **Step 2: Implementar helper**

```ts
type CustomerFilterChipInput = {
  search: string
  contactEmail: string
  emailStatus: '' | 'with' | 'without'
  blStatus: '' | 'with' | 'without'
  pendingStatus: '' | 'with' | 'without'
}

export function getCustomerFilterChips(filters: CustomerFilterChipInput) {
  const chips: Array<{ key: keyof CustomerFilterChipInput; label: string }> = []
  if (filters.search.trim()) chips.push({ key: 'search', label: `Cliente: ${filters.search.trim()}` })
  if (filters.contactEmail.trim()) chips.push({ key: 'contactEmail', label: `E-mail: ${filters.contactEmail.trim()}` })
  if (filters.emailStatus === 'with') chips.push({ key: 'emailStatus', label: 'Com e-mails' })
  if (filters.emailStatus === 'without') chips.push({ key: 'emailStatus', label: 'Sem e-mails' })
  if (filters.blStatus === 'with') chips.push({ key: 'blStatus', label: 'Com B/Ls' })
  if (filters.blStatus === 'without') chips.push({ key: 'blStatus', label: 'Sem B/Ls' })
  if (filters.pendingStatus === 'with') chips.push({ key: 'pendingStatus', label: 'Com saldo pendente' })
  if (filters.pendingStatus === 'without') chips.push({ key: 'pendingStatus', label: 'Sem saldo pendente' })
  return chips
}
```

- [x] **Step 3: Renderizar chips**

Em `Clientes.tsx`:

```tsx
const filterChips = getCustomerFilterChips(filters)
```

Abaixo de `</FilterBar>`:

```tsx
{filterChips.length ? (
  <div className="app-filter-chips">
    {filterChips.map((chip) => (
      <button
        key={chip.key}
        type="button"
        className="app-filter-chip"
        onClick={() => setFilterField(chip.key, '' as never)}
      >
        {chip.label}
        <span aria-hidden="true">x</span>
      </button>
    ))}
  </div>
) : null}
```

- [x] **Step 4: Adicionar CSS**

```css
.app-filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: -8px 0 16px;
}

.app-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  border: 1px solid rgba(37, 99, 235, 0.22);
  border-radius: 999px;
  padding: 0 10px;
  background: rgba(37, 99, 235, 0.08);
  color: var(--app-text);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.app-filter-chip:hover {
  background: rgba(37, 99, 235, 0.12);
}
```

- [x] **Step 5: Verificar**

Run:

```bash
npm test -- src/lib/__tests__/customerTableViewModel.test.ts
npm run build
```

Expected: PASS.

### Task 9: Adicionar ordenacao de colunas

**Files:**
- Modify: `src/lib/customerTableViewModel.ts`
- Modify: `src/lib/__tests__/customerTableViewModel.test.ts`
- Modify: `src/hooks/useCustomers.ts`
- Modify: `src/pages/Clientes.tsx`
- Modify: `src/index.css`

- [x] **Step 1: Criar tipos e teste**

Adicionar:

```ts
export type CustomerSortKey = 'name' | 'bls' | 'pendingBalance'
export type SortDirection = 'asc' | 'desc'
```

Teste:

```ts
import { sortCustomerRows } from '../customerTableViewModel'

it('ordena clientes por saldo pendente decrescente', () => {
  const rows = [
    { id: 1, name: 'A', pending_balance: 10, bls: [] },
    { id: 2, name: 'B', pending_balance: 50, bls: [] },
  ]

  expect(sortCustomerRows(rows, 'pendingBalance', 'desc').map((row) => row.id)).toEqual([2, 1])
})
```

- [x] **Step 2: Implementar ordenacao**

```ts
export function sortCustomerRows<T extends { name: string; pending_balance?: number | null; bls?: unknown[] | null }>(
  rows: T[],
  key: CustomerSortKey,
  direction: SortDirection,
) {
  const multiplier = direction === 'asc' ? 1 : -1
  return [...rows].sort((left, right) => {
    if (key === 'name') return left.name.localeCompare(right.name) * multiplier
    if (key === 'bls') return ((left.bls?.length ?? 0) - (right.bls?.length ?? 0)) * multiplier
    return (Number(left.pending_balance ?? 0) - Number(right.pending_balance ?? 0)) * multiplier
  })
}
```

- [x] **Step 3: Adicionar campos no filtro**

Em `CustomerFilters`:

```ts
sortKey: CustomerSortKey
sortDirection: SortDirection
```

Em `useCustomers.ts`:

```ts
import { sortCustomerRows, type CustomerSortKey, type SortDirection } from '../lib/customerTableViewModel'
```

Aplicar antes da paginacao:

```ts
rows = sortCustomerRows(rows, filters.sortKey, filters.sortDirection)
```

- [x] **Step 4: Adicionar controle no cabecalho**

Em `Clientes.tsx`, inicializar:

```ts
sortKey: 'name' as CustomerSortKey,
sortDirection: 'asc' as SortDirection,
```

Adicionar handler:

```tsx
function toggleSort(sortKey: CustomerSortKey) {
  setFilters((current) => ({
    ...current,
    sortKey,
    sortDirection: current.sortKey === sortKey && current.sortDirection === 'asc' ? 'desc' : 'asc',
    page: 0,
  }))
}
```

Trocar cabecalho `Cliente` por:

```tsx
<th scope="col" className="w-[31%] px-4 py-3">
  <button type="button" className="app-table__sort" onClick={() => toggleSort('name')}>
    Cliente
  </button>
</th>
```

Repetir para `Operacao` com `bls` e `Financeiro` com `pendingBalance`.

- [x] **Step 5: CSS**

```css
.app-table__sort {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 700;
  text-transform: inherit;
  cursor: pointer;
}

.app-table__sort:hover {
  color: var(--app-text-strong);
}
```

- [x] **Step 6: Verificar**

Run:

```bash
npm test -- src/lib/__tests__/customerTableViewModel.test.ts
npm run build
```

Expected: PASS.

---

## Phase 5: Responsividade E Polimento

### Task 10: Ajustar responsividade da tabela

**Files:**
- Modify: `src/pages/Clientes.tsx`
- Modify: `src/index.css`

- [x] **Step 1: Garantir tabela com largura minima adequada**

Confirmar:

```tsx
className="app-table app-table--compact app-table--sticky-actions min-w-[1040px] table-fixed text-left text-sm"
```

- [x] **Step 2: Evitar quebra ruim de e-mail**

Usar:

```tsx
<span className="app-table__truncate app-table__truncate--md" title={contactSummary.primaryEmail}>
  {contactSummary.primaryEmail}
</span>
```

- [x] **Step 3: Validar mobile**

Run:

```bash
npm run build
```

Expected: PASS. Em navegador com `.env` configurado, a tabela pode rolar horizontalmente, mas a coluna de acoes deve permanecer legivel.

### Task 11: Revisar textos de acao

**Files:**
- Modify: `src/pages/Clientes.tsx`

- [x] **Step 1: Padronizar textos**

Usar estes rotulos:

- `Ficha` para abrir ficha.
- `Ver faturas` para faturamento.
- `Copiar CNPJ/CPF` no menu.
- `Copiar e-mail` no menu.
- `Cadastrar e-mail` como proxima acao quando o cliente nao tiver contato com e-mail.

- [x] **Step 2: Verificar**

Run:

```bash
npm run build
```

Expected: PASS.

---

## Phase 6: Verificacao Final

### Task 12: Suite e QA visual

**Files:**
- Verify only.

- [x] **Step 1: Rodar testes**

Run:

```bash
npm test
```

Expected: todos os testes passam; skips existentes podem permanecer.

- [x] **Step 2: Rodar lint**

Run:

```bash
npm run lint
```

Expected: 0 errors. Warning preexistente em `src/pages/PortalOperacao.tsx` pode ser registrado sem bloquear.

- [x] **Step 3: Rodar build**

Run:

```bash
npm run build
```

Expected: PASS.

- [x] **Step 4: Validar no navegador com `.env` configurado**

Run:

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

Checklist visual:

- `/clientes` renderiza sem erro de configuracao.
- Acoes por linha ficam horizontais.
- `Ficha` abre `/clientes/:cnpj`.
- Icone de faturas abre `/faturamento?tab=invoices&customer=...&customerName=...`.
- Menu de mais acoes abre e copia CNPJ/e-mail.
- Contatos mostram e-mail principal quando existir.
- Badges de operacao nao mostram zeros desnecessarios.
- Indicador de proxima acao aparece por linha.
- Chips de filtros aparecem e removem filtros individualmente.
- Ordenacao por cliente, B/Ls e saldo funciona.
- Em mobile, tabela rola sem sobrepor os controles.

---

## Sequencia Recomendada De Commits

1. `test: cover customer table view model`
2. `feat: compact customer row actions`
3. `feat: add customer quick copy actions`
4. `feat: improve customer contact display`
5. `feat: add customer next action indicators`
6. `feat: add customer filter chips`
7. `feat: add customer table sorting`
8. `style: polish customer table responsiveness`

---

## Criterios De Aceite

- Coluna `Acoes` nao empilha botoes em desktop.
- Acao de faturas e clara, compacta e preserva filtro por cliente.
- Excluir permanece separado e com estilo destrutivo.
- Contatos exibem e-mail principal e finalidade.
- Usuario consegue copiar CNPJ/CPF e e-mail principal sem abrir ficha.
- Badges de operacao mostram apenas estados uteis.
- Tela indica proxima acao operacional do cliente.
- Filtros ativos podem ser removidos individualmente.
- Tabela ordena por cliente, B/Ls e saldo.
- Testes, lint e build passam.

---

## Riscos E Cuidados

- Nao transformar a tabela inteira em componente generico nesta entrega.
- Nao adicionar dependencia nova para menu/dropdown.
- Nao alterar regras de exclusao; manter `runCustomerDelete`.
- Garantir `aria-label` em botoes icon-only.
- Nao mostrar copia de e-mail quando o cliente nao tiver e-mail.
- Manter cards superiores alinhados aos filtros aplicados.

