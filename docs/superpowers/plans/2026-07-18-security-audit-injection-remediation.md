# Remediação de Injeção (Filtro PostgREST + Fórmula em Planilha) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os 3 achados da auditoria de segurança reconduzindo pontos de código que contornam controles já existentes: escapar o input do usuário nos filtros `.or()` do PostgREST e sanitizar as células de exports contra injeção de fórmula.

**Architecture:** A fronteira de segurança já existe no repo — `escapeFilterTerm` (`src/lib/utils.ts`) para filtros PostgREST e `sanitizeCellValue`/`toSheet` (`src/services/exports.ts`) para injeção de fórmula. O bug é *drift*: 3 call-sites de busca esquecem o `escapeFilterTerm` e 1 export (`Painel.tsx`) esquece o sanitizador de fórmula, porque a lógica está duplicada em vez de centralizada. Corrigimos os call-sites e consolidamos o guard de fórmula num único módulo `src/lib/spreadsheetSafe.ts` para impedir recorrência.

**Tech Stack:** TypeScript, React 19, Supabase JS (PostgREST query builder), `@e965/xlsx`, Vitest.

---

## Contexto dos achados (resumo da auditoria)

| # | Sev | Arquivo:linha | Problema |
|---|-----|---------------|----------|
| A1 | 🟠 Médio | `src/services/graniteCharges.ts:120` | `filters.search` interpolado cru em `.or()` |
| A2 | 🟠 Médio | `src/services/vaziosImport.ts:149` | `filters.search` interpolado cru em `.or()` |
| A3 | 🟠 Médio | `src/hooks/useCustomers.ts:115` | `filters.search` interpolado cru em `.or()` |
| B  | 🟡 Médio | `src/pages/Painel.tsx:40` | `json_to_sheet` sem `sanitizeCellValue` |
| C  | 🔵 Baixo | `src/services/billing.ts:920` | guard ad-hoc `.replace(/[(),]/g,' ')` em vez de `escapeFilterTerm` (deixa `%`/`_`) |

**Impacto:** todos os pontos são superfícies de usuário interno autenticado; RLS continua protegendo dados de outra role. O risco real é (1) manipulação da lógica de filtro `.or()` (injeção de condições PostgREST), e (2) curingas `%`/`_` habilitando enumeração e varreduras caras (DoS). A doc `docs/operations/seguranca.md` já declara esses escapes como controle obrigatório — a correção restaura a invariante documentada.

**Payload canônico de teste:** a string `ACME,ME`. Verificação: `escapeFilterTerm('ACME,ME') === 'ACME ME'` (a vírgula injetada — que quebraria o `.or()` em cláusulas extras — vira espaço).

**Convenção de mock (já usada no repo):** um `builder` encadeável com método `then` para ser aguardável. Referência: `src/services/__tests__/voyageDedup.test.ts` e `src/hooks/__tests__/useBls.test.ts:41-55`.

---

## Task 1: Escapar filtro em `listGraniteBls` (Achado A1)

**Files:**
- Test: `src/services/__tests__/graniteChargesFilterInjection.test.ts` (criar)
- Modify: `src/services/graniteCharges.ts` (topo + linhas 119-123)

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/services/__tests__/graniteChargesFilterInjection.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ or: vi.fn() }))

vi.mock('../supabase', () => {
  const builder: Record<string, unknown> = {}
  Object.assign(builder, {
    select: () => builder,
    range: () => builder,
    order: () => builder,
    eq: () => builder,
    in: () => builder,
    or: (arg: string) => {
      calls.or(arg)
      return builder
    },
    then: (resolve: (value: { data: unknown[]; error: null; count: number }) => unknown) =>
      resolve({ data: [], error: null, count: 0 }),
  })
  return { supabase: { from: () => builder } }
})

import { listGraniteBls } from '../graniteCharges'

describe('listGraniteBls - injeção de filtro PostgREST', () => {
  beforeEach(() => calls.or.mockReset())

  it('escapa metacaracteres de filtro no termo de busca', async () => {
    await listGraniteBls({ search: 'ACME,ME' })
    expect(calls.or).toHaveBeenCalledWith(
      'bl_number.ilike.%ACME ME%,shipper_name.ilike.%ACME ME%,shipper_cnpj.ilike.%ACME ME%',
    )
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/services/__tests__/graniteChargesFilterInjection.test.ts`
Expected: FAIL — recebido contém `%ACME,ME%` (vírgula crua) em vez de `%ACME ME%`.

- [ ] **Step 3: Implementar o escape**

Em `src/services/graniteCharges.ts`, adicionar o import no topo (linha 2, após o import de `supabase`):

```ts
import { supabase } from './supabase'
import { escapeFilterTerm } from '../lib/utils'
import type { GraniteBlCharge, GraniteRate } from '../types/database'
```

Substituir o bloco atual (linhas 119-123):

```ts
  if (filters.search) {
    query = query.or(
      `bl_number.ilike.%${filters.search}%,shipper_name.ilike.%${filters.search}%,shipper_cnpj.ilike.%${filters.search}%`,
    )
  }
```

por:

```ts
  if (filters.search) {
    const search = escapeFilterTerm(filters.search)
    query = query.or(
      `bl_number.ilike.%${search}%,shipper_name.ilike.%${search}%,shipper_cnpj.ilike.%${search}%`,
    )
  }
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/services/__tests__/graniteChargesFilterInjection.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/graniteCharges.ts src/services/__tests__/graniteChargesFilterInjection.test.ts
git commit -m "fix(security): escapa filtro PostgREST em listGraniteBls"
```

---

## Task 2: Escapar filtro em `listVaziosBookings` (Achado A2)

**Files:**
- Test: `src/services/__tests__/vaziosImportFilterInjection.test.ts` (criar)
- Modify: `src/services/vaziosImport.ts` (topo + linhas 148-152)

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/services/__tests__/vaziosImportFilterInjection.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ or: vi.fn() }))

vi.mock('../supabase', () => {
  const builder: Record<string, unknown> = {}
  Object.assign(builder, {
    select: () => builder,
    range: () => builder,
    order: () => builder,
    eq: () => builder,
    in: () => builder,
    or: (arg: string) => {
      calls.or(arg)
      return builder
    },
    then: (resolve: (value: { data: unknown[]; error: null; count: number }) => unknown) =>
      resolve({ data: [], error: null, count: 0 }),
  })
  return { supabase: { from: () => builder } }
})

import { listVaziosBookings } from '../vaziosImport'

describe('listVaziosBookings - injeção de filtro PostgREST', () => {
  beforeEach(() => calls.or.mockReset())

  it('escapa metacaracteres de filtro no termo de busca', async () => {
    await listVaziosBookings({ search: 'ACME,ME' })
    expect(calls.or).toHaveBeenCalledWith(
      'booking_number.ilike.%ACME ME%,container_number.ilike.%ACME ME%',
    )
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/services/__tests__/vaziosImportFilterInjection.test.ts`
Expected: FAIL — recebido contém `%ACME,ME%`.

- [ ] **Step 3: Implementar o escape**

Em `src/services/vaziosImport.ts`, adicionar o import no topo (após a linha 3 `import { supabase } from './supabase'`):

```ts
import { escapeFilterTerm } from '../lib/utils'
```

Substituir o bloco atual (linhas 148-152):

```ts
  if (filters.search) {
    query = query.or(
      `booking_number.ilike.%${filters.search}%,container_number.ilike.%${filters.search}%`,
    )
  }
```

por:

```ts
  if (filters.search) {
    const search = escapeFilterTerm(filters.search)
    query = query.or(
      `booking_number.ilike.%${search}%,container_number.ilike.%${search}%`,
    )
  }
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/services/__tests__/vaziosImportFilterInjection.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/vaziosImport.ts src/services/__tests__/vaziosImportFilterInjection.test.ts
git commit -m "fix(security): escapa filtro PostgREST em listVaziosBookings"
```

---

## Task 3: Escapar filtro em `fetchCustomerRows` (Achado A3)

**Files:**
- Test: `src/hooks/__tests__/useCustomersFilterInjection.test.ts` (criar)
- Modify: `src/hooks/useCustomers.ts` (linha 86: exportar `fetchCustomerRows`; linhas 112-118: escapar)

Nota: `fetchCustomerRows` chama `fetchIssuedInvoiceBalanceByCustomer([])`, que faz curto-circuito com array vazio (`src/services/customers.ts:200`) — logo o teste só precisa mockar o supabase. `escapeFilterTerm` e `onlyDigits` já estão importados (`src/hooks/useCustomers.ts:4`).

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/hooks/__tests__/useCustomersFilterInjection.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ or: vi.fn() }))

vi.mock('../../services/supabase', () => {
  const builder: Record<string, unknown> = {}
  Object.assign(builder, {
    select: () => builder,
    range: () => builder,
    order: () => builder,
    eq: () => builder,
    in: () => builder,
    or: (arg: string) => {
      calls.or(arg)
      return builder
    },
    then: (resolve: (value: { data: unknown[]; error: null; count: number }) => unknown) =>
      resolve({ data: [], error: null, count: 0 }),
  })
  return { supabase: { from: () => builder } }
})

import { fetchCustomerRows, type CustomerFilters } from '../useCustomers'

const baseFilters: CustomerFilters = {
  search: 'ACME,ME',
  contactEmail: '',
  emailStatus: '',
  blStatus: '',
  pendingStatus: '',
  sortKey: 'name',
  sortDirection: 'asc',
  page: 0,
  pageSize: 20,
}

describe('fetchCustomerRows - injeção de filtro PostgREST', () => {
  beforeEach(() => calls.or.mockReset())

  it('escapa metacaracteres de filtro no termo de busca', async () => {
    await fetchCustomerRows(baseFilters, true)
    expect(calls.or).toHaveBeenCalledWith(
      'name.ilike.%ACME ME%,trade_name.ilike.%ACME ME%,cnpj_cpf.ilike.%ACME ME%',
    )
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/hooks/__tests__/useCustomersFilterInjection.test.ts`
Expected: FAIL — o import `fetchCustomerRows` não existe ainda (função não exportada) **e** o filtro conteria `%ACME,ME%`.

- [ ] **Step 3: Exportar a função e implementar o escape**

Em `src/hooks/useCustomers.ts`, linha 86, tornar a função exportada:

```ts
export async function fetchCustomerRows(filters: CustomerFilters, paginate: boolean) {
```

Substituir o bloco atual (linhas 112-118):

```ts
  if (filters.search) {
    const normalizedDocument = onlyDigits(filters.search)
    const documentClause = normalizedDocument ? `,cnpj_cpf.ilike.%${normalizedDocument}%` : ''
    query = query.or(
      `name.ilike.%${filters.search}%,trade_name.ilike.%${filters.search}%,cnpj_cpf.ilike.%${filters.search}%${documentClause}`,
    )
  }
```

por:

```ts
  if (filters.search) {
    const search = escapeFilterTerm(filters.search)
    const normalizedDocument = onlyDigits(filters.search)
    const documentClause = normalizedDocument ? `,cnpj_cpf.ilike.%${normalizedDocument}%` : ''
    query = query.or(
      `name.ilike.%${search}%,trade_name.ilike.%${search}%,cnpj_cpf.ilike.%${search}%${documentClause}`,
    )
  }
```

Nota: `normalizedDocument` vem de `onlyDigits` (só dígitos), estruturalmente seguro — mantido como está.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/hooks/__tests__/useCustomersFilterInjection.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useCustomers.ts src/hooks/__tests__/useCustomersFilterInjection.test.ts
git commit -m "fix(security): escapa filtro PostgREST na busca de clientes"
```

---

## Task 4: Trocar guard ad-hoc por `escapeFilterTerm` em `listBillingCustomers` (Achado C)

**Files:**
- Test: `src/services/__tests__/billingCustomersFilterInjection.test.ts` (criar)
- Modify: `src/services/billing.ts` (linha 920)

Nota: `escapeFilterTerm` já está importado (`src/services/billing.ts:5`).

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/services/__tests__/billingCustomersFilterInjection.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ or: vi.fn() }))

vi.mock('../supabase', () => {
  const builder: Record<string, unknown> = {}
  Object.assign(builder, {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    or: (arg: string) => {
      calls.or(arg)
      return builder
    },
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: [], error: null }),
  })
  return { supabase: { from: () => builder } }
})

import { listBillingCustomers } from '../billing'

describe('listBillingCustomers - injeção de filtro PostgREST', () => {
  beforeEach(() => calls.or.mockReset())

  it('remove curingas e metacaracteres de filtro do termo', async () => {
    await listBillingCustomers('AB,%_')
    expect(calls.or).toHaveBeenCalledWith('name.ilike.%AB%,cnpj_cpf.ilike.%AB%')
  })
})
```

Verificação do valor esperado: `escapeFilterTerm('AB,%_')` remove `,`, `%`, `_` → `'AB'`; `digitSearch` = `''` (< 2, sem cláusula extra).

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/services/__tests__/billingCustomersFilterInjection.test.ts`
Expected: FAIL — o guard atual (`.replace(/[(),]/g,' ')`) mantém `%` e `_`, produzindo `name.ilike.%AB %_%,...`.

- [ ] **Step 3: Implementar a troca**

Em `src/services/billing.ts`, substituir a linha 920:

```ts
  const safeSearch = normalizedSearch.replace(/[(),]/g, ' ')
```

por:

```ts
  const safeSearch = escapeFilterTerm(normalizedSearch)
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/services/__tests__/billingCustomersFilterInjection.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/billing.ts src/services/__tests__/billingCustomersFilterInjection.test.ts
git commit -m "fix(security): usa escapeFilterTerm em listBillingCustomers"
```

---

## Task 5: Criar módulo compartilhado do guard de fórmula

**Files:**
- Create: `src/lib/spreadsheetSafe.ts`
- Test: `src/lib/__tests__/spreadsheetSafe.test.ts` (criar)

Centraliza o guard de injeção de fórmula hoje duplicado em `src/services/exports.ts`, `src/lib/csv.ts` e inline em `src/services/reconciliacao.ts`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/__tests__/spreadsheetSafe.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { sanitizeCellValue, sanitizeSheetRows } from '../spreadsheetSafe'

describe('sanitizeCellValue', () => {
  it('prefixa aspa simples em valores que começam com metacaractere de fórmula', () => {
    expect(sanitizeCellValue('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(sanitizeCellValue('+1')).toBe("'+1")
    expect(sanitizeCellValue('-1')).toBe("'-1")
    expect(sanitizeCellValue('@x')).toBe("'@x")
  })

  it('preserva strings normais e não-strings', () => {
    expect(sanitizeCellValue('NAVIO A')).toBe('NAVIO A')
    expect(sanitizeCellValue(42)).toBe(42)
    expect(sanitizeCellValue(null)).toBe(null)
  })
})

describe('sanitizeSheetRows', () => {
  it('sanitiza cada célula de string de cada linha', () => {
    expect(sanitizeSheetRows([{ a: '=1+1', b: 2, c: 'ok' }])).toEqual([
      { a: "'=1+1", b: 2, c: 'ok' },
    ])
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/lib/__tests__/spreadsheetSafe.test.ts`
Expected: FAIL — módulo `../spreadsheetSafe` não existe.

- [ ] **Step 3: Criar o módulo**

Criar `src/lib/spreadsheetSafe.ts`:

```ts
// Neutraliza injeção de fórmula (CSV/Excel injection). Um valor iniciado por
// = + - @ ou tab/CR é interpretado como fórmula ao abrir no Excel/Sheets;
// prefixar com aspa simples força o tratamento como texto literal. Dados de
// células vêm de arquivos de armador importados (não confiáveis). Fonte única
// para os exports XLSX (exports.ts, reconciliacao.ts) e CSV (csv.ts).
export const FORMULA_INJECTION_PREFIX = /^[=+\-@\t\r]/

export function sanitizeCellValue<T>(value: T): T | string {
  if (typeof value === 'string' && FORMULA_INJECTION_PREFIX.test(value)) {
    return `'${value}`
  }
  return value
}

export function sanitizeSheetRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      out[key] = sanitizeCellValue(value)
    }
    return out
  })
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/lib/__tests__/spreadsheetSafe.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/spreadsheetSafe.ts src/lib/__tests__/spreadsheetSafe.test.ts
git commit -m "feat(security): módulo compartilhado sanitizeSheetRows contra injeção de fórmula"
```

---

## Task 6: Mover export do Line Up para `exports.ts` com sanitização (Achado B)

**Files:**
- Modify: `src/services/exports.ts` (adicionar `exportLineUpWorkbook`)
- Modify: `src/pages/Painel.tsx` (remover função local + imports órfãos; chamar a nova)
- Test: `src/services/__tests__/exportsLineUpInjection.test.ts` (criar)

O export do Line Up é o único que vive dentro de um componente de página e o único sem sanitizador. Movê-lo para `exports.ts` faz reusar `toSheet` (que já sanitiza) e o torna testável como os demais.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/services/__tests__/exportsLineUpInjection.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exportLineUpWorkbook } from '../exports'
import type { LineUpRow } from '../lineup'

const { jsonToSheet, bookAppendSheet, writeFile } = vi.hoisted(() => ({
  jsonToSheet: vi.fn((rows: unknown[]) => ({ rows })),
  bookAppendSheet: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('@e965/xlsx', () => ({
  utils: {
    book_new: vi.fn(() => ({ Sheets: {} })),
    json_to_sheet: jsonToSheet,
    book_append_sheet: bookAppendSheet,
  },
  writeFile,
}))

describe('exportLineUpWorkbook - injeção de fórmula', () => {
  beforeEach(() => {
    jsonToSheet.mockClear()
    bookAppendSheet.mockClear()
    writeFile.mockClear()
  })

  it('neutraliza valores de célula iniciados por metacaractere de fórmula', async () => {
    const rows = [
      { vesselName: '=cmd|calc', voyageNumber: '001', pod: 'SSZ', vin: 1, car: 0, cg: 0, total: 1, mty: 0 },
    ] as unknown as LineUpRow[]

    await exportLineUpWorkbook(rows)

    expect(jsonToSheet).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ Navio: "'=cmd|calc", POD: 'SSZ' })]),
    )
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/services/__tests__/exportsLineUpInjection.test.ts`
Expected: FAIL — `exportLineUpWorkbook` não existe em `../exports`.

- [ ] **Step 3: Adicionar `exportLineUpWorkbook` em `exports.ts`**

Em `src/services/exports.ts`, adicionar aos imports do topo (após a linha 12 `import { formatDate } from '../lib/utils'`):

```ts
import { arrivalDisplay } from '../lib/escalaState'
import type { LineUpRow } from './lineup'
```

Adicionar a nova função (antes de `function makeTimestamp()`, no fim do arquivo). Usa `toSheet`, que já aplica o sanitizador:

```ts
export async function exportLineUpWorkbook(rows: LineUpRow[]) {
  const XLSX = await import('@e965/xlsx')
  const exportRows = rows.map((row) => ({
    Navio: row.vesselName,
    Viagem: row.voyageNumber,
    POD: row.pod,
    Status: row.voyageStatus === 'completed' ? 'Concluída' : row.voyageStatus === 'cancelled' ? 'Cancelada' : row.voyageStatus === 'active' ? 'Ativa' : row.voyageStatus ?? '',
    ETA: arrivalDisplay({ eta: row.eta, ata: row.ata }).value ?? '',
    ETB: row.etb ?? '',
    VIN: row.vin,
    'VIN CNTR': row.car,
    CG: row.cg,
    Total: row.total,
    MTY: row.mty,
    RTW: row.rtw ?? '',
    'BB Máquinas': row.bbMachines,
    'BB Pacotes': row.bbPackages,
    'BB Total': row.bbTotal,
    CEs: row.rowType === 'export' ? row.exportCeStatus ?? 'waiting' : row.ceStatus,
    Linked: (row.rowType === 'export' ? row.exportLinked : row.linked) ? 'Sim' : 'Não',
  }))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, toSheet(XLSX, exportRows), 'Line Up')
  XLSX.writeFile(workbook, `painel-lineup-${makeTimestamp()}.xlsx`)
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/services/__tests__/exportsLineUpInjection.test.ts`
Expected: PASS

- [ ] **Step 5: Rotear `Painel.tsx` para a nova função e remover órfãos**

Em `src/pages/Painel.tsx`:

1. Remover a função local inteira `exportLineUpToExcel` (linhas 19-44).
2. Remover os imports que ficam órfãos: `arrivalDisplay` (linha 17) e o `type LineUpRow` do import de `./services/lineup` (linha 16 passa a importar só `fetchLineUpSnapshot`).

O import da linha 16 fica:

```ts
import { fetchLineUpSnapshot } from '../services/lineup'
```

3. Adicionar o import da nova função (junto aos imports de serviço):

```ts
import { exportLineUpWorkbook } from '../services/exports'
```

4. No `handleExport` (linha 72), trocar a chamada:

```ts
      await exportLineUpWorkbook(rows)
```

- [ ] **Step 6: Rodar typecheck e o teste do Painel**

Run: `npm run typecheck && npx vitest run src/pages/__tests__/Painel.behavior.test.tsx`
Expected: PASS — sem imports órfãos (`tsc` acusaria `arrivalDisplay`/`LineUpRow` não usados) e o comportamento do Painel intacto.

- [ ] **Step 7: Commit**

```bash
git add src/services/exports.ts src/pages/Painel.tsx src/services/__tests__/exportsLineUpInjection.test.ts
git commit -m "fix(security): sanitiza export do Line Up movendo-o para exports.ts"
```

---

## Task 7: Consolidar o guard duplicado (dedup, sem mudança de comportamento)

**Files:**
- Modify: `src/services/exports.ts` (usar helper compartilhado em `toSheet`)
- Modify: `src/services/reconciliacao.ts` (usar `sanitizeSheetRows`)
- Modify: `src/lib/csv.ts` (importar `FORMULA_INJECTION_PREFIX` compartilhado)

Remove as três cópias do guard, deixando `src/lib/spreadsheetSafe.ts` como fonte única. Testes existentes (`exports.test.ts`, `csv.test.ts`, `reconciliacao*.test.ts`) provam a ausência de regressão.

- [ ] **Step 1: Reescrever `toSheet` em `exports.ts` para usar o helper**

Em `src/services/exports.ts`, adicionar ao import do helper (junto aos imports de `../lib/...`):

```ts
import { sanitizeSheetRows } from '../lib/spreadsheetSafe'
```

Remover o `FORMULA_INJECTION_PREFIX` (linha 23), a função `sanitizeCellValue` (linhas 25-30) e o corpo antigo de `toSheet`, substituindo por:

```ts
function toSheet<T extends Record<string, unknown>>(
  XLSX: typeof import('@e965/xlsx'),
  rows: T[],
) {
  return XLSX.utils.json_to_sheet(sanitizeSheetRows(rows))
}
```

- [ ] **Step 2: Rodar os testes de exports e confirmar verde**

Run: `npx vitest run src/services/__tests__/exports.test.ts src/services/__tests__/exportsLineUpInjection.test.ts`
Expected: PASS (comportamento idêntico ao anterior).

- [ ] **Step 3: Usar `sanitizeSheetRows` em `reconciliacao.ts`**

Em `src/services/reconciliacao.ts`, adicionar o import (junto aos imports de `../lib/...` ou no topo do arquivo):

```ts
import { sanitizeSheetRows } from '../lib/spreadsheetSafe'
```

Substituir o bloco inline (linhas 523-533):

```ts
  const safeRows = data.map((row) => {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) {
        out[key] = `'${value}`
      } else {
        out[key] = value
      }
    }
    return out
  })
```

por:

```ts
  const safeRows = sanitizeSheetRows(data)
```

- [ ] **Step 4: Importar o prefixo compartilhado em `csv.ts`**

Em `src/lib/csv.ts`, remover a definição local (linhas 1-6) do `FORMULA_INJECTION_PREFIX` e importá-lo:

```ts
import { FORMULA_INJECTION_PREFIX } from './spreadsheetSafe'
```

O restante de `downloadCsv` (que combina o prefixo com o quoting específico de CSV) permanece inalterado.

- [ ] **Step 5: Rodar a suíte relacionada e confirmar verde**

Run: `npx vitest run src/lib/__tests__/csv.test.ts src/services/__tests__/reconciliacao*.test.ts src/services/__tests__/exports.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/exports.ts src/services/reconciliacao.ts src/lib/csv.ts
git commit -m "refactor(security): fonte única para o guard de injeção de fórmula"
```

---

## Task 8: Documentação e verificação final

**Files:**
- Modify: `docs/operations/seguranca.md`

- [ ] **Step 1: Atualizar a doc de segurança**

Em `docs/operations/seguranca.md`, na seção **Outras defesas**, substituir os dois bullets existentes:

```markdown
- **Injeção em filtros PostgREST:** input de usuário em `.or()/.ilike()` é escapado (`escapeFilterTerm` / `sanitizeLikeTerm`, `src/lib/utils.ts`).
- **Injeção de fórmula em planilhas:** exports passam pelo sanitizador de `src/services/exports.ts`.
```

por:

```markdown
- **Injeção em filtros PostgREST:** todo input de usuário em `.or()/.ilike()` é escapado (`escapeFilterTerm` / `sanitizeLikeTerm`, `src/lib/utils.ts`). Auditoria 2026-07-18 reconduziu 4 call-sites que interpolavam o termo cru (`listGraniteBls`, `listVaziosBookings`, busca de clientes em `useCustomers`, `listBillingCustomers`).
- **Injeção de fórmula em planilhas:** todo export (XLSX e CSV) passa pelo guard único `sanitizeCellValue`/`sanitizeSheetRows` (`src/lib/spreadsheetSafe.ts`). Auditoria 2026-07-18 consolidou as cópias duplicadas e reconduziu o export do Line Up, que não sanitizava.
```

- [ ] **Step 2: Rodar a verificação completa**

Run: `npm run docs:check && npm run lint && npm test && npm run build`
Expected: todos PASS (docs sem links quebrados, lint limpo, suíte verde, build ok).

- [ ] **Step 3: Commit**

```bash
git add docs/operations/seguranca.md
git commit -m "docs(security): registra recondução dos escapes de filtro e fórmula"
```

- [ ] **Step 4: Push e PR**

```bash
git push -u origin claude/security-audit-penetration-testing-ufjy7u
```

Abrir PR (ready for review) descrevendo os 5 achados (A1-A3, B, C) e a consolidação do guard.

---

## Self-Review

**Cobertura do spec (5 achados):**
- A1 `listGraniteBls` → Task 1 ✅
- A2 `listVaziosBookings` → Task 2 ✅
- A3 `useCustomers`/`fetchCustomerRows` → Task 3 ✅
- C `listBillingCustomers` → Task 4 ✅
- B `Painel.tsx` export → Tasks 5+6 (helper + move/sanitize) ✅
- Causa-raiz (duplicação do guard) → Task 7 ✅
- Documentação (Documentation Contract do CLAUDE.md) → Task 8 ✅

**Consistência de nomes/tipos:**
- `escapeFilterTerm(value: string): string` — usado idêntico nas Tasks 1-4.
- `sanitizeCellValue<T>(value: T): T | string`, `sanitizeSheetRows(rows: Record<string, unknown>[])`, `FORMULA_INJECTION_PREFIX` — definidos na Task 5, consumidos nas Tasks 6-7.
- `exportLineUpWorkbook(rows: LineUpRow[])` — criado na Task 6, chamado em `Painel.tsx` na mesma task.
- Payload de teste `'ACME,ME'` e resultado escapado `'ACME ME'` consistentes; verificados contra a regex `/[%_,.():*"\\]/g` de `escapeFilterTerm`.

**Placeholders:** nenhum — todo passo com código traz o código completo; todo passo de comando traz o comando exato e o resultado esperado.

**Riscos residuais / decisões:**
- `escapeFilterTerm` remove `.` — buscas por CNPJ formatado (`12.345...`) perdem os pontos; o caminho de dígitos (`onlyDigits`/`digitSearch`) cobre a busca numérica. Comportamento idêntico aos call-sites já corretos (`useBls`, `chargeOperationsService`).
- Exportar `fetchCustomerRows` (Task 3) segue o padrão do arquivo, que já exporta helpers internos para teste (`summarizeCustomerRows`, `filterCustomerRowsByClientSideFilters`).
- Todos os pontos são autenticados + RLS; a correção restaura a invariante documentada, não altera fronteira de autorização (nenhuma migration necessária).
